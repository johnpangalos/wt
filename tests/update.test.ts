import { describe, it, expect, afterEach } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assetName, parseSha256Sums, installRelease } from "../src/update";

const TAG = "wt-v9.9.9";
const ASSET = "wt-darwin-arm64";
const OLD = "old-binary-bytes\n";
const NEW = "new-binary-bytes\n";

function sha256(s: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(s);
  return h.digest("hex");
}

type Fixture = {
  /** Body served for the asset, or 404 when omitted. */
  asset?: string;
  /** Body served for SHA256SUMS, or 404 when omitted. */
  sums?: string;
};

type Server = { baseUrl: string; stop: () => void };

/**
 * Serve release fixtures from localhost so no test touches the real network.
 * Paths mirror GitHub's layout: `<base>/<tag>/<name>`.
 */
function serveRelease(fx: Fixture): Server {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const name = new URL(req.url).pathname.split("/").pop() ?? "";
      const body = name === ASSET ? fx.asset : name === "SHA256SUMS" ? fx.sums : undefined;
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(body);
    },
  });
  return {
    baseUrl: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

/** A stand-in for the installed binary — never the real bin/wt. */
function makeTarget(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-target-"));
  const target = join(dir, "wt");
  writeFileSync(target, OLD);
  chmodSync(target, 0o755);
  return target;
}

function siblings(target: string): string[] {
  return readdirSync(join(target, "..")).sort();
}

describe("update.assetName", () => {
  it("resolves the published darwin/arm64 asset", () => {
    expect(assetName("darwin", "arm64")).toBe(ASSET);
  });

  it("refuses platforms with no published build", () => {
    expect(() => assetName("darwin", "x64")).toThrow(/not supported/);
    expect(() => assetName("linux", "x64")).toThrow(/only runs on macOS/);
    expect(() => assetName("win32", "x64")).toThrow(/unsupported platform/);
  });
});

describe("update.parseSha256Sums", () => {
  const digest = "a".repeat(64);
  const other = "b".repeat(64);

  it("picks the exact entry when names overlap", () => {
    const text = [
      `${other}  wt-darwin-arm64.sig`,
      `${other}  xwt-darwin-arm64`,
      `${other}  wt-darwin-arm`,
      `${digest}  wt-darwin-arm64`,
      `${other}  wt-linux-x64`,
      "",
    ].join("\n");
    expect(parseSha256Sums(text, ASSET)).toBe(digest);
  });

  it("accepts binary-mode lines and normalizes case", () => {
    const upper = "A".repeat(64);
    expect(parseSha256Sums(`${upper} *${ASSET}\n`, ASSET)).toBe("a".repeat(64));
  });

  it("returns null when the asset is absent or the line is malformed", () => {
    expect(parseSha256Sums(`${digest}  wt-linux-x64\n`, ASSET)).toBeNull();
    expect(parseSha256Sums(`notahash  ${ASSET}\n`, ASSET)).toBeNull();
    expect(parseSha256Sums("", ASSET)).toBeNull();
  });
});

describe("update.installRelease", () => {
  const servers: Server[] = [];
  afterEach(() => {
    while (servers.length) servers.pop()?.stop();
  });

  function serve(fx: Fixture): string {
    const s = serveRelease(fx);
    servers.push(s);
    return s.baseUrl;
  }

  function run(baseUrl: string, target: string): Promise<number> {
    return installRelease(TAG, {
      baseUrl,
      target,
      platform: "darwin",
      arch: "arm64",
    });
  }

  it("replaces the target when the checksum matches", async () => {
    const target = makeTarget();
    const baseUrl = serve({ asset: NEW, sums: `${sha256(NEW)}  ${ASSET}\n` });

    expect(await run(baseUrl, target)).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(NEW);
    // still executable after the atomic replace
    expect(statSync(target).mode & 0o111).toBeGreaterThan(0);
    // no staging file left behind next to it
    expect(siblings(target)).toEqual(["wt"]);
  });

  it("refuses on checksum mismatch and leaves the target untouched", async () => {
    const target = makeTarget();
    // SHA256SUMS advertises a different payload than the one served
    const baseUrl = serve({ asset: NEW, sums: `${sha256("something-else")}  ${ASSET}\n` });

    expect(await run(baseUrl, target)).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(OLD);
    expect(siblings(target)).toEqual(["wt"]);
  });

  it("refuses when the asset has no SHA256SUMS entry", async () => {
    const target = makeTarget();
    const baseUrl = serve({ asset: NEW, sums: `${sha256(NEW)}  wt-linux-x64\n` });

    expect(await run(baseUrl, target)).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(OLD);
    expect(siblings(target)).toEqual(["wt"]);
  });

  it("refuses when the binary download fails", async () => {
    const target = makeTarget();
    const baseUrl = serve({ sums: `${sha256(NEW)}  ${ASSET}\n` }); // asset 404s

    expect(await run(baseUrl, target)).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(OLD);
    expect(siblings(target)).toEqual(["wt"]);
  });

  it("refuses when SHA256SUMS download fails", async () => {
    const target = makeTarget();
    const baseUrl = serve({ asset: NEW }); // SHA256SUMS 404s

    expect(await run(baseUrl, target)).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(OLD);
    expect(siblings(target)).toEqual(["wt"]);
  });

  it("refuses on an unsupported platform without downloading anything", async () => {
    const target = makeTarget();
    const baseUrl = serve({ asset: NEW, sums: `${sha256(NEW)}  ${ASSET}\n` });

    const code = await installRelease(TAG, {
      baseUrl,
      target,
      platform: "linux",
      arch: "x64",
    });
    expect(code).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(OLD);
  });
});
