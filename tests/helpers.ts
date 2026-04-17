import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type Repo = { path: string; cleanup: () => void };

export function makeRepo(): string {
  const base = mkdtempSync(join(tmpdir(), "wt-test-"));
  const repo = realpathSync(base);
  const run = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
    }
  };
  run("init", "-q", "-b", "main");
  run("config", "user.email", "t@e.com");
  run("config", "user.name", "t");
  run("commit", "-q", "--allow-empty", "-m", "init");
  return repo;
}

export function addWorktree(repo: string, branch: string, path?: string): string {
  const wtPath = path ?? realpathSync(mkdtempSync(join(tmpdir(), `wt-wt-${branch}-`)));
  // remove the auto-created dir — git worktree add needs a fresh path
  const run = (...args: string[]) => {
    const r = spawnSync("git", ["-C", repo, ...args]);
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
    }
  };
  // git worktree add will complain if the dir exists; remove and recreate
  spawnSync("rm", ["-rf", wtPath]);
  run("worktree", "add", "-q", "-b", branch, wtPath);
  return wtPath;
}

export type FakeBin = { dir: string; log: string; state: string };

const SMART_TMUX = (log: string, state: string) => `#!/bin/sh
LOG='${log}'
STATE='${state}'
printf 'tmux' >> "$LOG"
for a in "$@"; do printf ' %s' "$a" >> "$LOG"; done
printf '\\n' >> "$LOG"

subcmd=
expect=
for a in "$@"; do
  if [ -n "$expect" ]; then expect=; continue; fi
  case "$a" in
    -S) expect=1 ;;
    -*) ;;
    *) subcmd=$a; break ;;
  esac
done

target=
session=
prev=
for a in "$@"; do
  case "$prev" in
    -t) target=$a ;;
    -s) session=$a ;;
  esac
  prev=$a
done

case "$subcmd" in
  has-session)
    name=\${target#=}
    [ -f "$STATE" ] || exit 1
    grep -Fxq "$name" "$STATE" || exit 1
    ;;
  list-sessions)
    if [ -f "$STATE" ] && [ -s "$STATE" ]; then
      cat "$STATE"
    else
      exit 1
    fi
    ;;
  new-session)
    if [ -n "$session" ]; then
      mkdir -p "\$(dirname "$STATE")"
      echo "$session" >> "$STATE"
    fi
    ;;
esac
exit 0
`;

const DUMB = (name: string, log: string) => `#!/bin/sh
printf '%s' "${name}" >> "${log}"
for a in "$@"; do printf ' %s' "$a" >> "${log}"; done
printf '\\n' >> "${log}"
`;

export function fakeBin(names: string[]): FakeBin {
  const dir = mkdtempSync(join(tmpdir(), "wt-fakebin-"));
  const log = join(dir, "mux.log");
  const state = join(dir, "tmux-state");
  for (const name of names) {
    const path = join(dir, name);
    const script = name === "tmux" ? SMART_TMUX(log, state) : DUMB(name, log);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
  return { dir, log, state };
}

export function readLog(log: string): string {
  try {
    return require("node:fs").readFileSync(log, "utf8") as string;
  } catch {
    return "";
  }
}

export type CliResult = { exitCode: number; stdout: string; stderr: string };

export async function runCli(
  binPath: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<CliResult> {
  const env: Record<string, string> = {};
  const base = opts.env ?? process.env;
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined) env[k] = v;
  }
  const proc = Bun.spawn([binPath, ...args], {
    cwd: opts.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

export function cleanRepo(repo: string): void {
  spawnSync("rm", ["-rf", repo]);
}
