import { readFileSync, writeFileSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { ReadStream, WriteStream } from "node:tty";
import { createInterface } from "node:readline/promises";
import { $ } from "bun";
import pkg from "../package.json";

export const VERSION: string = pkg.version;

const REPO = "johnpangalos/wt";
const DAY_MS = 24 * 60 * 60 * 1000;
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

/** Longest tag we'll believe. Real tags are like "wt-v0.5.0" — 64 is generous. */
const MAX_TAG_LEN = 64;

/**
 * Characters a release tag may contain. Covers every shape `stripV` knows
 * ("wt-v0.5.0", "v0.5.0", "0.5.0") while excluding control bytes, escape
 * sequences, and whitespace.
 */
const TAG_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Read the update-check cache, treating its contents as untrusted input.
 *
 * The cache lives under `$XDG_STATE_HOME` (or `$HOME`), and `maybeNag` prints
 * the tag it holds straight to the terminal on every `wt` invocation. If that
 * directory is ever group- or world-writable, whoever can write the file gets
 * to choose bytes our stderr emits — an escape-sequence injection, and an
 * unbounded-length one. It's a narrow, local scenario that needs an unusual
 * `XDG_STATE_HOME`, but validating a short version string costs nothing, so we
 * do it rather than trust the file.
 *
 * Anything that fails validation — bad shape, a tag with control characters, an
 * over-long tag, a negative or far-future timestamp — is reported as `null`,
 * same as a missing file. `maybeNag` reads `null` as "no usable cache" and
 * spawns a background refresh, so a corrupt or poisoned entry is overwritten on
 * the next run instead of sticking around. A far-future `ts` is worth rejecting
 * for its own sake: left alone it keeps `now - ts < DAY_MS` true forever and
 * would freeze the update check permanently.
 */
function readCache(p: string): CacheEntry | null {
  try {
    const raw = readFileSync(p, "utf8").trim();
    const idx = raw.indexOf("\t");
    if (idx < 0) return null;
    const ts = Number(raw.slice(0, idx));
    const tag = raw.slice(idx + 1).trim();
    if (!Number.isInteger(ts) || ts < 0 || ts > Date.now() + DAY_MS) return null;
    if (!tag || tag.length > MAX_TAG_LEN || !TAG_RE.test(tag)) return null;
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
  // Releases are tagged with release-please's component prefix, e.g.
  // "wt-v0.3.2". Normalize "wt-v…", "wt-…", "v…", or a bare "X.Y.Z" down to
  // the plain version string so version comparison sees only digits.
  let t = tag.trim();
  if (t.startsWith("wt-")) t = t.slice(3);
  if (t.startsWith("v")) t = t.slice(1);
  return t;
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
  const gh = Bun.which("gh");
  if (!gh) {
    throw new Error("gh not found — install the GitHub CLI: https://cli.github.com");
  }
  const res = await $`${gh} api repos/${REPO}/releases/latest --jq .tag_name`
    .quiet()
    .nothrow();
  if (res.exitCode !== 0) {
    const detail = res.stderr.toString().trim() || `exit ${res.exitCode}`;
    throw new Error(`gh api: ${detail}`);
  }
  const tag = res.stdout.toString().trim();
  if (tag.length === 0) throw new Error("no tag_name in response");
  return tag;
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

async function promptYes(): Promise<boolean> {
  let input: ReadStream | null = null;
  let output: WriteStream | null = null;
  try {
    input = new ReadStream(openSync("/dev/tty", "r"));
    output = new WriteStream(openSync("/dev/tty", "w"));
  } catch {
    input?.destroy();
    output?.destroy();
    return false;
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("install? [y/N] ");
    const trimmed = answer.trim().toLowerCase();
    return trimmed === "y" || trimmed === "yes";
  } finally {
    rl.close();
    input.destroy();
    output.destroy();
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
  if (!(await promptYes())) {
    process.stdout.write("aborted.\n");
    return 0;
  }

  const binDir = dirname(process.execPath);
  const prefix = dirname(binDir);
  const result = await $`curl -fsSL ${INSTALL_URL} | sh`
    .env({ ...(process.env as Record<string, string>), PREFIX: prefix })
    .nothrow();
  const code = result.exitCode;
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
