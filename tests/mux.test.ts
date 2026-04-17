import { describe, it, expect } from "bun:test";
import { detect, buildTmuxCmd, buildZellijCmd } from "../src/mux";

type Env = Record<string, string | undefined>;

describe("mux.detect", () => {
  it("returns tmux when $TMUX is set", () => {
    expect(detect({ TMUX: "/tmp/tmux-1000/default,1234,0" })).toBe("tmux");
  });
  it("returns zellij when $ZELLIJ is set", () => {
    expect(detect({ ZELLIJ: "0" })).toBe("zellij");
  });
  it("prefers $TMUX over $ZELLIJ", () => {
    expect(detect({ TMUX: "x", ZELLIJ: "0" })).toBe("tmux");
  });
  it("falls back to WT_TMUX_TARGET when $TMUX is unset", () => {
    expect(detect({ WT_TMUX_TARGET: "0" })).toBe("tmux");
  });
  it("falls back to WT_ZELLIJ_SESSION when $ZELLIJ is unset", () => {
    expect(detect({ WT_ZELLIJ_SESSION: "main" })).toBe("zellij");
  });
  it("returns null when nothing is detected", () => {
    expect(detect({})).toBeNull();
  });
});

describe("mux.buildTmuxCmd", () => {
  const args = { path: "/r/feat", branch: "feat", cmd: "nvim" };

  it("inside tmux: plain new-window", () => {
    const env: Env = { TMUX: "x" };
    expect(buildTmuxCmd(env, args, "new-window")).toEqual([
      "tmux",
      "new-window",
      "-c",
      "/r/feat",
      "-n",
      "feat",
      "nvim",
    ]);
  });

  it("outside tmux with WT_TMUX_TARGET: adds -t <session:>", () => {
    const env: Env = { WT_TMUX_TARGET: "my-sess" };
    const argv = buildTmuxCmd(env, args, "new-window");
    const i = argv.indexOf("-t");
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe("my-sess:");
  });

  it("bare WT_TMUX_TARGET normalizes to 'N:'", () => {
    const env: Env = { WT_TMUX_TARGET: "0" };
    const argv = buildTmuxCmd(env, args, "new-window");
    const i = argv.indexOf("-t");
    expect(argv[i + 1]).toBe("0:");
  });

  it("explicit session:window form is preserved", () => {
    const env: Env = { WT_TMUX_TARGET: "main:3" };
    const argv = buildTmuxCmd(env, args, "new-window");
    const i = argv.indexOf("-t");
    expect(argv[i + 1]).toBe("main:3");
  });

  it("$TMUX wins over WT_TMUX_TARGET", () => {
    const env: Env = { TMUX: "real", WT_TMUX_TARGET: "should-not-appear" };
    const argv = buildTmuxCmd(env, args, "new-window");
    expect(argv).not.toContain("should-not-appear");
  });

  it("WT_TMUX_SOCKET adds -S <sock> before subcommand", () => {
    const env: Env = { WT_TMUX_TARGET: "0", WT_TMUX_SOCKET: "/tmp/sock" };
    const argv = buildTmuxCmd(env, args, "new-window");
    expect(argv[0]).toBe("tmux");
    expect(argv[1]).toBe("-S");
    expect(argv[2]).toBe("/tmp/sock");
    expect(argv[3]).toBe("new-window");
  });

  it("split-h placement uses split-window -h and omits -n", () => {
    const env: Env = { TMUX: "x" };
    const argv = buildTmuxCmd(env, args, "split-h");
    expect(argv).toEqual(["tmux", "split-window", "-h", "-c", "/r/feat", "nvim"]);
  });

  it("split-v placement uses split-window -v", () => {
    const env: Env = { TMUX: "x" };
    const argv = buildTmuxCmd(env, args, "split-v");
    expect(argv).toEqual(["tmux", "split-window", "-v", "-c", "/r/feat", "nvim"]);
  });
});

describe("mux.buildZellijCmd", () => {
  const args = { path: "/r/feat", branch: "feat", cmd: "nvim" };

  it("inside zellij: new-tab with --cwd, --name, cmd", () => {
    const env: Env = { ZELLIJ: "0" };
    const argv = buildZellijCmd(env, args, "new-tab");
    expect(argv).toEqual([
      "zellij",
      "action",
      "new-tab",
      "--cwd",
      "/r/feat",
      "--name",
      "feat",
      "--",
      "nvim",
    ]);
  });

  it("outside zellij with WT_ZELLIJ_SESSION: adds -s <session>", () => {
    const env: Env = { WT_ZELLIJ_SESSION: "my-sess" };
    const argv = buildZellijCmd(env, args, "new-tab");
    expect(argv[0]).toBe("zellij");
    expect(argv[1]).toBe("-s");
    expect(argv[2]).toBe("my-sess");
    expect(argv[3]).toBe("action");
  });

  it("new-pane placement doesn't take a name", () => {
    const env: Env = { ZELLIJ: "0" };
    const argv = buildZellijCmd(env, args, "new-pane");
    expect(argv).toEqual(["zellij", "action", "new-pane", "--cwd", "/r/feat", "--", "nvim"]);
  });
});
