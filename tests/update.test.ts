import { describe, it, expect } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { fakeBin, readLog } from "./helpers";

const UPDATE_MODULE = resolve(import.meta.dir, "..", "src", "update.ts");

/**
 * Fake `curl` + `sh` on a scratch PATH. `curl` logs its argv so we can assert
 * the installer is downloaded to a file rather than piped into a shell; `sh`
 * logs its argv plus the env the installer actually receives.
 */
function fakeInstallerBins(curlExit = 0): { dir: string; log: string } {
  const fake = fakeBin([]);
  const curl = `#!/bin/sh
printf 'curl' >> "${fake.log}"
for a in "$@"; do printf ' %s' "$a" >> "${fake.log}"; done
printf '\\n' >> "${fake.log}"
[ ${curlExit} -eq 0 ] && : > "$3"
exit ${curlExit}
`;
  const sh = `#!/bin/sh
printf 'sh' >> "${fake.log}"
for a in "$@"; do printf ' %s' "$a" >> "${fake.log}"; done
printf ' [WT_VERSION=%s PREFIX=%s]\\n' "\${WT_VERSION-}" "\${PREFIX-}" >> "${fake.log}"
`;
  for (const [name, body] of [
    ["curl", curl],
    ["sh", sh],
  ] as const) {
    const p = join(fake.dir, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
  return fake;
}

/**
 * Bun's shell resolves binaries against the PATH captured at process start, so
 * the fakes only take effect in a child process. Run `runInstaller` there and
 * report its return value back over stdout.
 */
async function runInstallerWith(
  fake: { dir: string },
  tag: string,
  prefix: string,
): Promise<number> {
  const src = `
import { runInstaller } from ${JSON.stringify(UPDATE_MODULE)};
const code = await runInstaller(${JSON.stringify(tag)}, ${JSON.stringify(prefix)});
console.log("WT_INSTALLER_EXIT:" + code);
`;
  const proc = Bun.spawn([process.execPath, "-e", src], {
    env: { PATH: `${fake.dir}:/usr/bin:/bin`, HOME: process.env.HOME ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const m = stdout.match(/WT_INSTALLER_EXIT:(-?\d+)/);
  if (!m?.[1]) throw new Error(`runInstaller produced no result: ${stdout}`);
  return Number(m[1]);
}

function curlLines(log: string): string[] {
  return log.split("\n").filter((l) => l.startsWith("curl "));
}

function downloadTarget(curlLine: string): string {
  return curlLine.split(" -o ")[1]?.split(" ")[0] ?? "";
}

describe("update.runInstaller", () => {
  it("downloads the installer to a file and runs it without a shell pipe", async () => {
    const fake = fakeInstallerBins();
    const code = await runInstallerWith(fake, "wt-v9.9.9", "/tmp/wt-prefix");
    expect(code).toBe(0);

    const log = readLog(fake.log);
    const curlLine = curlLines(log)[0] ?? "";
    const shLine = log.split("\n").find((l) => l.startsWith("sh ")) ?? "";

    // curl writes to a file (-o <path>); nothing is streamed into a shell.
    expect(curlLine).toContain(" -o ");
    expect(curlLine).not.toContain("|");
    expect(curlLine).toContain(
      "https://raw.githubusercontent.com/johnpangalos/wt/main/install.sh",
    );

    // sh runs that exact downloaded file, not stdin.
    const target = downloadTarget(curlLine);
    expect(target).not.toBe("");
    expect(shLine.split(" ")[1]).toBe(target);
  });

  it("passes the confirmed tag through as WT_VERSION so latest is not re-resolved", async () => {
    const fake = fakeInstallerBins();
    await runInstallerWith(fake, "wt-v1.2.3", "/tmp/wt-prefix");
    expect(readLog(fake.log)).toContain(
      "[WT_VERSION=wt-v1.2.3 PREFIX=/tmp/wt-prefix]",
    );
  });

  it("uses a fresh private temp dir and removes it afterwards", async () => {
    const fake = fakeInstallerBins();
    await runInstallerWith(fake, "wt-v1.2.3", "/tmp/wt-prefix");
    await runInstallerWith(fake, "wt-v1.2.3", "/tmp/wt-prefix");

    const targets = curlLines(readLog(fake.log)).map(downloadTarget);
    expect(targets).toHaveLength(2);
    // mkdtemp gives an unguessable, non-reused path per run
    expect(targets[0]).not.toBe(targets[1]);
    for (const t of targets) expect(await Bun.file(t).exists()).toBe(false);
  });

  it("does not execute anything when the download fails", async () => {
    const fake = fakeInstallerBins(22);
    const code = await runInstallerWith(fake, "wt-v1.2.3", "/tmp/wt-prefix");
    expect(code).not.toBe(0);

    const log = readLog(fake.log);
    expect(curlLines(log)).toHaveLength(1);
    expect(log.split("\n").filter((l) => l.startsWith("sh "))).toHaveLength(0);
  });
});
