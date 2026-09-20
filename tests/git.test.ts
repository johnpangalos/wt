import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  listWorktrees,
  repoRoot,
  parsePorcelain,
  addWorktree as gitAddWorktree,
} from "../src/git";
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

describe("git.addWorktree", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  // Both cases would die on "unknown switch" without the `--` separator, since
  // git reads the leading dash as the start of an option.
  it("passes a dash-leading path through for a new branch", async () => {
    const repo = makeRepo();
    repos.push(repo);
    await gitAddWorktree(repo, "dashy-new", "-dashy-new");
    const entries = await listWorktrees(repo);
    expect(entries.map((e) => e.branch)).toContain("dashy-new");
    expect(entries.some((e) => e.path === join(repo, "-dashy-new"))).toBe(true);
  });

  it("passes a dash-leading path through for an existing branch", async () => {
    const repo = makeRepo();
    repos.push(repo);
    spawnSync("git", ["-C", repo, "branch", "already-there"]);
    await gitAddWorktree(repo, "already-there", "-dashy-existing");
    const entries = await listWorktrees(repo);
    const added = entries.find((e) => e.path === join(repo, "-dashy-existing"));
    expect(added?.branch).toBe("already-there");
    expect(added?.detached).toBe(false);
  });

  it("throws rather than letting a dash-leading branch act as a git flag", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const dest = join(repo, "detached-please");
    await expect(gitAddWorktree(repo, "--detach", dest)).rejects.toThrow();
    const entries = await listWorktrees(repo);
    expect(entries).toHaveLength(1);
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
