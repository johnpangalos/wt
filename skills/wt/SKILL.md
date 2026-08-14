---
name: wt
description: Open a git worktree in a new Ghostty tab, window, or split via the `wt` CLI. Use when the user asks to open, switch to, or jump to a worktree, when you just created one, or when they want to list their worktrees. macOS + Ghostty ≥ 1.3 only.
---

# wt — jump to a worktree

`wt` opens a worktree in a new Ghostty tab — a shell at that path, or `$WT_CMD`
if the user set one. It drives Ghostty
through AppleScript, so it works even though you run outside any terminal —
Ghostty pops to the front on the user's Mac.

```sh
wt switch <branch>     # open that worktree
wt switch -c <branch>  # same, creating the worktree first if it doesn't exist
wt switch              # re-open the worktree containing $PWD
wt root                # open the main (root) worktree
wt list                # path / branch / flags, tab-separated (--json for JSON)
```

`wt switch` matches on exact name, then prefix, then substring, so a partial
branch name is enough — just run it. On a miss or an ambiguous prefix it exits
non-zero and prints the candidates, so guessing wrong costs one command rather
than a `wt list` up front. Reach for `wt list` only when the user actually asked
to see their worktrees; agent-owned ones carry an `agent` flag plus session name
and status.

For a new window or a split instead of a tab, the `WT_*` environment variables,
and platform constraints, read [reference.md](reference.md).
