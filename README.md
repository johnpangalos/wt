# wt

Pick and switch git worktrees from the shell. `wt switch <branch>` opens the worktree in a new [Ghostty](https://ghostty.org) tab — a plain shell at the right path, fresh cwd, nothing leaking between branches. Set `WT_CMD` if you'd rather the tab launch straight into your editor.

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

Installs to `~/.local/bin/wt`. Override with `PREFIX=/usr/local`.

Resolving the latest release uses the [GitHub CLI](https://cli.github.com), so `gh` must be installed and authenticated (`gh auth login`) — this avoids the unauthenticated API rate limit that otherwise surfaces as a `403`. To install without `gh`, pin a version with `WT_VERSION=v0.1.0`, which skips the release lookup entirely.

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
wt switch feat          # same — prefix/substring match on the branch name
wt switch /path/to/wt   # same, by path
wt switch -c new-thing  # create the worktree if missing, then open it
wt switch               # re-open the worktree containing $PWD (= wt switch $(wt current))
wt switch feat --window # open in a new window instead of a tab
wt switch --split-right # split the front window with the current worktree
wt root                 # open the main (root) worktree in a new Ghostty tab
wt current              # print the worktree containing $PWD
wt update               # check GitHub for a new release and install it
wt --version            # print the installed version
wt --help               # usage
```

## Matching a worktree

`wt switch <target>` tries progressively looser matches and stops at the first
tier that hits: exact branch or path, then exact directory basename
(case-insensitive), then branch prefix, then branch or path substring. So
`wt switch tok` finds `claude/skill-token-opt`, while an exact branch name always
beats a substring hit on some longer one.

If a tier matches more than one worktree, `wt` refuses to guess — it exits
non-zero and prints the candidates:

```
$ wt switch feat
wt: 'feat' is ambiguous — matches 2 worktrees:
  feat-alpha	/repo-feat-alpha
  feat-beta	/repo-feat-beta
```

A target that matches nothing prints the full worktree list the same way. Both
mean a wrong guess costs one command instead of a `wt list` up front — which is
what lets the agent skill skip listing entirely.

## Creating worktrees

`wt switch -c <branch> [path]` (`--create`) creates the worktree first when it
doesn't exist yet, then opens it. It's idempotent: if a worktree for that branch
is already checked out, it just opens that one. An existing local branch is
checked out as-is; otherwise the branch is created with `git worktree add -b`.

Without an explicit `path`, the new worktree lands next to the repo root as
`<repo>-<branch>`, with `/` flattened to `-` — so `-c claude/fix-thing` in
`~/src/wt` creates `~/src/wt-claude-fix-thing`. Set `WT_WORKTREE_DIR` to put new
worktrees somewhere else.

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

`wt update` uses the [GitHub CLI](https://cli.github.com) (`gh api`) to check for a newer release, so it relies on your existing `gh` authentication and isn't subject to the unauthenticated API rate limit (which surfaces as a `403`). `gh` must be installed and authenticated (`gh auth login`). If a newer version exists, it prints `wt vCURRENT → vLATEST` and prompts for confirmation (pass `-y`/`--yes` to skip the prompt). On confirmation it downloads the release binary itself, checks its SHA256 against the release's `SHA256SUMS`, and only then replaces the running executable with an atomic rename. A mismatch, a missing checksum entry, or a failed download leaves the installed binary untouched. Note what the checksum does and does not prove: it shows the bytes arrived intact from the release, not that the release is authentic — whoever can publish a release can publish a matching `SHA256SUMS`. `install.sh` is still how you bootstrap a machine that has no `wt` yet; `wt update` no longer runs it.

To reduce friction, `wt` also runs a throttled background check (once per day) on every invocation and prints a single-line hint to stderr when a newer release is available:

```
wt: update available (0.1.0 → 0.2.0) — run: wt update
```

The cache lives at `$XDG_STATE_HOME/wt/update-check` (default `~/.local/state/wt/update-check`). Set `WT_NO_UPDATE_CHECK=1` to disable the background check entirely.

## Configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `WT_CMD` | — | Command to run in the new surface. Unset (the default) opens a plain shell; set it to e.g. `nvim` to launch straight into your editor. Its executable is resolved to an absolute path before being handed to Ghostty (see below). |
| `WT_GHOSTTY_PLACEMENT` | `new-tab` | `new-tab` \| `new-window` \| `split-right` \| `split-left` \| `split-down` \| `split-up` |
| `WT_WORKTREE_DIR` | beside the repo root | Parent directory for worktrees created by `wt switch -c`. |
| `WT_NO_UPDATE_CHECK` | — | set to any value to disable the daily background update check. |

`wt switch` and `wt root` also take a placement flag that overrides
`WT_GHOSTTY_PLACEMENT` for a single invocation: `--tab`, `--window`,
`--split-right`, `--split-left`, `--split-down`, `--split-up`, `--split` (alias
for `--split-right`), or `--placement <name>` / `-p <name>` for any of those
names.

> **`exec nvim: not found`?** (Only reachable with `WT_CMD` set.) Ghostty runs the surface command through a
> non-login shell, and because it's launched via AppleScript `activate` it
> inherits the macOS GUI launch `PATH` (`/usr/bin:/bin:…`), not your interactive
> shell `PATH`. A bare `nvim` installed under `/opt/homebrew/bin` would then fail
> to launch. `wt` runs from your shell with the full `PATH`, so it resolves the
> `WT_CMD` executable to an absolute path before handing it to Ghostty.
> A command that already contains a `/`, or whose executable isn't on your
> `PATH`, is passed through unchanged.

The `split-*` placements split the focused terminal of Ghostty's front window in
that direction, so they only do something useful when a Ghostty window already
exists. `new-tab` (the default) and `new-window` always work — AppleScript
launches Ghostty first if it isn't running. A new tab joins the front window if
one is open, or opens the first window otherwise.

> **Note:** Ghostty's `new tab`/`new window` AppleScript handlers open the
> surface but return `errAEEventNotHandled` (-1708), so `osascript` exits
> non-zero with `Ghostty got an error: Can't continue new tab. (-1708)` even
> though the tab opened. `wt` recognizes that benign signature and treats it as
> success, so the spurious error no longer surfaces.

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
  new tab with configuration cfg
end tell
```

With `WT_CMD` set, a `set command of cfg to "/opt/homebrew/bin/nvim"` line joins
the configuration; without it the surface is left to Ghostty's default shell.

Because AppleScript addresses the running Ghostty app directly, this works the
same whether `wt` runs inside a Ghostty terminal or from somewhere with no TTY
at all (Claude Code's Bash tool, a launchd job, a script) — there's no session
to find or cache. If Ghostty isn't open, `activate` launches it.

## Agent skill (Claude Code & friends)

`wt` ships an [agent skill](skills/wt/SKILL.md) that teaches coding agents when
and how to use the CLI. It's deliberately small — the description carries the
everyday commands, `SKILL.md` is a few lines, and placement flags, env vars,
output formats, and platform constraints sit in
[`reference.md`](skills/wt/reference.md), which an agent only reads when it
needs them. Install it with Vercel's
[`skills` CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add johnpangalos/wt
```

The interactive prompt lets you pick which agents to install into (Claude Code,
Cursor, Codex, OpenCode, and many more). Non-interactive, e.g. for Claude Code
user-wide:

```sh
npx skills add johnpangalos/wt -a claude-code -g -y
```

Prefer manual installation? Copy the skill folder into your agent's skills
directory, e.g. for Claude Code:

```sh
cp -R skills/wt ~/.claude/skills/wt
```

### What an invocation costs in Claude Code

The skill is user-invocable as `/wt`, and it runs the command for you. `SKILL.md`
contains the line `` !`wt $ARGUMENTS` ``, which Claude Code expands *before* the
model sees the skill: `/wt switch feat` (or Claude calling the skill with
`switch feat`) runs `wt switch feat` during rendering, so the Ghostty tab is
already open and the output is already in the prompt. The model's only job is to
say what happened — one short turn, no tool call, no round trip. Without the
injected line an invocation costs two model turns plus a Bash call: load the
skill, compose the command, wait for the result, then reply.

A failed run (ambiguous or unknown branch, `wt` not installed) aborts the
invocation with `wt`'s own message, candidate worktrees included, and costs no
model turn at all. The `allowed-tools` grant covers `wt` so the injected command
never hits a permission prompt.

### Running inside a sandbox

Apple Events don't cross a sandbox boundary. Claude Code's Bash sandbox denies
the LaunchServices XPC service `com.apple.hiservices-xpcservice`, so `osascript`
can't resolve the Ghostty target and AppleScript reports `Ghostty got an error:
Application isn't running. (-600)` — even with Ghostty open in front of you. The
app state is a red herring, and no amount of starting Ghostty first helps: `wt`
recognizes that signature and says so instead of forwarding the raw osascript
noise.

The fix is to run `wt` outside the sandbox. In Claude Code, add it to
`sandbox.excludedCommands` in `~/.claude/settings.json`:

```json
{
  "sandbox": { "excludedCommands": ["wt:*"] },
  "permissions": { "allow": ["Bash(wt:*)"] }
}
```

The `:*` suffix is what makes the entry a prefix match. A bare `"wt"` is an
exact match — it covers `wt` alone, while `wt switch feat` still runs sandboxed
and still fails. The `permissions` entry keeps the now-unsandboxed command from
prompting, since `autoAllowBashIfSandboxed` only covers commands that stay
inside the sandbox.

The skill deliberately sets neither `model:` nor `effort:`. Claude Code applies
both to the rest of the turn that invoked the skill — including when Claude
invokes it itself mid-task — so a worktree opened halfway through a job would
leave the rest of that job running on the smaller model. If you only ever type
`/wt` yourself, add these lines to the frontmatter of your installed copy and the
one remaining turn runs on Haiku at low effort:

```yaml
model: haiku
effort: low
disable-model-invocation: true
```

`disable-model-invocation` is what makes the override safe: Claude can no longer
call the skill on its own. It also drops the skill's description from Claude's
context, so Claude won't know about `wt` unless you tell it.

The floor is zero model turns, and it needs no skill: type `! wt switch feat`
in Claude Code's shell mode. The command runs without going through Claude. By
default Claude still replies to the output; set `"respondToBashCommands": false`
in `settings.json` and it just lands in the transcript.

A forked subagent (`context: fork` with `model: haiku`) is not cheaper. The
subagent runs its own turn, and the main model still gets a turn to relay the
result, so it adds a call rather than removing one.

The `` !`…` `` line is a Claude Code feature. Other agents installed via `skills`
receive it as literal text; the skill's prose tells them to run `wt` themselves.

## Development

```sh
bun install
bun run build          # produces bin/wt
bun test               # build + run all tests
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

## License

Released into the public domain under the [Unlicense](LICENSE).
