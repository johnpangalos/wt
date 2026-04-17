import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Env } from "./mux";

export type CachedTarget = { mux: "tmux"; session: string };

export type SessionIO = {
  readCache(): CachedTarget | null;
  writeCache(t: CachedTarget): void;
  tmuxListSessions(): Promise<string[]>;
  tmuxHasSession(name: string): Promise<boolean>;
  tmuxNewSession(name: string): Promise<void>;
};

const DEFAULT_SESSION = "wt";

export function cachePath(env: Env): string {
  const base =
    env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0
      ? env.XDG_STATE_HOME
      : join(env.HOME ?? "", ".local/state");
  return join(base, "wt", "session");
}

export function defaultIO(env: Env): SessionIO {
  const file = cachePath(env);
  return {
    readCache() {
      try {
        const raw = readFileSync(file, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as { mux?: unknown }).mux === "tmux" &&
          typeof (parsed as { session?: unknown }).session === "string"
        ) {
          return parsed as CachedTarget;
        }
        return null;
      } catch {
        return null;
      }
    },
    writeCache(t) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(t));
    },
    async tmuxListSessions() {
      const p = Bun.spawn(["tmux", "list-sessions", "-F", "#S"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(p.stdout).text();
      const code = await p.exited;
      if (code !== 0) return [];
      return out.split("\n").filter((s) => s.length > 0);
    },
    async tmuxHasSession(name) {
      const p = Bun.spawn(["tmux", "has-session", "-t", `=${name}`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      return (await p.exited) === 0;
    },
    async tmuxNewSession(name) {
      const p = Bun.spawn(["tmux", "new-session", "-d", "-s", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(p.stderr).text();
      const code = await p.exited;
      if (code !== 0) {
        throw new Error(stderr.trim() || `tmux new-session exited ${code}`);
      }
    },
  };
}

export async function resolveMuxTarget(env: Env, io?: SessionIO): Promise<Env> {
  if (env.TMUX || env.ZELLIJ) return env;
  if (env.WT_TMUX_TARGET || env.WT_ZELLIJ_SESSION) return env;

  const sio = io ?? defaultIO(env);

  const cached = sio.readCache();
  if (cached && (await sio.tmuxHasSession(cached.session))) {
    return { ...env, WT_TMUX_TARGET: cached.session };
  }

  const sessions = await sio.tmuxListSessions();
  if (sessions.length > 0) {
    const name = sessions[0]!;
    sio.writeCache({ mux: "tmux", session: name });
    return { ...env, WT_TMUX_TARGET: name };
  }

  await sio.tmuxNewSession(DEFAULT_SESSION);
  sio.writeCache({ mux: "tmux", session: DEFAULT_SESSION });
  return { ...env, WT_TMUX_TARGET: DEFAULT_SESSION };
}
