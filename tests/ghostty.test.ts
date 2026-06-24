import { describe, it, expect } from "bun:test";
import {
  buildGhosttyScript,
  buildGhosttyCmd,
  absolutizeCmd,
} from "../src/ghostty";

const args = { path: "/r/feat", cmd: "nvim" };

describe("ghostty.buildGhosttyScript", () => {
  it("new-window: targets Ghostty with cwd + command", () => {
    const s = buildGhosttyScript(args, "new-window");
    expect(s).toContain('tell application "Ghostty"');
    expect(s).toContain("activate");
    expect(s).toContain("set cfg to new surface configuration");
    expect(s).toContain('set initial working directory of cfg to "/r/feat"');
    expect(s).toContain('set command of cfg to "nvim"');
    expect(s).toContain("new window with configuration cfg");
    expect(s).toContain("end tell");
  });

  it("new-tab uses the new tab command", () => {
    const s = buildGhosttyScript(args, "new-tab");
    expect(s).toContain("new tab with configuration cfg");
    expect(s).not.toContain("new window with configuration cfg");
  });

  it("split placements split the front window's terminal in the right direction", () => {
    expect(buildGhosttyScript(args, "split-right")).toContain(
      "split (terminal 1 of front window) direction right with configuration cfg",
    );
    expect(buildGhosttyScript(args, "split-down")).toContain(
      "direction down",
    );
    expect(buildGhosttyScript(args, "split-left")).toContain("direction left");
    expect(buildGhosttyScript(args, "split-up")).toContain("direction up");
  });

  it("omits the command line when cmd is empty", () => {
    const s = buildGhosttyScript({ path: "/r/feat", cmd: "" }, "new-window");
    expect(s).not.toContain("set command of cfg");
  });

  it("escapes quotes and backslashes in the path", () => {
    const s = buildGhosttyScript(
      { path: '/r/a "b"\\c', cmd: "vi" },
      "new-window",
    );
    expect(s).toContain(
      'set initial working directory of cfg to "/r/a \\"b\\"\\\\c"',
    );
  });
});

describe("ghostty.absolutizeCmd", () => {
  const lookup = (bin: string): string | null =>
    ({ nvim: "/opt/homebrew/bin/nvim", vi: "/usr/bin/vi" })[bin] ?? null;

  it("expands a bare executable to its absolute path", () => {
    expect(absolutizeCmd("nvim", lookup)).toBe("/opt/homebrew/bin/nvim");
  });

  it("resolves the executable but preserves arguments", () => {
    expect(absolutizeCmd("nvim -p .", lookup)).toBe("/opt/homebrew/bin/nvim -p .");
  });

  it("leaves a command that already contains a slash unchanged", () => {
    expect(absolutizeCmd("/usr/local/bin/nvim", lookup)).toBe(
      "/usr/local/bin/nvim",
    );
    expect(absolutizeCmd("./editor", lookup)).toBe("./editor");
  });

  it("falls back to the original command when the executable isn't found", () => {
    expect(absolutizeCmd("nonesuch", lookup)).toBe("nonesuch");
    expect(absolutizeCmd("nonesuch --flag", lookup)).toBe("nonesuch --flag");
  });

  it("trims surrounding whitespace before resolving", () => {
    expect(absolutizeCmd("  nvim  ", lookup)).toBe("/opt/homebrew/bin/nvim");
  });

  it("returns an empty command unchanged", () => {
    expect(absolutizeCmd("", lookup)).toBe("");
    expect(absolutizeCmd("   ", lookup)).toBe("   ");
  });
});

describe("ghostty.buildGhosttyCmd", () => {
  it("wraps the script in an osascript invocation", () => {
    const argv = buildGhosttyCmd(args, "new-window");
    expect(argv[0]).toBe("osascript");
    expect(argv[1]).toBe("-e");
    expect(argv[2]).toBe(buildGhosttyScript(args, "new-window"));
  });
});
