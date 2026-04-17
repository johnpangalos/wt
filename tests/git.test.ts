import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { listWorktrees, repoRoot, parsePorcelain } from "../src/git";
import { makeRepo, addWorktree, cleanRepo } from "./helpers";

describe("git.parsePorcelain", () => {
  it("parses a minimal single-worktree block", () => {
    const input = [
      "worktree /repo",
      "HEAD abcdef0123456789",
      "branch refs/heads/main",
      "",
    ].join("\n");
    expect(parsePorcelain(input)).toEqual([
      {
        path: "/repo",
        head: "abcdef0123456789",
        branch: "main",
        bare: false,
        detached: false,
        locked: false,
      },
    ]);
  });

  it("surfaces detached/locked/bare flags", () => {
    const input = [
      "worktree /a",
      "HEAD aaaaaaaaaaaaaaaa",
      "detached",
      "",
      "worktree /b",
      "HEAD bbbbbbbbbbbbbbbb",
      "branch refs/heads/feat",
      "locked needs more coffee",
      "",
      "worktree /c",
      "bare",
      "",
    ].join("\n");
    const entries = parsePorcelain(input);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.detached).toBe(true);
    expect(entries[0]!.branch).toBe("");
    expect(entries[1]!.locked).toBe(true);
    expect(entries[1]!.branch).toBe("feat");
    expect(entries[2]!.bare).toBe(true);
  });
});

describe("git.listWorktrees", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("lists the main worktree for a fresh repo", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const entries = await listWorktrees(repo);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(repo);
    expect(entries[0]!.branch).toBe("main");
    expect(entries[0]!.bare).toBe(false);
  });

  it("includes linked worktrees", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const entries = await listWorktrees(repo);
    expect(entries).toHaveLength(2);
    const branches = entries.map((e) => e.branch).sort();
    expect(branches).toEqual(["feat", "main"]);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain(feat);
  });

  it("throws a helpful error outside a git repo", async () => {
    const tmp = "/tmp";
    await expect(listWorktrees(tmp)).rejects.toThrow(/not in a git repo|not a git/i);
  });
});

describe("git.repoRoot", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("returns the toplevel path from within the repo", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const sub = join(repo, "sub");
    spawnSync("mkdir", [sub]);
    writeFileSync(join(sub, "a.txt"), "x");
    const root = await repoRoot(sub);
    expect(root).toBe(repo);
  });

  it("returns null outside a git repo", async () => {
    const root = await repoRoot("/");
    expect(root).toBeNull();
  });
});
