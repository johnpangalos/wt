import type { Worktree } from "./types";

export function parsePorcelain(text: string): Worktree[] {
  const entries: Worktree[] = [];
  let cur: Partial<Worktree> | null = null;

  const flush = () => {
    if (cur && cur.path) {
      entries.push({
        path: cur.path,
        head: cur.head ?? "",
        branch: cur.branch ?? "",
        bare: cur.bare ?? false,
        detached: cur.detached ?? false,
        locked: cur.locked ?? false,
      });
    }
    cur = null;
  };

  for (const line of text.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      cur = { path: line.slice("worktree ".length) };
    } else if (!cur) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      cur.branch = ref.replace(/^refs\/heads\//, "");
    } else if (line === "bare") {
      cur.bare = true;
    } else if (line === "detached") {
      cur.detached = true;
    } else if (line.startsWith("locked") || line === "locked") {
      cur.locked = true;
    }
  }
  flush();
  return entries;
}

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const root = await repoRoot(cwd);
  if (!root) throw new Error("not in a git repo");
  const { code, stdout, stderr } = await runGit(root, ["worktree", "list", "--porcelain"]);
  if (code !== 0) throw new Error(stderr.trim() || `git worktree list exited ${code}`);
  return parsePorcelain(stdout);
}

export async function repoRoot(cwd: string): Promise<string | null> {
  const { code, stdout } = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (code !== 0) return null;
  return stdout.trim() || null;
}

