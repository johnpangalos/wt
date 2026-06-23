# wt

Pick and switch git worktrees from the shell. `wt switch <branch>` opens the worktree in a new [Ghostty](https://ghostty.org) tab running your `$EDITOR` — fresh cwd, fresh LSP, nothing leaking between branches.

It drives Ghostty through its AppleScript dictionary, so `wt` can talk to a running Ghostty from anywhere — even when launched outside any terminal (Claude Code's Bash tool, a launchd job, a script). No session juggling: `wt switch` just opens a tab and Ghostty pops to the front.

Designed for workflows that create worktrees elsewhere (Claude Code, scripts, another terminal) and just want a fast way to jump into them.

## Requirements

- macOS (Ghostty's AppleScript support is macOS-only)
- `git`
- [Ghostty](https://ghostty.org) **1.3 or newer** (AppleScript support landed in 1.3)

## Install

macOS (Apple Silicon):

```sh
curl -fsSL https://raw.githubusercontent.com/johnpangalos/wt/main/install.sh | sh
```

Installs to `~/.local/bin/wt`. Override with `PREFIX=/usr/local` or pin a version with `WT_VERSION=v0.1.0`.

On first run, macOS may quarantine the unsigned binary. Clear it with:

```sh
xattr -d com.apple.quarantine ~/.local/bin/wt
```

## Build from source

Requires [Bun](https://bun.sh) 1.2+ (only to build; the compiled binary has no runtime dep).

```sh
git clone https://github.com/johnpangalos/wt.git
cd wt
bun install
bun run build                                        # produces ./bin/wt
ln -s "$PWD/bin/wt" "$HOME/.local/bin/wt"            # put it on $PATH
```

`bin/wt` is a self-contained native binary — Bun is not needed at runtime.

## Usage

```sh
wt list                 # list worktrees (TSV)
wt list --json          # list worktrees (JSON)
wt switch feature-x     # open the feature-x worktree in a new Ghostty tab
wt switch /path/to/wt   # same, by path
wt root                 # open the main (root) worktree in a new Ghostty tab
wt current              # print the worktree containing $PWD
wt update               # check GitHub for a new release and install it
wt --version            # print the installed version
wt --help               # usage
```

## Agent-aware listing

If [Claude Code](https://code.claude.com/docs/en/agent-view) is installed, `wt
list` joins `git worktree list` with `claude agents --json` on `path == cwd` and
annotates worktrees that belong to a background agent session. Agent rows gain an
`agent` flag plus two trailing columns — the session **name** and **status**
(with `waitingFor` folded in, e.g. `waiting (permission prompt)`):

```
/repo/.claude/worktrees/abc   feat-x   agent   brave-otter   waiting (permission prompt)
```

`wt list --json` adds `sessionId`, `name`, `status`, and `waitingFor` to those
rows when present. This is best-effort: if Claude Code isn't installed or no
agents are running, output is unchanged.

## Updating

`wt update` checks the GitHub releases API for a newer version. If one exists, it prints `wt vCURRENT → vLATEST` and prompts for confirmation before re-running `install.sh` with the same `PREFIX` the current binary was installed under.

To reduce friction, `wt` also runs a throttled background check (once per day) on every invocation and prints a single-line hint to stderr when a newer release is available:

```
wt: update available (0.1.0 → 0.2.0) — run: wt update
```

The cache lives at `$XDG_STATE_HOME/wt/update-check` (default `~/.local/state/wt/update-check`). Set `WT_NO_UPDATE_CHECK=1` to disable the background check entirely.

## Configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `WT_CMD` | `$EDITOR` or `vi` | Command to run in the new surface. |
| `WT_GHOSTTY_PLACEMENT` | `new-tab` | `new-tab` \| `new-window` \| `split-right` \| `split-left` \| `split-down` \| `split-up` |
| `WT_NO_UPDATE_CHECK` | — | set to any value to disable the daily background update check. |

The `split-*` placements split the focused terminal of Ghostty's front window in
that direction, so they only do something useful when a Ghostty window already
exists. `new-tab` (the default) and `new-window` always work — AppleScript
launches Ghostty first if it isn't running. A new tab joins the front window if
one is open, or opens the first window otherwise.

> **Tab/window titles:** Ghostty's AppleScript surface configuration exposes the
> working directory and command but not a settable title, so `wt` doesn't name
> the window/tab after the branch (the old tmux `-n` behavior). Ghostty titles
> surfaces from the running program / shell instead.

## How it works (AppleScript)

`wt switch` builds a short AppleScript and runs it with `osascript`:

```applescript
tell application "Ghostty"
  activate
  set cfg to new surface configuration
  set initial working directory of cfg to "/path/to/worktree"
  set command of cfg to "nvim"
  new tab with configuration cfg
end tell
```

Because AppleScript addresses the running Ghostty app directly, this works the
same whether `wt` runs inside a Ghostty terminal or from somewhere with no TTY
at all (Claude Code's Bash tool, a launchd job, a script) — there's no session
to find or cache. If Ghostty isn't open, `activate` launches it.

## From Claude Code

Drop [`claude/commands/wt.md`](claude/commands/wt.md) into `~/.claude/commands/` for a `/wt` slash command. Typical flow:

```
$ git worktree add ../repo-feat -b feat
$ wt switch feat
```

A new Ghostty tab pops open (Ghostty comes to the front) with your editor at
the worktree's path.

## Development

```sh
bun install
bun run build          # produces bin/wt
bun test               # build + run all tests (48 tests)
bun run test:fast      # run tests against the last-built binary
bun run typecheck      # tsc --noEmit
```

Tests use real git repos in `$TMPDIR` and a fake `osascript` on `$PATH` that logs its argv — no mocks of our own code, and nothing actually talks to Ghostty.

## Releases

Releases are automated by [release-please](https://github.com/googleapis/release-please). Commits to `main` must follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` — minor bump (while pre-1.0; major after 1.0)
- `fix: ...` — patch bump
- `feat!: ...` or a `BREAKING CHANGE:` footer — major bump
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `build:`, `perf:` — no bump; may appear in the changelog

release-please opens a `chore(main): release X.Y.Z` PR that bumps `package.json` and updates `CHANGELOG.md`. Merging that PR tags the release and the binary-upload workflow publishes `wt-darwin-arm64` and `SHA256SUMS` to the GitHub Release.
