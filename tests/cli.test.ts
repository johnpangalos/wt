import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { join, resolve } from "node:path";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { makeRepo, addWorktree, fakeBin, fakeClaudeBin, readLog, runCli, cleanRepo } from "./helpers";
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

describe("cli: agent-aware list", () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) {
      const r = repos.pop();
      if (r) cleanRepo(r);
    }
  });

  it("annotates an agent-owned worktree with name and status", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin([]);
    fakeClaudeBin(
      fake.dir,
      JSON.stringify([
        { cwd: feat, sessionId: "sess-1", name: "brave-otter", status: "working" },
      ]),
    );
    const r = await runCli(BIN, ["list"], { cwd: repo, env: baseEnv(fake) });
    expect(r.exitCode).toBe(0);
    const featRow = r.stdout.split("\n").find((l) => l.startsWith(feat));
    expect(featRow).toBeDefined();
    const cols = featRow!.split("\t");
    expect(cols[2]).toContain("agent");
    expect(cols[3]).toBe("brave-otter");
    expect(cols[4]).toBe("working");
    // the non-agent main row is untouched (no extra columns)
    const mainRow = r.stdout.split("\n").find((l) => l.startsWith(repo + "\t"));
    expect(mainRow!.split("\t").length).toBe(3);
  });

  it("folds waitingFor into the human-readable status", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin([]);
    fakeClaudeBin(
      fake.dir,
      JSON.stringify([
        { cwd: feat, name: "n", status: "waiting", waitingFor: "permission prompt" },
      ]),
    );
    const r = await runCli(BIN, ["list"], { cwd: repo, env: baseEnv(fake) });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("waiting (permission prompt)");
  });

  it("list --json includes sessionId, name, status, and waitingFor", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin([]);
    fakeClaudeBin(
      fake.dir,
      JSON.stringify([
        {
          cwd: feat,
          sessionId: "sess-1",
          name: "brave-otter",
          status: "waiting",
          waitingFor: "input needed",
        },
      ]),
    );
    const r = await runCli(BIN, ["list", "--json"], { cwd: repo, env: baseEnv(fake) });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    const featObj = data.find((o) => o.path === feat)!;
    expect(featObj.flags).toContain("agent");
    expect(featObj.sessionId).toBe("sess-1");
    expect(featObj.name).toBe("brave-otter");
    expect(featObj.status).toBe("waiting");
    expect(featObj.waitingFor).toBe("input needed");
    // non-agent main row carries none of the agent keys
    const mainObj = data.find((o) => o.path === repo)!;
    expect(mainObj).not.toHaveProperty("sessionId");
    expect(mainObj).not.toHaveProperty("name");
    expect(mainObj.flags).not.toContain("agent");
  });

  it("leaves rows unaffected when no agent cwd matches a worktree", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin([]);
    fakeClaudeBin(
      fake.dir,
      JSON.stringify([{ cwd: "/somewhere/else", name: "ghost", status: "working" }]),
    );
    const r = await runCli(BIN, ["list"], { cwd: repo, env: baseEnv(fake) });
    expect(r.exitCode).toBe(0);
    for (const line of r.stdout.split("\n").filter(Boolean)) {
      expect(line.split("\t").length).toBe(3);
      expect(line).not.toContain("ghost");
    }
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

  it("switch <branch> drives Ghostty (osascript) with the worktree path in a new tab by default", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: baseEnv(fake),
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toMatch(/^osascript /);
    expect(log).toContain('tell application "Ghostty"');
    expect(log).toContain(`set initial working directory of cfg to "${feat}"`);
    expect(log).toContain("new tab with configuration cfg");
    expect(log).not.toContain("new window with configuration cfg");
  });

  it("switch by absolute path resolves to the worktree", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", feat], {
      cwd: repo,
      env: baseEnv(fake),
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toContain(feat);
  });

  it("switch <nonexistent> exits non-zero", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "nope-missing"], {
      cwd: repo,
      env: baseEnv(fake),
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/nope-missing|not found/);
  });

  it("WT_GHOSTTY_PLACEMENT=new-window opens a window", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_GHOSTTY_PLACEMENT: "new-window" },
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toContain("new window with configuration cfg");
    expect(log).not.toContain("new tab with configuration cfg");
  });

  it("WT_GHOSTTY_PLACEMENT=split-right splits the front window", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_GHOSTTY_PLACEMENT: "split-right" },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toContain("direction right");
  });

  it("unknown WT_GHOSTTY_PLACEMENT exits non-zero", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_GHOSTTY_PLACEMENT: "bogus" },
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/WT_GHOSTTY_PLACEMENT/);
  });

  it("WT_CMD overrides default editor", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), WT_CMD: "special-thing" },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toContain('set command of cfg to "special-thing"');
  });

  it("$EDITOR is used when WT_CMD is unset", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: { ...baseEnv(fake), EDITOR: "hx" },
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toContain('set command of cfg to "hx"');
  });

  it("falls back to vi when WT_CMD and $EDITOR are unset", async () => {
    const repo = makeRepo();
    repos.push(repo);
    const feat = addWorktree(repo, "feat");
    repos.push(feat);
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["switch", "feat"], {
      cwd: repo,
      env: baseEnv(fake),
    });
    expect(r.exitCode).toBe(0);
    expect(readLog(fake.log)).toContain('set command of cfg to "vi"');
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
    const fake = fakeBin(["osascript"]);
    const r = await runCli(BIN, ["root"], {
      cwd: feat,
      env: baseEnv(fake),
    });
    expect(r.exitCode).toBe(0);
    const log = readLog(fake.log);
    expect(log).toContain(repo);
    expect(log).not.toContain(feat);
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
