---
description: Open a git worktree in a new tmux/zellij window running the user's editor
---

# /wt — jump to a worktree

Use the `wt` CLI to list or switch worktrees. It spawns a new tmux/zellij window running `$EDITOR` (or `$WT_CMD`) at the worktree's path — the user can alt-tab to it.

## Commands

- `wt list` — tab-separated path / branch / flags
- `wt list --json` — same, as JSON (pipe to `jq` if you need to filter)
- `wt switch <branch|path>` — open that worktree in a new mux window
- `wt root` — open the main (root) worktree in a new mux window
- `wt current` — print the worktree containing the current directory

## When to use

- Just created a worktree with `git worktree add` → run `wt switch <branch>` so the user can edit it.
- User asks "show me my worktrees" → `wt list`.
- User asks to open a worktree they already have → `wt switch <name>`.

## Running from outside the user's mux

You (Claude) run outside the user's tmux pane, so `$TMUX` is empty. Just call `wt switch <branch>` — `wt` will pick a session automatically:

1. Cache at `$XDG_STATE_HOME/wt/session` (if alive).
2. First existing tmux session.
3. Cold-start `tmux new-session -d -s wt`.

If you want to pin a specific session, pass `WT_TMUX_TARGET=<name>`:

```sh
WT_TMUX_TARGET=0 wt switch feat        # target session "0"
WT_TMUX_TARGET=main:3 wt switch feat   # explicit session:window form
```

Bare session names like `0` are normalized to `0:` — pass them as-is.

## Constraints

- Does **not** create worktrees. Use `git worktree add` first, then `wt switch`.
- If tmux isn't installed and the user isn't already in a mux, `wt switch` will fail — there's nothing to spawn into.
