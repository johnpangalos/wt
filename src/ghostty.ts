export type GhosttyPlacement =
  | "new-window"
  | "new-tab"
  | "split-right"
  | "split-left"
  | "split-down"
  | "split-up";

export type SwitchArgs = {
  path: string;
  cmd: string;
};

export type Env = Record<string, string | undefined>;

/** Quote a string as an AppleScript double-quoted literal, escaping `\` and `"`. */
function asString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build the AppleScript that opens a Ghostty surface at `args.path`, running
 * `args.cmd` in it — or, when `args.cmd` is empty, leaving the surface to
 * Ghostty's default shell.
 *
 * Uses Ghostty's AppleScript dictionary (1.3+): a `surface configuration`
 * carries the working directory and command, then `new window` / `new tab` /
 * `split` consumes it. AppleScript talks to a running Ghostty from anywhere —
 * no session juggling — and `activate` launches Ghostty if it isn't open yet.
 */
export function buildGhosttyScript(
  args: SwitchArgs,
  placement: GhosttyPlacement,
): string {
  const lines = [
    `tell application "Ghostty"`,
    `  activate`,
    `  set cfg to new surface configuration`,
    `  set initial working directory of cfg to ${asString(args.path)}`,
  ];
  if (args.cmd) {
    lines.push(`  set command of cfg to ${asString(args.cmd)}`);
  }

  if (placement === "new-window") {
    lines.push(`  new window with configuration cfg`);
  } else if (placement === "new-tab") {
    lines.push(`  new tab with configuration cfg`);
  } else {
    // split-right | split-left | split-down | split-up
    const direction = placement.slice("split-".length);
    lines.push(
      `  split (terminal 1 of front window) direction ${direction} with configuration cfg`,
    );
  }

  lines.push(`end tell`);
  return lines.join("\n");
}

/**
 * Expand a command's executable to an absolute path via `lookup`.
 *
 * Ghostty runs the surface command through a non-login shell (`bash -c "exec
 * <cmd>"`), and because Ghostty is launched via AppleScript `activate` it
 * inherits the macOS GUI launch PATH (/usr/bin:/bin:...) rather than your
 * interactive shell PATH. A bare `nvim` therefore fails with
 * `exec nvim: not found`. `wt` runs from your shell with the full PATH, so we
 * resolve the binary here and hand Ghostty an absolute path.
 *
 * The first whitespace-delimited token is treated as the executable; any
 * arguments are preserved. A command whose executable already contains a slash,
 * or that can't be found via `lookup`, is returned unchanged.
 */
export function absolutizeCmd(
  cmd: string,
  lookup: (bin: string) => string | null,
): string {
  const trimmed = cmd.trim();
  if (!trimmed) return cmd;
  const sp = trimmed.search(/\s/);
  const bin = sp === -1 ? trimmed : trimmed.slice(0, sp);
  if (bin.includes("/")) return trimmed;
  const resolved = lookup(bin);
  if (!resolved) return trimmed;
  return sp === -1 ? resolved : resolved + trimmed.slice(sp);
}

export function buildGhosttyCmd(
  args: SwitchArgs,
  placement: GhosttyPlacement,
): string[] {
  return ["osascript", "-e", buildGhosttyScript(args, placement)];
}

/**
 * Whether an osascript failure is Ghostty's benign "command not handled" quirk.
 *
 * Ghostty's AppleScript `new tab` (and `new window`) handlers carry out the
 * action but return `errAEEventNotHandled` (-1708), so osascript exits non-zero
 * and prints e.g. `Ghostty got an error: Can't continue new tab. (-1708)` even
 * though the tab/window actually opened. Detect that signature so we don't
 * report a failure for an operation that succeeded.
 */
export function isBenignGhosttyError(stderr: string): boolean {
  return /\(-1708\)/.test(stderr) && /Can.t continue/.test(stderr);
}

/**
 * Whether an osascript failure means this process may not send Apple Events.
 *
 * A Seatbelt sandbox that denies the LaunchServices XPC service
 * (`com.apple.hiservices-xpcservice`) — Claude Code's Bash sandbox is one —
 * leaves osascript unable to resolve the Ghostty target at all, so AppleScript
 * reports `Application isn't running. (-600)` (or a `-10810` launch failure)
 * even while Ghostty is running in front of you. The app state is a red
 * herring: nothing `wt` does from inside such a process can reach Ghostty, so
 * say so instead of passing the raw osascript noise along.
 */
export function isBlockedAppleEventError(stderr: string): boolean {
  const blocked =
    /hiservices-xpcservice/.test(stderr) || /Connection invalid/i.test(stderr);
  return blocked && /\(-(?:600|10810)\)/.test(stderr);
}

export const BLOCKED_APPLE_EVENT_MESSAGE =
  "can't reach Ghostty: this process may not send Apple Events, so " +
  "osascript reports Ghostty as not running even when it is.\n" +
  "That's a sandbox restriction rather than a Ghostty problem — wt has to " +
  "run outside the sandbox.\n" +
  'In Claude Code, add "wt:*" to sandbox.excludedCommands in ' +
  '~/.claude/settings.json — the `:*` matters, since a bare "wt" entry only ' +
  "matches `wt` with no arguments.";

export async function spawnGhostty(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new Error("empty ghostty argv");
  const proc = Bun.spawn([cmd, ...rest], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    const msg = stderr.trim();
    if (isBenignGhosttyError(msg)) return;
    if (isBlockedAppleEventError(msg))
      throw new Error(BLOCKED_APPLE_EVENT_MESSAGE);
    throw new Error(msg || `${cmd} exited ${code}`);
  }
}
