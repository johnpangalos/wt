import { describe, it, expect } from "bun:test";
import type { SessionIO, CachedTarget } from "../src/session";
import { resolveMuxTarget } from "../src/session";

type Env = Record<string, string | undefined>;

function mkIO(init: {
  cache?: CachedTarget | null;
  alive?: Set<string>;
  sessions?: string[];
  newSessionThrows?: boolean;
}): { io: SessionIO; calls: string[]; cacheOut: CachedTarget | null } {
  const calls: string[] = [];
  let cache = init.cache ?? null;
  const alive = init.alive ?? new Set<string>();
  const sessions = init.sessions ?? [];
  const io: SessionIO = {
    readCache() {
      calls.push("readCache");
      return cache;
    },
    writeCache(t) {
      calls.push(`writeCache:${t.session}`);
      cache = t;
    },
    async tmuxListSessions() {
      calls.push("listSessions");
      return [...sessions];
    },
    async tmuxHasSession(name) {
      calls.push(`hasSession:${name}`);
      return alive.has(name);
    },
    async tmuxNewSession(name) {
      calls.push(`newSession:${name}`);
      if (init.newSessionThrows) throw new Error("new-session failed");
      sessions.unshift(name);
      alive.add(name);
    },
  };
  return {
    io,
    calls,
    get cacheOut() {
      return cache;
    },
  } as { io: SessionIO; calls: string[]; cacheOut: CachedTarget | null };
}

describe("session.resolveMuxTarget", () => {
  it("short-circuits when $TMUX is set", async () => {
    const env: Env = { TMUX: "x" };
    const { io, calls } = mkIO({});
    const out = await resolveMuxTarget(env, io);
    expect(out).toBe(env);
    expect(calls).toEqual([]);
  });

  it("short-circuits when $ZELLIJ is set", async () => {
    const env: Env = { ZELLIJ: "0" };
    const { io, calls } = mkIO({});
    const out = await resolveMuxTarget(env, io);
    expect(out).toBe(env);
    expect(calls).toEqual([]);
  });

  it("short-circuits when WT_TMUX_TARGET is set", async () => {
    const env: Env = { WT_TMUX_TARGET: "main:3" };
    const { io, calls } = mkIO({});
    const out = await resolveMuxTarget(env, io);
    expect(out).toBe(env);
    expect(calls).toEqual([]);
  });

  it("short-circuits when WT_ZELLIJ_SESSION is set", async () => {
    const env: Env = { WT_ZELLIJ_SESSION: "foo" };
    const { io, calls } = mkIO({});
    const out = await resolveMuxTarget(env, io);
    expect(out).toBe(env);
    expect(calls).toEqual([]);
  });

  it("uses cache when the cached session is alive", async () => {
    const env: Env = {};
    const { io, calls } = mkIO({
      cache: { mux: "tmux", session: "cached" },
      alive: new Set(["cached"]),
    });
    const out = await resolveMuxTarget(env, io);
    expect(out.WT_TMUX_TARGET).toBe("cached");
    expect(calls).toEqual(["readCache", "hasSession:cached"]);
  });

  it("discards stale cache and picks existing session", async () => {
    const env: Env = {};
    const result = mkIO({
      cache: { mux: "tmux", session: "ghost" },
      alive: new Set(),
      sessions: ["first", "second"],
    });
    const out = await resolveMuxTarget(env, result.io);
    expect(out.WT_TMUX_TARGET).toBe("first");
    expect(result.calls).toEqual([
      "readCache",
      "hasSession:ghost",
      "listSessions",
      "writeCache:first",
    ]);
  });

  it("picks first existing session when there is no cache", async () => {
    const env: Env = {};
    const result = mkIO({ sessions: ["alpha", "beta"] });
    const out = await resolveMuxTarget(env, result.io);
    expect(out.WT_TMUX_TARGET).toBe("alpha");
    expect(result.calls).toEqual(["readCache", "listSessions", "writeCache:alpha"]);
  });

  it("cold-starts a 'wt' session when nothing is running", async () => {
    const env: Env = {};
    const result = mkIO({ sessions: [] });
    const out = await resolveMuxTarget(env, result.io);
    expect(out.WT_TMUX_TARGET).toBe("wt");
    expect(result.calls).toEqual([
      "readCache",
      "listSessions",
      "newSession:wt",
      "writeCache:wt",
    ]);
  });

  it("propagates newSession errors", async () => {
    const env: Env = {};
    const { io } = mkIO({ sessions: [], newSessionThrows: true });
    await expect(resolveMuxTarget(env, io)).rejects.toThrow(/new-session/);
  });
});
