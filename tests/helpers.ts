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

export type FakeBin = { dir: string; log: string };

const DUMB = (name: string, log: string) => `#!/bin/sh
printf '%s' "${name}" >> "${log}"
for a in "$@"; do printf ' %s' "$a" >> "${log}"; done
printf '\\n' >> "${log}"
`;

/**
 * Create a temp dir holding fake executables that log their argv to a shared
 * log file. Drop the dir on `$PATH` to intercept `osascript` (or any binary)
 * without running the real thing.
 */
export function fakeBin(names: string[]): FakeBin {
  const dir = mkdtempSync(join(tmpdir(), "wt-fakebin-"));
  const log = join(dir, "spawn.log");
  for (const name of names) {
    const path = join(dir, name);
    writeFileSync(path, DUMB(name, log));
    chmodSync(path, 0o755);
  }
  return { dir, log };
}

/**
 * Drop a fake `claude` into `dir` that prints `agentsJson` for `claude agents
 * --json` (and exits 0 for anything else). Lets tests exercise the
 * worktree↔agent join without a real Claude Code install.
 */
export function fakeClaudeBin(dir: string, agentsJson: string): void {
  const path = join(dir, "claude");
  const script = `#!/bin/sh
if [ "$1" = "agents" ]; then
  cat <<'WT_AGENTS_EOF'
${agentsJson}
WT_AGENTS_EOF
  exit 0
fi
exit 0
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
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
  // Tests must not spawn the background update-check child or hit GitHub.
  if (env.WT_NO_UPDATE_CHECK === undefined) env.WT_NO_UPDATE_CHECK = "1";
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
