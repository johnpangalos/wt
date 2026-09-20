import { describe, it, expect } from "bun:test";
import {
  buildGhosttyScript,
  buildGhosttyCmd,
  absolutizeCmd,
  isBenignGhosttyError,
  isBlockedAppleEventError,
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

describe("ghostty.isBenignGhosttyError", () => {
  it("treats Ghostty's -1708 'Can't continue new tab' as benign", () => {
    expect(
      isBenignGhosttyError(
        "243:273: execution error: Ghostty got an error: Can't continue new tab. (-1708)",
      ),
    ).toBe(true);
  });

  it("treats the same quirk for new window as benign", () => {
    expect(
      isBenignGhosttyError(
        "execution error: Ghostty got an error: Can't continue new window. (-1708)",
      ),
    ).toBe(true);
  });

  it("does not swallow other AppleScript errors", () => {
    expect(
      isBenignGhosttyError(
        "execution error: Ghostty got an error: Can't get terminal 1 of front window. (-1728)",
      ),
    ).toBe(false);
    expect(isBenignGhosttyError("osascript: command not found")).toBe(false);
  });
});

describe("ghostty.isBlockedAppleEventError", () => {
  const sandboxed = [
    "2026-09-20 13:32:13.791 osascript[8317:1018530] Connection Invalid error for service com.apple.hiservices-xpcservice.",
    "2026-09-20 13:32:13.791 osascript[8317:1018528] Error received in message reply handler: Connection invalid",
    "29:37: execution error: Ghostty got an error: Application isn\u2019t running. (-600)",
  ].join("\n");

  it("detects a sandbox blocking Apple Events", () => {
    expect(isBlockedAppleEventError(sandboxed)).toBe(true);
  });

  it("detects the -10810 launch failure with the same XPC signature", () => {
    expect(
      isBlockedAppleEventError(
        "osascript[1:2] Connection Invalid error for service com.apple.hiservices-xpcservice.\n40:44: execution error: An error of type -10810 has occurred. (-10810)",
      ),
    ).toBe(true);
  });

  it("leaves a plain -600 alone when nothing was blocked", () => {
    expect(
      isBlockedAppleEventError(
        "execution error: Ghostty got an error: Application isn\u2019t running. (-600)",
      ),
    ).toBe(false);
  });

  it("does not claim Ghostty's benign -1708 quirk", () => {
    expect(
      isBlockedAppleEventError(
        "execution error: Ghostty got an error: Can't continue new tab. (-1708)",
      ),
    ).toBe(false);
    expect(isBlockedAppleEventError("osascript: command not found")).toBe(false);
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
