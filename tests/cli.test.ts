import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { join, resolve } from "node:path";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { makeRepo, addWorktree, fakeBin, readLog, runCli, cleanRepo } from "./helpers";
import pkg from "../package.json";

const BIN = resolve(import.meta.dir, "..", "bin", "wt");

function baseEnv(fake: { dir: string }): Record<string, string> {
  return {
    PATH: `${fake.dir}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin`,
    HOME: process.env.HOME ?? "",
    XDG_STATE_HOME: fake.dir,
  };
}

beforeAll(() => {
  if (!existsSync(BIN)) {
    throw new Error(`bin/wt not built at ${BIN} — run "bun run build" first`);
  }
});

describe("cli: help and list", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("wt --help exits 0", async () => {
    const r = await runCli(BIN, ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("wt");
  });

  it("wt (no args) prints usage", async () => {
    const r = await runCli(BIN, []);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage");
  });

  it("wt list prints rows for main and linked worktrees", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const r = await runCli(BIN, ["list"], { cwd: repo });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("main");
    expect(r.stdout).toContain("feat");
  });

  it("wt list --json emits one object per worktree", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const r = await runCli(BIN, ["list", "--json"], { cwd: repo });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0]).toHaveProperty("path");
    expect(data[0]).toHaveProperty("branch");
    expect(data.map((x: { branch: string }) => x.branch).sort()).toEqual(["feat", "main"]);
  });
});

describe("cli: switch", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("switch <branch> invokes tmux with the worktree path", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux", "zellij"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), TMUX: "fake" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toContain(feat);
    expect(log).toMatch(/^tmux /);
  });

  it("switch by absolute path resolves to the worktree", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux", "zellij"]);
    const r = await runCli(BIN, ["switch", feat], {
      cwd: repo,
      env: { ...baseEnv(fake), TMUX: "fake" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toContain(feat);
  });

  it("switch <nonexistent> exits non-zero", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "nope-missing"], {
      cwd: repo,
      env: { ...baseEnv(fake), TMUX: "fake" },
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/nope-missing|not found/);
  });

  it("prefers zellij when only $ZELLIJ is set", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux", "zellij"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), ZELLIJ: "0" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toMatch(/^zellij /);
  });

  it("auto-spawns a 'wt' tmux session when no mux is detected", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: baseEnv(fake),
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toMatch(/new-session -d -s wt/);
    expect(log).toMatch(/new-window -t wt:/);
    expect(log).toContain(feat);
  });

  it("uses WT_TMUX_TARGET when $TMUX is unset", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_TMUX_TARGET: "my-sess" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toContain(feat);
    expect(log).toMatch(/-t my-sess:/);
  });

  it("passes WT_TMUX_SOCKET via -S", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: {
        ...baseEnv(fake),
        WT_TMUX_TARGET: "0",
        WT_TMUX_SOCKET: "/tmp/wt-sock",
      },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toMatch(/-S \/tmp\/wt-sock/);
  });

  it("normalizes bare WT_TMUX_TARGET to 'N:'", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_TMUX_TARGET: "0" },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toMatch(/-t 0:/);
  });

  it("preserves explicit session:window form", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_TMUX_TARGET: "main:3" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toMatch(/-t main:3/);
    expect(log).not.toMatch(/-t main:3:/);
  });

  it("$TMUX wins over WT_TMUX_TARGET", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: {
        ...baseEnv(fake),
        TMUX: "real",
        WT_TMUX_TARGET: "should-not-appear",
      },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).not.toMatch(/should-not-appear/);
  });

  it("uses WT_ZELLIJ_SESSION when $ZELLIJ is unset", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["zellij"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_ZELLIJ_SESSION: "my-zs" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toMatch(/-s my-zs/);
  });

  it("WT_CMD overrides default editor", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), TMUX: "fake", WT_CMD: "special-thing" },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toContain("special-thing");
  });

  it("$EDITOR is used when WT_CMD is unset", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), TMUX: "fake", EDITOR: "hx" },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toContain(" hx");
  });

  it("falls back to vi when WT_CMD and $EDITOR are unset", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), TMUX: "fake" },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toMatch(/ vi$/m);
  });
});

describe("cli: root", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("opens the main worktree from a linked worktree", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["root"], {
      cwd: feat,
      env: { ...baseEnv(fake), TMUX: "fake" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toContain(repo);
    expect(log).not.toContain(feat);
  });

  it("root uses WT_TMUX_TARGET outside tmux", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const r = await runCli(BIN, ["root"], {
      cwd: feat,
      env: { ...baseEnv(fake), WT_TMUX_TARGET: "main-sess" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toContain(repo);
    expect(log).toMatch(/-t main-sess:/);
  });
});

describe("cli: auto-spawn + cache", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("reuses cached session across two invocations", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    const env = baseEnv(fake);

    const r1 = await runCli(BIN, ["switch", "feat"], { cwd: repo, env });
    expect(r1.exitCode).toBe(0);
    const log1 = readLog(fake.log);
    expect(log1).toMatch(/new-session -d -s wt/);

    const r2 = await runCli(BIN, ["switch", "main"], { cwd: repo, env });
    expect(r2.exitCode).toBe(0);
    const log2 = readLog(fake.log);
    // The second invocation should NOT create another session
    const newSessionCount = (log2.match(/new-session -d -s wt/g) ?? []).length;
    expect(newSessionCount).toBe(1);
    // And it should have targeted the cached 'wt:' session
    expect(log2.split("\n").filter((l) => l.includes("new-window")).length).toBe(2);
  });

  it("picks the first existing tmux session when no cache is present", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    // Pre-populate existing sessions (no wt session)
    require("node:fs").writeFileSync(fake.state, "alpha\nbeta\n");
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: baseEnv(fake),
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toMatch(/new-window -t alpha:/);
    expect(log).not.toMatch(/new-session -d -s/);
  });

  it("recovers from a stale cache (session no longer exists)", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["tmux"]);
    // Pre-seed cache pointing at a ghost session
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(`${fake.dir}/wt`, { recursive: true });
    fs.writeFileSync(`${fake.dir}/wt/session`, JSON.stringify({ mux: "tmux", session: "ghost" }));
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: baseEnv(fake),
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    // has-session on 'ghost' fails → list-sessions returns empty → cold-start 'wt'
    expect(log).toMatch(/has-session -t =ghost/);
    expect(log).toMatch(/new-session -d -s wt/);
    expect(log).toMatch(/new-window -t wt:/);
  });
});

describe("cli: current", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("prints the containing worktree path", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const r = await runCli(BIN, ["current"], { cwd: feat });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(feat);
  });
});

describe("cli: version and update", () => {
  it("wt --version prints the package version", async () => {
    const r = await runCli(BIN, ["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(`v${pkg.version}`);
  });

  it("wt version (no dashes) also works", async () => {
    const r = await runCli(BIN, ["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(`v${pkg.version}`);
  });

  it("nag prints to stderr when cache reports a newer version", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "wt-state-"));
    mkdirSync(join(stateDir, "wt"), { recursive: true });
    const [major = "0", minor = "0", patch = "0"] = pkg.version.split(".");
    const bumped = `v${major}.${minor}.${Number(patch) + 1}`;
    writeFileSync(
      join(stateDir, "wt", "update-check"),
      `${Date.now()}\t${bumped}\n`,
    );
    const r = await runCli(BIN, ["--help"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        XDG_STATE_HOME: stateDir,
        // Do NOT pass WT_NO_UPDATE_CHECK — we want the nag to run.
        WT_NO_UPDATE_CHECK: "",
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/update available/);
    expect(r.stderr).toContain(bumped.slice(1));
  });

  it("nag stays silent when cache reports the current version", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "wt-state-"));
    mkdirSync(join(stateDir, "wt"), { recursive: true });
    writeFileSync(
      join(stateDir, "wt", "update-check"),
      `${Date.now()}\tv${pkg.version}\n`,
    );
    const r = await runCli(BIN, ["--help"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        XDG_STATE_HOME: stateDir,
        WT_NO_UPDATE_CHECK: "",
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});
