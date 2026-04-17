# wt

Pick and switch git worktrees from the shell. `wt switch <branch>` opens the worktree in a new tmux window (or zellij tab) running your `$EDITOR` — fresh cwd, fresh LSP, nothing leaking between branches.

Designed for workflows that create worktrees elsewhere (Claude Code, scripts, another terminal) and just want a fast way to jump into them.

## Requirements

- [Bun](https://bun.sh) 1.2+ (only to build; the compiled binary has no runtime dep)
- `git`
- `tmux` or `zellij`

## Install

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
wt switch feature-x     # open the feature-x worktree in a new mux window
wt switch /path/to/wt   # same, by path
wt root                 # open the main (root) worktree in a new mux window
wt current              # print the worktree containing $PWD
wt --help               # usage
```

## Configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `WT_CMD` | `$EDITOR` or `vi` | Command to spawn in the new window. |
| `WT_TMUX_PLACEMENT` | `new-window` | `new-window` \| `split-h` \| `split-v` |
| `WT_ZELLIJ_PLACEMENT` | `new-tab` | `new-tab` \| `new-pane` |
| `WT_TMUX_TARGET` | — | tmux session to target when `$TMUX` is unset (e.g. `0`). |
| `WT_TMUX_SOCKET` | — | tmux socket (`-S`), for non-default sockets. |
| `WT_ZELLIJ_SESSION` | — | zellij session to target when `$ZELLIJ` is unset. |

## Running from outside a mux (auto-spawn + cache)

When `wt` runs outside a tmux pane (Claude Code's Bash tool, a launchd job, etc.), `$TMUX` isn't set. `wt` picks a target automatically, in this order:

1. **Cache hit** — if `$XDG_STATE_HOME/wt/session` points at a still-running session, use it.
2. **First existing session** — otherwise, pick the first session from `tmux list-sessions` and cache it.
3. **Cold start** — otherwise, run `tmux new-session -d -s wt` and cache `wt`.

Attach later with `tmux attach -t wt` (or whichever name got cached).

You can override any of that:

```sh
WT_TMUX_TARGET=0 wt root                           # target tmux session "0"
WT_TMUX_TARGET=main:3 wt switch feat               # explicit session:window form
WT_TMUX_SOCKET=/tmp/my-sock WT_TMUX_TARGET=0 wt switch feat
WT_ZELLIJ_SESSION=main wt switch feat              # zellij equivalent
```

Bare values like `0` are normalized to `0:` so tmux treats them as session names, not window indices.

The cache lives at `$XDG_STATE_HOME/wt/session` (default `~/.local/state/wt/session`). Delete it to force re-resolution.

## From Claude Code

Drop [`claude/commands/wt.md`](claude/commands/wt.md) into `~/.claude/commands/` for a `/wt` slash command. Typical flow:

```
$ git worktree add ../repo-feat -b feat
$ WT_TMUX_TARGET=0 wt switch feat
```

A new tmux window pops open with your editor at the worktree's path — alt-tab to it.

## Development

```sh
bun install
bun run build          # produces bin/wt
bun test               # build + run all tests (45 tests)
bun run test:fast      # run tests against the last-built binary
bun run typecheck      # tsc --noEmit
```

Tests use real git repos in `$TMPDIR` and fake `tmux`/`zellij` binaries on `$PATH` that log their argv — no mocks of our own code.
