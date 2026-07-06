import { describe, it, expect } from "bun:test";
import {
  buildGhosttyScript,
  buildGhosttyCmd,
  absolutizeCmd,
  isBenignGhosttyError,
  wrapCmdWithTitle,
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

  it("wraps the command to set the title when one is given", () => {
    const s = buildGhosttyScript(
      { path: "/r/feat", cmd: "nvim", title: "feat" },
      "new-tab",
    );
    // The command is the title-wrapping bash invocation, not the bare editor.
    expect(s).toContain("set command of cfg to");
    expect(s).toContain("/bin/bash -c");
    expect(s).toContain("]2;%s"); // OSC 2 template, title passed as a printf arg
    expect(s).toContain("feat"); // the branch title
    expect(s).toContain("exec nvim");
    expect(s).not.toContain('set command of cfg to "nvim"');
  });

  it("leaves the command bare when no title is given", () => {
    const s = buildGhosttyScript({ path: "/r/feat", cmd: "nvim" }, "new-tab");
    expect(s).toContain('set command of cfg to "nvim"');
  });

  it("does not wrap when the title is present but cmd is empty", () => {
    const s = buildGhosttyScript(
      { path: "/r/feat", cmd: "", title: "feat" },
      "new-tab",
    );
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

describe("ghostty.wrapCmdWithTitle", () => {
  const ESC = "\x1b";
  const BEL = "\x07";

  it("produces a single bash-c invocation that execs the command", () => {
    const w = wrapCmdWithTitle("nvim", "feat");
    expect(w.startsWith("/bin/bash -c '")).toBe(true);
    expect(w.endsWith("'")).toBe(true);
    expect(w).toContain("printf");
    expect(w).toContain("exec nvim");
  });

  /**
   * Run the wrapper exactly as Ghostty does — `bash -c "exec <cmd>"` — with the
   * real command swapped for a `printf` we can capture, so we can assert the OSC
   * bytes the surface would actually emit. This exercises the full quoting
   * pipeline, which is too fiddly to assert by eye.
   */
  function emittedTitle(title: string): string {
    const wrapped = wrapCmdWithTitle("printf END", title);
    const out = Bun.spawnSync(["/bin/bash", "-c", `exec ${wrapped}`]);
    return out.stdout.toString();
  }

  it("emits OSC 2 with the title, then runs the command", () => {
    expect(emittedTitle("feat")).toBe(`${ESC}]2;feat${BEL}END`);
  });

  it("survives titles with shell metacharacters and quotes", () => {
    expect(emittedTitle("fix 'it' now; rm -rf $HOME")).toBe(
      `${ESC}]2;fix 'it' now; rm -rf $HOME${BEL}END`,
    );
    expect(emittedTitle("feature/foo & bar")).toBe(
      `${ESC}]2;feature/foo & bar${BEL}END`,
    );
  });

  it("strips control characters that would break out of the OSC sequence", () => {
    expect(emittedTitle(`a${ESC}b${BEL}c\nd`)).toBe(`${ESC}]2;abcd${BEL}END`);
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

describe("ghostty.buildGhosttyCmd", () => {
  it("wraps the script in an osascript invocation", () => {
    const argv = buildGhosttyCmd(args, "new-window");
    expect(argv[0]).toBe("osascript");
    expect(argv[1]).toBe("-e");
    expect(argv[2]).toBe(buildGhosttyScript(args, "new-window"));
  });
});
