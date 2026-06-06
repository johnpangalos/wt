import { realpathSync } from "node:fs";
import type { Env } from "./mux";

export type AgentSession = {
  /** Working directory of the session — a worktree path once the agent moves in. */
  cwd: string;
  sessionId?: string;
  name?: string;
  status?: string;
  /** Set by `claude agents --json` when `status` is `waiting` (e.g. "permission prompt"). */
  waitingFor?: string;
};

/**
 * Parse the JSON array emitted by `claude agents --json`.
 *
 * Tolerant by design: malformed JSON, a non-array top level, or entries missing
 * `cwd` are dropped rather than thrown. We surface only the fields `wt` joins on
 * or displays; the rest (`pid`, `kind`, `startedAt`, ...) are ignored. `status`
 * is passed through verbatim instead of validated against an enum, so `wt` stays
 * correct as Claude Code's status vocabulary evolves.
 */
export function parseAgents(text: string): AgentSession[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const out: AgentSession[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.cwd !== "string" || rec.cwd === "") continue;
    const session: AgentSession = { cwd: rec.cwd };
    if (typeof rec.sessionId === "string") session.sessionId = rec.sessionId;
    if (typeof rec.name === "string") session.name = rec.name;
    if (typeof rec.status === "string") session.status = rec.status;
    if (typeof rec.waitingFor === "string") session.waitingFor = rec.waitingFor;
    out.push(session);
  }
  return out;
}

/**
 * Shell out to `claude agents --json` and return the live agent sessions.
 *
 * Best-effort: if Claude Code isn't installed (binary not on PATH), exits
 * non-zero, or prints something unparseable, we return an empty list rather than
 * failing. Agent awareness is additive — `wt` must keep working without it.
 */
export async function listAgents(env: Env): Promise<AgentSession[]> {
  let proc;
  try {
    proc = Bun.spawn(["claude", "agents", "--json"], {
      stdout: "pipe",
      stderr: "ignore",
      env,
    });
  } catch {
    // binary missing or not executable
    return [];
  }
  try {
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return [];
    return parseAgents(stdout);
  } catch {
    return [];
  }
}

function normalize(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Join worktrees with agent sessions on `worktree.path == agent.cwd`.
 *
 * Both sides are realpath-normalized so the match survives symlinked paths
 * (e.g. macOS `/tmp` → `/private/tmp`, `/var` → `/private/var`). The returned
 * map is keyed by the *original* worktree path so callers can look up directly
 * with `map.get(w.path)`.
 */
export function matchAgents(
  worktrees: { path: string }[],
  agents: AgentSession[],
): Map<string, AgentSession> {
  const byCwd = new Map<string, AgentSession>();
  for (const a of agents) byCwd.set(normalize(a.cwd), a);

  const out = new Map<string, AgentSession>();
  for (const w of worktrees) {
    const hit = byCwd.get(normalize(w.path));
    if (hit) out.set(w.path, hit);
  }
  return out;
}
