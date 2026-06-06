import { realpathSync } from "node:fs";
import { listWorktrees, repoRoot } from "./git";
import { listAgents, matchAgents, type AgentSession } from "./agents";
import type { Worktree } from "./types";
import {
  buildTmuxCmd,
  buildZellijCmd,
  detect,
  spawnMux,
  type Env,
  type TmuxPlacement,
  type ZellijPlacement,
} from "./mux";
import { resolveMuxTarget } from "./session";
import { VERSION, cmdUpdate, maybeNag, refreshCache } from "./update";

const USAGE = `wt — worktree helper

Usage:
  wt list [--json]          list worktrees (annotates Claude Code agent sessions)
  wt switch <branch|path>   open a worktree in a new tmux/zellij window
  wt root                   open the main (root) worktree in a new mux window
  wt current                print the path of the worktree containing $PWD
  wt update                 check for a new release and install it
  wt --version              print the installed wt version
  wt --help                 show this help

Environment:
  WT_CMD              command to spawn (default: $EDITOR or vi)
  WT_TMUX_PLACEMENT   new-window (default) | split-h | split-v
  WT_ZELLIJ_PLACEMENT new-tab (default) | new-pane
  WT_TMUX_TARGET      tmux session to target when $TMUX is unset (e.g. "0")
  WT_TMUX_SOCKET      full path of tmux socket (-S), for non-default sockets
  WT_ZELLIJ_SESSION   zellij session to target when $ZELLIJ is unset
  WT_NO_UPDATE_CHECK  set to any value to disable the background update check
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

function tmuxPlacement(env: Env): TmuxPlacement {
  const v = env.WT_TMUX_PLACEMENT;
  if (!v || v === "new-window") return "new-window";
  if (v === "split-h" || v === "split-v") return v;
  die(`unknown WT_TMUX_PLACEMENT: ${v}`);
}

function zellijPlacement(env: Env): ZellijPlacement {
  const v = env.WT_ZELLIJ_PLACEMENT;
  if (!v || v === "new-tab") return "new-tab";
  if (v === "new-pane") return "new-pane";
  die(`unknown WT_ZELLIJ_PLACEMENT: ${v}`);
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

async function switchTo(path: string, branch: string, env: Env): Promise<void> {
  let resolved: Env;
  try {
    resolved = await resolveMuxTarget(env);
  } catch (e) {
    die((e as Error).message);
  }
  const mux = detect(resolved);
  if (!mux) {
    die(
      "no mux detected (set $TMUX or $ZELLIJ, or WT_TMUX_TARGET / WT_ZELLIJ_SESSION)",
    );
  }
  const cmd = resolveCmd(resolved);
  const args = { path, branch, cmd };
  const argv =
    mux === "tmux"
      ? buildTmuxCmd(resolved, args, tmuxPlacement(resolved))
      : buildZellijCmd(resolved, args, zellijPlacement(resolved));
  try {
    await spawnMux(argv);
  } catch (e) {
    die((e as Error).message);
  }
}

function realpathOrSame(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

async function cmdSwitch(args: string[], env: Env): Promise<void> {
  const target = args[0];
  if (!target) die("usage: wt switch <branch|path>");
  const resolved = realpathOrSame(target);
  const entries = await getWorktrees(env);
  const match = entries.find(
    (w) =>
      w.branch === target || w.path === target || w.path === resolved,
  );
  if (!match) die(`worktree '${target}' not found`);
  await switchTo(match.path, displayBranch(match), env);
}

async function cmdRoot(_args: string[], env: Env): Promise<void> {
  const entries = await getWorktrees(env);
  const main = entries[0];
  if (!main) die("no worktrees found");
  await switchTo(main.path, displayBranch(main), env);
}

async function cmdCurrent(_args: string[], env: Env): Promise<void> {
  const entries = await getWorktrees(env);
  const cwd = realpathOrSame(process.cwd());
  let best: Worktree | undefined;
  for (const w of entries) {
    if (cwd === w.path || cwd.startsWith(w.path + "/")) {
      if (!best || w.path.length > best.path.length) best = w;
    }
  }
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
