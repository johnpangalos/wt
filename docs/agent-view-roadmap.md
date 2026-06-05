# Agent-aware `wt` — roadmap

Make `wt` the **files-side control surface** for Claude Code's [agent
view](https://code.claude.com/docs/en/agent-view).

Each background agent runs in a git worktree under `.claude/worktrees/<id>/`,
and `claude agents --json` reports each session's `cwd`, `sessionId`, `name`,
`status`, and `waitingFor`. Because an agent moves into its worktree before
editing, **its `cwd` is a worktree path** — so joining `git worktree list`
(already parsed in `src/git.ts`) with `claude agents --json` on `path == cwd`
lets `wt` open, diff, and jump between agents from tmux.

## Mental model

Every agent has two faces keyed on the same worktree:

- **Conversation face** — the Claude session, reached with `claude attach <id>`
  (or agent view).
- **Files face** — the worktree on disk and its diff. That is `wt`'s job.

Agent view is the index of *what each agent is thinking*; `wt` is *let me get my
hands on what it actually changed*.

## Design decisions

- **tmux sessions** — one named session per agent (`wt-<name>`); jump via a
  picker or `Ctrl-b s`.
- **Live-refreshing diff** pane.
- **Commit-selectable diff scope** — flip between the working tree, the last
  commit, the full changeset vs the base branch, and any commit picked from the
  branch log.

---

## 1. Agent-aware `wt list`

**What:** Join `git worktree list --porcelain` with `claude agents --json` on
`path == cwd`. Worktrees that belong to an agent session get labeled with the
session name and state.

**Why:** Foundation — `wt` needs to know which worktrees are agent-owned and
what state each agent is in.

**Acceptance criteria**

- New module (e.g. `src/agents.ts`) shells out to `claude agents --json`,
  tolerating its absence (no Claude Code installed → empty list, no error).
- `wt list` adds an `agent` flag in `flags()` (`src/cli.ts`) and, for agent
  rows, shows the session `name` and `status` (working / needs-input /
  completed / failed).
- `wt list --json` includes `sessionId`, `name`, `status`, and `waitingFor`
  when present.
- Non-agent worktrees and repos without any agents are unaffected.

## 2. `wt agent <id|name>` — open one agent in a tmux session

**What:** Resolve an agent by short id or name, then create/attach a dedicated
tmux session (`wt-<name>`) laid out with three panes: `$EDITOR` in the worktree,
a git-diff pane (#3), and a `claude attach <id>` conversation pane. Re-running
attaches to the existing session instead of duplicating.

**Why:** The "open it alongside" experience — code, diff, and conversation
visible together, isolated per agent.

**Acceptance criteria**

- Extends `buildTmuxCmd` (`src/mux.ts`) to build a multi-pane session rather
  than only a window/split.
- Session is named deterministically so repeat invocations reattach
  (idempotent).
- Pane composition configurable via env (e.g.
  `WT_AGENT_PANES=editor,diff,claude`) so the conversation pane can be dropped
  for a files-only setup.
- Graceful fallback when `claude` isn't on `PATH` (skip the conversation pane).
- zellij equivalent stubbed or tracked as a follow-up.

## 3. Diff pane with selectable scope

**What:** The diff pane is navigable, not a single fixed view. Switch between:
working tree (`git diff`), last commit (`git show HEAD`), full changeset vs base
(`git diff $(git merge-base <base> HEAD)...HEAD`), and any commit picked from the
branch log. Base branch auto-detected (`main` / `master` / `@{upstream}`),
overridable via `WT_BASE`.

**Why:** You often want both the last commit *and* the full diff against the
base branch, sometimes a specific commit.

**Acceptance criteria**

- A small pane command/script cycles scopes via keypress (e.g. `w` / `l` / `f`,
  plus a log picker for an arbitrary commit).
- Base detection: prefer `main`, fall back to `master`, then `@{upstream}`;
  `WT_BASE` overrides.
- Renders through the user's pager / `delta` if configured, plain `git diff`
  otherwise.
- Works standalone (`wt diff <worktree>`) so it's reusable outside the agent
  layout.

## 4. Live-refreshing diff pane

**What:** The diff pane auto-updates as the agent edits — watch the worktree
(fs events, or poll on an interval) and re-render the current scope.

**Why:** Watch an agent's changes land in real time without manual refresh.

**Acceptance criteria**

- Refresh on file changes within the worktree; debounce rapid bursts.
- Polling fallback with a configurable interval (`WT_DIFF_INTERVAL`, default
  ~2s) where fs-watch is unavailable.
- Preserves the selected scope (#3) and scroll position across refreshes where
  feasible.
- Cleanly stops when the pane/session closes (no orphaned watchers).

## 5. `wt agents` picker + jump between agent sessions

**What:** Interactive list of agent sessions (state-colored, reusing #1's join)
that drops you into the chosen agent's tmux session (#2), creating it if needed.
Plus a `wt jump` to flip between an agent's tmux session and its Claude
conversation.

**Why:** The back-and-forth loop — live in `claude agents`, see a row need
input, land directly on its worktree; bounce between files and conversation.

**Acceptance criteria**

- `wt agents` lists sessions sorted by state (needs-input first), showing name,
  summary, and age.
- Selecting one switches to / creates `wt-<name>` (idempotent with #2).
- `wt jump` toggles focus between the worktree session and the conversation
  pane / `claude attach`.
- Sensible behavior when zero agents are running (clear message, exit non-zero).

---

## Suggested sequencing

1 (foundation) → 3 (diff scopes, reusable standalone) → 2 (compose the layout) →
4 (make the diff live) → 5 (picker + jump). 1 and 3 are independent and can go
in parallel.
