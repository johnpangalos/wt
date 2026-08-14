import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { ReadStream, WriteStream } from "node:tty";
import { createInterface } from "node:readline/promises";
import { $ } from "bun";
import pkg from "../package.json";

export const VERSION: string = pkg.version;

const REPO = "johnpangalos/wt";
const DAY_MS = 24 * 60 * 60 * 1000;
const RELEASE_BASE = `https://github.com/${REPO}/releases/download`;
const SUMS_NAME = "SHA256SUMS";

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

/**
 * Release asset for a platform. Mirrors the platform gate in install.sh —
 * only one build is published, so anything else is a hard failure rather than
 * a guess at an asset name that does not exist.
 */
export function assetName(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  if (platform === "darwin" && arch === "arm64") return "wt-darwin-arm64";
  if (platform === "darwin") {
    throw new Error(
      `macOS ${arch} is not supported; build from source: https://github.com/${REPO}#build-from-source`,
    );
  }
  if (platform === "linux") {
    throw new Error("wt drives Ghostty via AppleScript and only runs on macOS");
  }
  throw new Error(`unsupported platform: ${platform}/${arch} (wt is macOS-only)`);
}

/**
 * Pull one asset's expected digest out of a `sha256sum`-generated SHA256SUMS.
 *
 * Format is `<64 hex><two spaces><filename>` (or `<hex> *<filename>` in binary
 * mode). The filename is compared for exact equality — a prefix match would
 * happily accept the digest of a *different* asset whose name merely starts
 * the same way.
 */
export function parseSha256Sums(text: string, asset: string): string | null {
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (!m || !m[1] || !m[2]) continue;
    if (m[2] === asset) return m[1].toLowerCase();
  }
  return null;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`${url}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    throw new Error(`${url}: HTTP ${status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex").toLowerCase();
}

/** Test seams — production callers pass nothing. */
export type InstallOptions = {
  /** Base URL for `<base>/<tag>/<asset>`. Defaults to the GitHub release CDN. */
  baseUrl?: string;
  /** Binary to replace. Defaults to the running executable. */
  target?: string;
  platform?: string;
  arch?: string;
};

/**
 * Download the release binary, verify its SHA256 against the release's
 * SHA256SUMS, and atomically replace the running executable.
 *
 * Done in-process on purpose: the previous implementation fetched install.sh
 * from the tip of `main` and ran it under `sh`, which made every `wt update`
 * trust whatever that branch happened to contain — including the checksum
 * check itself, the first thing an attacker with write access would delete.
 * install.sh remains for bootstrapping a machine that has no `wt` yet.
 *
 * Note the guarantee this does and does not give: the digest proves the bytes
 * arrived intact from the release, not that the release is authentic. Whoever
 * can publish a release can publish a matching SHA256SUMS; only signing or
 * build attestation closes that, and neither exists for this repo yet.
 */
export async function installRelease(
  tag: string,
  opts: InstallOptions = {},
): Promise<number> {
  let asset: string;
  try {
    asset = assetName(opts.platform, opts.arch);
  } catch (e) {
    process.stderr.write(`wt: ${(e as Error).message}\n`);
    return 1;
  }

  // Replace the real file, not a symlink pointing at it — renaming over the
  // link would silently detach the user's `wt` from wherever it points. If
  // realpath fails (dangling/unreadable path) fall back to execPath: updating
  // the path we were actually invoked as beats aborting.
  let target = opts.target;
  if (!target) {
    try {
      target = realpathSync(process.execPath);
    } catch {
      target = process.execPath;
    }
  }
  const dir = dirname(target);
  const base = opts.baseUrl ?? RELEASE_BASE;

  // Staged in the target's own directory: rename(2) is only atomic within a
  // filesystem, and ~/.local/bin is very often on a different mount from /tmp
  // (which would fail with EXDEV). The random suffix keeps the path
  // unpredictable, so it cannot be pre-created as a symlink.
  const tmp = join(dir, `.wt-update-${randomBytes(8).toString("hex")}`);

  try {
    process.stdout.write(`installing wt ${tag}...\n`);
    let bin: Uint8Array;
    let sumsText: string;
    try {
      const [binBytes, sumsBytes] = await Promise.all([
        fetchBytes(`${base}/${tag}/${asset}`),
        fetchBytes(`${base}/${tag}/${SUMS_NAME}`),
      ]);
      bin = binBytes;
      sumsText = new TextDecoder().decode(sumsBytes);
    } catch (e) {
      process.stderr.write(`wt: download failed: ${(e as Error).message}\n`);
      return 1;
    }

    const expected = parseSha256Sums(sumsText, asset);
    if (!expected) {
      process.stderr.write(
        `wt: no ${SUMS_NAME} entry for ${asset} in release ${tag} — refusing to install\n`,
      );
      return 1;
    }

    const actual = sha256Hex(bin);
    if (actual !== expected) {
      process.stderr.write(
        `wt: CHECKSUM MISMATCH for ${asset} — refusing to install\n` +
          `    expected ${expected}\n` +
          `    actual   ${actual}\n` +
          `    the download was corrupted or tampered with; nothing was changed\n`,
      );
      return 1;
    }

    // Past this point, and only past this point, the bytes are verified.
    try {
      writeFileSync(tmp, bin, { mode: 0o755 });
      chmodSync(tmp, 0o755); // writeFileSync's mode is masked by umask
      renameSync(tmp, target);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EACCES" || err.code === "EPERM" || err.code === "EROFS") {
        process.stderr.write(
          `wt: cannot replace ${target}: ${dir} is not writable by this user\n` +
            `    re-run with permission to write there (e.g. sudo wt update), or reinstall wt under a writable prefix\n`,
        );
      } else {
        process.stderr.write(`wt: failed to install ${target}: ${err.message}\n`);
      }
      return 1;
    }

    process.stdout.write(`installed: ${target}\n`);
    return 0;
  } finally {
    // No-op once the rename has consumed it; cleans up every failure path.
    rmSync(tmp, { force: true });
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

  const code = await installRelease(tag);
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
