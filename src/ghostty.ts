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
  /** Optional tab/window title; emitted via an OSC 2 sequence (see `wrapCmdWithTitle`). */
  title?: string;
};

export type Env = Record<string, string | undefined>;

/** Quote a string as an AppleScript double-quoted literal, escaping `\` and `"`. */
function asString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** POSIX single-quote a string so it survives as one literal shell word. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Strip control characters (incl. ESC/BEL/newlines) from a title.
 *
 * The title is written verbatim inside an OSC 2 sequence; a stray ESC or BEL
 * would terminate it early and let the rest bleed into the terminal stream.
 */
function sanitizeTitle(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Wrap `cmd` so the surface sets its tab/window title before running `cmd`.
 *
 * Ghostty's AppleScript surface configuration has no settable title, so we set
 * it the way any program does: write an `OSC 2 ; <title> BEL` sequence, then
 * exec the real command. Ghostty runs the surface command as `bash -c "exec
 * <cmd>"`, so the outer exec hands straight off to this bash — it prints the
 * title and execs the editor, leaving no extra shell behind.
 *
 * `printf` (inside the surface) interprets the `\033`/`\007` escapes, so the
 * literal backslashes just need to survive AppleScript quoting, which they do.
 * The title only sticks for programs that don't set their own (e.g. editors);
 * a shell with a prompt title hook will overwrite it.
 */
export function wrapCmdWithTitle(cmd: string, title: string): string {
  const script = `printf '\\033]2;%s\\007' ${shSingleQuote(sanitizeTitle(title))}; exec ${cmd}`;
  return `/bin/bash -c ${shSingleQuote(script)}`;
}

/**
 * Build the AppleScript that opens `args.cmd` at `args.path` in Ghostty.
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
    const cmd = args.title
      ? wrapCmdWithTitle(args.cmd, args.title)
      : args.cmd;
    lines.push(`  set command of cfg to ${asString(cmd)}`);
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

export async function spawnGhostty(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new Error("empty ghostty argv");
  const proc = Bun.spawn([cmd, ...rest], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    const msg = stderr.trim();
    if (isBenignGhosttyError(msg)) return;
    throw new Error(msg || `${cmd} exited ${code}`);
  }
}
