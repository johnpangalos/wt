---
description: Open a git worktree in a new Ghostty tab running the user's editor
---

# /wt — jump to a worktree

Use the `wt` CLI to list or switch worktrees. It opens a new Ghostty tab (or
window/split) running `$EDITOR` (or `$WT_CMD`) at the worktree's path. `wt` drives
Ghostty through AppleScript, so it works even though you (Claude) run outside any
terminal — Ghostty pops to the front on the user's Mac.

## Commands

- `wt list` — tab-separated path / branch / flags
- `wt list --json` — same, as JSON (pipe to `jq` if you need to filter)
- `wt switch <branch|path>` — open that worktree in a new Ghostty tab
- `wt root` — open the main (root) worktree in a new Ghostty tab
- `wt current` — print the worktree containing the current directory

## When to use

- Just created a worktree with `git worktree add` → run `wt switch <branch>` so the user can edit it.
- User asks "show me my worktrees" → `wt list`.
- User asks to open a worktree they already have → `wt switch <name>`.

## How it opens windows

`wt switch` runs an AppleScript via `osascript` that tells Ghostty to open a new
surface with the worktree as its working directory and `$EDITOR` as its command.
There's no tmux/zellij session to target and no `$TMUX` to set — just call:

```sh
wt switch feat
```

By default this opens a new tab. Change the placement with `WT_GHOSTTY_PLACEMENT`:

```sh
WT_GHOSTTY_PLACEMENT=new-window  wt switch feat   # new window instead of a tab
WT_GHOSTTY_PLACEMENT=split-right wt switch feat   # split the front window
```

## Constraints

- macOS only — Ghostty's AppleScript support is macOS-specific, and requires Ghostty ≥ 1.3.
- Does **not** create worktrees. Use `git worktree add` first, then `wt switch`.
- `split-*` placements need an existing Ghostty window to split; `new-tab` (default) and `new-window` launch Ghostty if it isn't already running.
