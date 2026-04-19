import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import pkg from "../package.json";

export const VERSION: string = pkg.version;

const REPO = "johnpangalos/wt";
const DAY_MS = 24 * 60 * 60 * 1000;
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const INSTALL_URL = `https://raw.githubusercontent.com/${REPO}/main/install.sh`;

export type UpdateEnv = {
  HOME?: string;
  XDG_STATE_HOME?: string;
  WT_NO_UPDATE_CHECK?: string;
};

function cachePath(env: UpdateEnv): string | null {
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "wt", "update-check");
  if (env.HOME) return join(env.HOME, ".local/state", "wt", "update-check");
  return null;
}

type CacheEntry = { ts: number; tag: string };

function readCache(p: string): CacheEntry | null {
  try {
    const raw = readFileSync(p, "utf8").trim();
    const idx = raw.indexOf("\t");
    if (idx < 0) return null;
    const ts = Number(raw.slice(0, idx));
    const tag = raw.slice(idx + 1).trim();
    if (!Number.isFinite(ts) || !tag) return null;
    return { ts, tag };
  } catch {
    return null;
  }
}

function writeCache(p: string, entry: CacheEntry): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${entry.ts}\t${entry.tag}\n`);
}

function stripV(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function isNewer(latest: string, current: string): boolean {
  const a = stripV(latest).split(".").map((s) => Number(s));
  const b = stripV(current).split(".").map((s) => Number(s));
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (!Number.isFinite(ai) || !Number.isFinite(bi)) return false;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

async function fetchLatestTag(): Promise<string> {
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { "User-Agent": `wt/${VERSION}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`github api: ${res.status}`);
  const body = (await res.json()) as { tag_name?: unknown };
  if (typeof body.tag_name !== "string" || body.tag_name.length === 0) {
    throw new Error("no tag_name in response");
  }
  return body.tag_name;
}

export async function refreshCache(env: UpdateEnv): Promise<void> {
  const p = cachePath(env);
  if (!p) return;
  const tag = await fetchLatestTag();
  writeCache(p, { ts: Date.now(), tag });
}

export function maybeNag(env: UpdateEnv): void {
  if (env.WT_NO_UPDATE_CHECK && env.WT_NO_UPDATE_CHECK.length > 0) return;
  const p = cachePath(env);
  if (!p) return;
  const cache = readCache(p);
  const now = Date.now();
  if (cache && now - cache.ts < DAY_MS) {
    if (isNewer(cache.tag, VERSION)) {
      process.stderr.write(
        `wt: update available (${VERSION} → ${stripV(cache.tag)}) — run: wt update\n`,
      );
    }
    return;
  }
  try {
    const child = Bun.spawn([process.execPath, "__refresh-update-cache"], {
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env as Record<string, string>,
    });
    child.unref();
  } catch {
    // best-effort; never block
  }
}

function promptYes(): boolean {
  let fd: number | null = null;
  try {
    fd = openSync("/dev/tty", "r+");
    writeSync(fd, "install? [y/N] ");
    const buf = Buffer.alloc(128);
    const n = readSync(fd, buf, 0, buf.length, null);
    const answer = buf.slice(0, n).toString("utf8").trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export async function cmdUpdate(env: UpdateEnv): Promise<number> {
  let tag: string;
  try {
    tag = await fetchLatestTag();
  } catch (e) {
    process.stderr.write(
      `wt: update check failed: ${(e as Error).message}\n`,
    );
    return 1;
  }
  const latest = stripV(tag);
  if (!isNewer(tag, VERSION)) {
    process.stdout.write(`wt is up to date (v${VERSION})\n`);
    // refresh cache opportunistically so the nag disappears
    const p = cachePath(env);
    if (p) {
      try {
        writeCache(p, { ts: Date.now(), tag });
      } catch {
        // non-fatal
      }
    }
    return 0;
  }
  process.stdout.write(`wt v${VERSION} → v${latest}\n`);
  if (!promptYes()) {
    process.stdout.write("aborted.\n");
    return 0;
  }

  const binDir = dirname(process.execPath);
  const prefix = dirname(binDir);
  const result = Bun.spawnSync(
    ["sh", "-c", `curl -fsSL "${INSTALL_URL}" | sh`],
    {
      env: { ...(process.env as Record<string, string>), PREFIX: prefix },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const code = result.exitCode ?? 1;
  if (code === 0) {
    const p = cachePath(env);
    if (p) {
      try {
        writeCache(p, { ts: Date.now(), tag });
      } catch {
        // non-fatal
      }
    }
  }
  return code;
}
