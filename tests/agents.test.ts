import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseAgents, matchAgents, listAgents } from "../src/agents";
import { fakeClaudeBin } from "./helpers";

describe("agents.parseAgents", () => {
  it("parses a full session entry", () => {
    const json = JSON.stringify([
      {
        pid: 123,
        kind: "background",
        startedAt: "2026-06-06T00:00:00Z",
        cwd: "/repo/.claude/worktrees/abc",
        sessionId: "sess-1",
        name: "brave-otter",
        status: "working",
      },
    ]);
    expect(parseAgents(json)).toEqual([
      {
        cwd: "/repo/.claude/worktrees/abc",
        sessionId: "sess-1",
        name: "brave-otter",
        status: "working",
      },
    ]);
  });

  it("keeps waitingFor when status is waiting", () => {
    const json = JSON.stringify([
      { cwd: "/w", status: "waiting", waitingFor: "permission prompt" },
    ]);
    expect(parseAgents(json)[0]).toEqual({
      cwd: "/w",
      status: "waiting",
      waitingFor: "permission prompt",
    });
  });

  it("omits optional fields that are absent or non-string", () => {
    const json = JSON.stringify([{ cwd: "/w", name: 42, status: null }]);
    expect(parseAgents(json)).toEqual([{ cwd: "/w" }]);
  });

  it("drops entries without a usable cwd", () => {
    const json = JSON.stringify([
      { sessionId: "no-cwd" },
      { cwd: "" },
      { cwd: "/keep" },
      null,
      "string",
      42,
    ]);
    expect(parseAgents(json)).toEqual([{ cwd: "/keep" }]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseAgents("not json")).toEqual([]);
    expect(parseAgents("")).toEqual([]);
  });

  it("returns [] when the top level is not an array", () => {
    expect(parseAgents('{"cwd":"/w"}')).toEqual([]);
    expect(parseAgents("42")).toEqual([]);
  });
});

describe("agents.matchAgents", () => {
  it("joins worktrees to agents on path == cwd", () => {
    const worktrees = [{ path: "/repo" }, { path: "/repo/wt/a" }];
    const agents = [
      { cwd: "/repo/wt/a", sessionId: "s1", name: "agent-a", status: "working" },
    ];
    const map = matchAgents(worktrees, agents);
    expect(map.size).toBe(1);
    expect(map.get("/repo/wt/a")?.name).toBe("agent-a");
    expect(map.has("/repo")).toBe(false);
  });

  it("keys the result by the original worktree path", () => {
    const worktrees = [{ path: "/repo/wt/a" }];
    const agents = [{ cwd: "/repo/wt/a" }];
    expect([...matchAgents(worktrees, agents).keys()]).toEqual(["/repo/wt/a"]);
  });

  it("returns an empty map when nothing matches", () => {
    const map = matchAgents([{ path: "/repo" }], [{ cwd: "/elsewhere" }]);
    expect(map.size).toBe(0);
  });
});

describe("agents.listAgents", () => {
  it("returns [] when the claude binary is absent", async () => {
    const agents = await listAgents({ PATH: "/nonexistent-xyz", HOME: "" });
    expect(agents).toEqual([]);
  });

  it("parses output from claude agents --json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-claude-"));
    fakeClaudeBin(
      dir,
      JSON.stringify([
        { cwd: "/repo/wt/a", sessionId: "s1", name: "n1", status: "working" },
      ]),
    );
    const agents = await listAgents({ PATH: `${dir}:/bin:/usr/bin`, HOME: process.env.HOME });
    expect(agents).toEqual([
      { cwd: "/repo/wt/a", sessionId: "s1", name: "n1", status: "working" },
    ]);
  });

  it("returns [] when claude prints junk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-claude-"));
    fakeClaudeBin(dir, "not json at all");
    const agents = await listAgents({ PATH: `${dir}:/bin:/usr/bin`, HOME: process.env.HOME });
    expect(agents).toEqual([]);
  });
});
