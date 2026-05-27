# claude-kanban

> A project-first Obsidian workspace for Claude Code. Hooks track every session deterministically; a reconciler renders kanban boards, plans, designs, and spike folders into your vault. The plugin never depends on Claude remembering to log itself.

## What this is

If you run many Claude Code sessions across many worktrees, this plugin keeps a live dashboard in Obsidian showing what each session is doing, organized by **logical project** (not by repo). Each project gets its own folder with:

- `README.md` — project charter
- `Plan.md` — planning decisions (auto-appended via `/claude-kanban:note plan`)
- `Design.md` — design decisions (auto-appended via `/claude-kanban:note design`)
- `Tasks.md` — kanban: `Backlog` (user-authored) + `Doing` / `Blocked` / `Done` / `Archive` (reconciler-owned)
- `Sessions.md` — kanban: `Active` / `Idle` / `Stale` / `Ended` (reconciler-owned, auto-aged)
- `Spikes/` — one note per investigation

A master `_Index.md` rolls all projects up with hot/warm/cold buckets.

## How enforcement works

Claude Code's hook system runs shell scripts on session lifecycle events (`SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`). Those scripts append events to a log; a reconciler (run by `launchd` every ~10s) folds events into state and writes the vault.

The user (you) never has to ask Claude to log itself. If Claude crashes, refuses, or compacts away the instruction, the hook still fires — that's the whole point.

## Install (local-only v1)

```
/plugin marketplace add ~/workspace/claude-kanban
/plugin install claude-kanban@claude-kanban
/claude-kanban:setup
```

`setup` interactively asks for your Obsidian vault path, writes `~/.claude/data/claude-kanban/config.json`, and installs the `LaunchAgent`.

Requirements: `bun`, `jq`, macOS (uses `launchd`).

## Project association

A session resolves to a project via **three layers** (highest precedence first):

1. **Slash command**: `/claude-kanban:project <slug>` — overrides for the rest of the session.
2. **`.claude-project` file**: drop a single-line file containing the slug at the worktree root (or any ancestor of the cwd). The `SessionStart` hook walks upward.
3. **`worktree-map.json`**: `~/.claude/data/claude-kanban/worktree-map.json` — a JSON object mapping absolute paths to slugs. User-maintained.

Unresolved → the session lands in `_unassigned`. Run `/claude-kanban:project <slug>` to reassign.

Projects must be **registered** before they can be assigned. Use `/claude-kanban:project-new <slug> "<Display Name>"`.

## Slash commands

| Command | Purpose |
|---|---|
| `/claude-kanban:setup` | First-run wizard: vault path, data dir, LaunchAgent |
| `/claude-kanban:teardown [--purge-data]` | Remove LaunchAgent; optionally remove plugin data. Vault is untouched. |
| `/claude-kanban:project <slug>` | Assign current session to a registered project |
| `/claude-kanban:project-new <slug> "<name>"` | Register a new project; scaffold folder from templates |
| `/claude-kanban:task <text>` | Claim a Backlog task by exact text (creates one in Doing if no match) |
| `/claude-kanban:task-new <text>` | Create a new task in Doing with this session attached |
| `/claude-kanban:task-done` | Mark the claimed task Done |
| `/claude-kanban:task-block <reason>` | Move the claimed task to Blocked |
| `/claude-kanban:note plan <body>` | Append a paragraph to current project's `Plan.md` |
| `/claude-kanban:note design <body>` | Append a paragraph to current project's `Design.md` |
| `/claude-kanban:spike <slug>` | Create `Spikes/YYYY-MM-DD-<slug>.md` |
| `/claude-kanban:status` | Show this session's project, claimed task, last activity |

## How tasks and sessions interact

Tasks and sessions live on **separate boards** within each project:

- **`Tasks.md`** — `Backlog` is where you (in Obsidian) drop tasks you might do later. Add lines like `- [ ] Something I might do` directly in the board view. The reconciler **does not touch unclaimed Backlog items**.
- **`Sessions.md`** — every Claude session in the project gets a card here. Columns are state, not workstreams: `Active` (≤5 min since last activity), `Idle` (≤2 hr), `Stale` (>2 hr), `Ended` (clean exit).
- When a session runs `/claude-kanban:task <exact-text>`, the reconciler moves that line from `Backlog` to `Doing` and attaches the session. The Backlog line disappears (it's now tracked); manual moves back to Backlog in Obsidian work as expected.

## Authoring Plan / Design / README

You author these directly in Obsidian. The reconciler **appends** to `Plan.md` and `Design.md` via `/claude-kanban:note` (each entry timestamped with the session id; idempotent via a trailing HTML comment), but never overwrites your content. `README.md` is fully yours after the initial template seed.

## Authoring Backlog tasks

In `Tasks.md`, edit the `## Backlog` section freely. Add tasks as `- [ ] Task text`. Add indented metadata (descriptions, links, sub-checklists) — the reconciler treats Backlog as opaque text and round-trips it unchanged unless a session explicitly claims a task.

> Tip: if you want the task to be claim-able, the first line after `- [ ] ` must be the exact text the session will pass to `/claude-kanban:task`.

## Proactive session briefing

When a Claude session starts in a project, the `SessionStart` hook reads `Plan.md`, `Design.md`, and open tasks, and injects them into the session's context via `additionalContext`. That means Claude is automatically aware of your latest planning and design decisions on turn 1 — no `/init` command needed.

The briefing also tells Claude to use `/claude-kanban:note ...` proactively when it makes significant decisions. Whether Claude actually does so depends on Claude; the worst case is that you log decisions yourself with the slash commands.

## File layout

```
~/.claude/data/claude-kanban/              # plugin data (survives reinstall)
  config.json
  events.jsonl
  state.json
  projects.json
  worktree-map.json
  reconciler.log

<vaultPath>/Projects/                      # rendered Markdown (live)
  _Index.md                                # rollup board
  _unassigned/
    Sessions.md
    Tasks.md
  <slug>/
    README.md      (you author)
    Plan.md        (you + /note plan)
    Design.md      (you + /note design)
    Tasks.md       (Backlog: you; other columns: reconciler)
    Sessions.md    (reconciler)
    Spikes/        (/spike + you)

~/Library/LaunchAgents/
  com.claude-kanban.reconciler.plist       # installed by setup
```

## Troubleshooting

- **Cards aren't updating.** Check `launchctl print gui/$(id -u)/com.claude-kanban.reconciler | head` — the LaunchAgent should be `state = running`. Logs at `~/.claude/data/claude-kanban/reconciler.log`.
- **Session shows up in `_unassigned`.** No project resolution succeeded. Drop a `.claude-project` file at your worktree root or run `/claude-kanban:project <slug>`.
- **`/claude-kanban:project <slug>` errors.** The slug isn't registered. Run `/claude-kanban:project-new <slug> "<Display Name>"` first.
- **Backlog item disappeared after running `/claude-kanban:task`.** Expected: it moved to `Doing` and is attached to your session. Check `## Doing` in `Tasks.md`.
- **Reconciler not catching up.** Force a tick: `bun run ~/workspace/claude-kanban/scripts/reconciler.ts`.
- **Want to wipe everything and start over.** `/claude-kanban:teardown --purge-data`, then `/claude-kanban:setup`.

## Uninstall

```
/claude-kanban:teardown               # removes LaunchAgent
/plugin uninstall claude-kanban@claude-kanban
```

Vault content (`<vaultPath>/Projects/`) is preserved. Add `--purge-data` to `teardown` to also remove `~/.claude/data/claude-kanban/`.

## Limits in v1

- macOS only (uses `launchd`).
- Single-machine. If you sync the vault via Obsidian Sync, multiple machines will conflict on the reconciler-owned files.
- No retroactive backfill from existing transcripts.
- The Backlog parser treats user-authored content as opaque text. It won't deduplicate or validate Backlog cards.

## Status

v0.1 · local development · not yet published to a public marketplace (but `.claude-plugin/marketplace.json` is in place so local `marketplace add` works).
