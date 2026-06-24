import { realpathSync } from "node:fs";
import { listWorktrees, repoRoot } from "./git";
import { listAgents, matchAgents, type AgentSession } from "./agents";
import type { Worktree } from "./types";
import {
  buildGhosttyCmd,
  spawnGhostty,
  type Env,
  type GhosttyPlacement,
} from "./ghostty";
import { VERSION, cmdUpdate, maybeNag, refreshCache } from "./update";

const USAGE = `wt — worktree helper

Usage:
  wt list [--json]          list worktrees (annotates Claude Code agent sessions)
  wt switch [branch|path]   open a worktree in a new Ghostty tab
                            (defaults to the worktree containing $PWD)
  wt root                   open the main (root) worktree in a new Ghostty tab
  wt current                print the path of the worktree containing $PWD
  wt update                 check for a new release and install it
  wt --version              print the installed wt version
  wt --help                 show this help

Placement flags (for switch / root, override WT_GHOSTTY_PLACEMENT):
  --tab                 open in a new tab (default)
  --window              open in a new window
  --split-right         split the front window to the right
  --split-left          split the front window to the left
  --split-down          split the front window downward
  --split-up            split the front window upward
  --split               alias for --split-right
  --placement <name>, -p <name>
                        any of the names above (new-tab, new-window, split-*)

Environment:
  WT_CMD                command to spawn (default: $EDITOR or vi)
  WT_GHOSTTY_PLACEMENT  new-tab (default) | new-window |
                        split-right | split-left | split-down | split-up
  WT_NO_UPDATE_CHECK    set to any value to disable the background update check
`;

function die(msg: string): never {
  process.stderr.write(`wt: ${msg}\n`);
  process.exit(1);
}

function displayBranch(w: Worktree): string {
  if (w.detached) {
    const short = w.head.slice(0, 7);
    return `<detached ${short}>`;
  }
  return w.branch;
}

function flags(w: Worktree, agent?: AgentSession): string {
  const f: string[] = [];
  if (agent) f.push("agent");
  if (w.detached) f.push("detached");
  if (w.bare) f.push("bare");
  if (w.locked) f.push("locked");
  return f.join(",");
}

/** Human-readable status for an agent row, folding in `waitingFor` when set. */
function agentStatus(agent: AgentSession): string {
  const status = agent.status ?? "";
  if (agent.waitingFor) {
    return status ? `${status} (${agent.waitingFor})` : agent.waitingFor;
  }
  return status;
}

function resolveCmd(env: Env): string {
  return env.WT_CMD || env.EDITOR || "vi";
}

const GHOSTTY_PLACEMENTS: GhosttyPlacement[] = [
  "new-window",
  "new-tab",
  "split-right",
  "split-left",
  "split-down",
  "split-up",
];

function ghosttyPlacement(env: Env, override?: GhosttyPlacement): GhosttyPlacement {
  if (override) return override;
  const v = env.WT_GHOSTTY_PLACEMENT;
  if (!v) return "new-tab";
  if ((GHOSTTY_PLACEMENTS as string[]).includes(v)) return v as GhosttyPlacement;
  die(`unknown WT_GHOSTTY_PLACEMENT: ${v}`);
}

/** Map a CLI placement flag to its GhosttyPlacement. */
const PLACEMENT_FLAGS: Record<string, GhosttyPlacement> = {
  "--tab": "new-tab",
  "--window": "new-window",
  "--split": "split-right",
  "--split-right": "split-right",
  "--split-left": "split-left",
  "--split-down": "split-down",
  "--split-up": "split-up",
};

/**
 * Pull any placement flag out of `args`, returning the chosen placement (if any)
 * and the remaining positional arguments. A later flag wins over an earlier one.
 */
function parsePlacement(args: string[]): {
  placement?: GhosttyPlacement;
  rest: string[];
} {
  const rest: string[] = [];
  let placement: GhosttyPlacement | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a in PLACEMENT_FLAGS) {
      placement = PLACEMENT_FLAGS[a];
    } else if (a === "--placement" || a === "-p") {
      const v = args[++i];
      if (!v) die(`${a} requires a value`);
      if (!(GHOSTTY_PLACEMENTS as string[]).includes(v)) {
        die(`unknown placement: ${v}`);
      }
      placement = v as GhosttyPlacement;
    } else {
      rest.push(a);
    }
  }
  return { placement, rest };
}

async function getWorktrees(env: Env): Promise<Worktree[]> {
  const cwd = process.cwd();
  try {
    return await listWorktrees(cwd);
  } catch (e) {
    die((e as Error).message);
  }
}

async function cmdList(args: string[], env: Env): Promise<void> {
  const json = args.includes("--json");
  const entries = await getWorktrees(env);
  const agentMap = matchAgents(entries, await listAgents(env));
  if (json) {
    const obj = entries.map((w) => {
      const agent = agentMap.get(w.path);
      const row: Record<string, unknown> = {
        path: w.path,
        branch: displayBranch(w),
        flags: flags(w, agent),
      };
      if (agent) {
        if (agent.sessionId !== undefined) row.sessionId = agent.sessionId;
        if (agent.name !== undefined) row.name = agent.name;
        if (agent.status !== undefined) row.status = agent.status;
        if (agent.waitingFor !== undefined) row.waitingFor = agent.waitingFor;
      }
      return row;
    });
    process.stdout.write(JSON.stringify(obj) + "\n");
  } else {
    for (const w of entries) {
      const agent = agentMap.get(w.path);
      let line = `${w.path}\t${displayBranch(w)}\t${flags(w, agent)}`;
      if (agent) line += `\t${agent.name ?? ""}\t${agentStatus(agent)}`;
      process.stdout.write(line + "\n");
    }
  }
}

async function switchTo(
  path: string,
  env: Env,
  placement?: GhosttyPlacement,
): Promise<void> {
  const cmd = resolveCmd(env);
  const argv = buildGhosttyCmd({ path, cmd }, ghosttyPlacement(env, placement));
  try {
    await spawnGhostty(argv);
  } catch (e) {
    die((e as Error).message);
  }
}

/** The worktree containing `cwd` (longest matching path wins), if any. */
function currentWorktree(
  entries: Worktree[],
  cwd: string = realpathOrSame(process.cwd()),
): Worktree | undefined {
  let best: Worktree | undefined;
  for (const w of entries) {
    if (cwd === w.path || cwd.startsWith(w.path + "/")) {
      if (!best || w.path.length > best.path.length) best = w;
    }
  }
  return best;
}

function realpathOrSame(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

async function cmdSwitch(args: string[], env: Env): Promise<void> {
  const { placement, rest } = parsePlacement(args);
  const target = rest[0];
  const entries = await getWorktrees(env);
  if (!target) {
    // No target: re-open the worktree we're already in — `wt switch $(wt current)`.
    const here = currentWorktree(entries);
    if (!here) die("not inside a worktree (and no <branch|path> given)");
    await switchTo(here.path, env, placement);
    return;
  }
  const resolved = realpathOrSame(target);
  const match = entries.find(
    (w) =>
      w.branch === target || w.path === target || w.path === resolved,
  );
  if (!match) die(`worktree '${target}' not found`);
  await switchTo(match.path, env, placement);
}

async function cmdRoot(args: string[], env: Env): Promise<void> {
  const { placement } = parsePlacement(args);
  const entries = await getWorktrees(env);
  const main = entries[0];
  if (!main) die("no worktrees found");
  await switchTo(main.path, env, placement);
}

async function cmdCurrent(_args: string[], env: Env): Promise<void> {
  const entries = await getWorktrees(env);
  const best = currentWorktree(entries);
  if (!best) process.exit(1);
  process.stdout.write(best.path + "\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const env: Env = process.env as Env;
  const sub = argv[0];

  if (sub === "__refresh-update-cache") {
    try {
      await refreshCache(env);
    } catch {
      // silent — background best-effort
    }
    return;
  }

  if (sub !== "update") maybeNag(env);

  switch (sub) {
    case undefined:
    case "":
      process.stdout.write(USAGE);
      return;
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      return;
    case "-v":
    case "--version":
    case "version":
      process.stdout.write(`v${VERSION}\n`);
      return;
    case "list":
      return cmdList(argv.slice(1), env);
    case "switch":
      return cmdSwitch(argv.slice(1), env);
    case "root":
      return cmdRoot(argv.slice(1), env);
    case "current":
      return cmdCurrent(argv.slice(1), env);
    case "update": {
      const code = await cmdUpdate(env);
      process.exit(code);
    }
    default:
      die(`unknown command: ${sub} (try: wt --help)`);
  }
}

main().catch((e: unknown) => {
  die(e instanceof Error ? e.message : String(e));
});
