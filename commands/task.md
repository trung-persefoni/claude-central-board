---
description: "Claim an existing task by exact text, OR (with no args) parse recent conversation and fill the Backlog with proposed tasks."
argument-hint: "[<exact task text>] — omit args to extract tasks from this chat"
allowed-tools: [Bash, Read, Edit, Write, AskUserQuestion]
---

# Claim a task — or fill Backlog from conversation

The user typed: `$ARGUMENTS`

Two modes depending on arguments:

- **Args present** → classic claim mode. `TEXT = $ARGUMENTS` (trimmed) is
  the exact task text. Move on to **Mode A** below.
- **Args empty** → chat-parse mode. Look back over recent conversation,
  extract task-like items, propose them to the user, and write confirmed
  ones into the project's `Tasks.md` Backlog. Move on to **Mode B** below.

---

## Mode A — Claim an existing task

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" task_claim --text "$TEXT"
```

Display:

> "Claimed task: \"<TEXT>\". The card will move to `Doing` with your session
> attached within a few seconds. If no matching Backlog card existed, a new
> Doing card was created."

Stop.

---

## Mode B — Parse recent conversation, fill Backlog

### B1. Resolve the current project

```bash
eval "$("$CLAUDE_PLUGIN_ROOT/scripts/lib/resolve-project.sh" --export)"
```

Surface stderr + stop on non-zero exit. (You can't fill a Backlog if no
project is claimed.)

### B2. Extract candidate tasks from recent conversation

Look at the **last 30 messages or so** of this conversation (whichever
gives a coherent window) and identify discrete, actionable items. What
counts as a task:

- "we should X" / "let's X" / "next we'll do X" — explicit work items
- "I need to X" / "you need to X" — assigned work
- Things split out of a larger discussion: "split this into A, B, C" → 3 tasks
- Bugs surfaced that need a follow-up fix
- Cleanups, refactors, or polish items that were named but deferred

What does **NOT** count:

- Already-completed work (don't propose what's done)
- Questions or open issues (those go to Plan.md "Open questions" via :plan)
- Notes / observations / blockers (those belong in Note.md via :note)
- Decisions (those belong in Plan/Design Decision log via :note plan/design)
- Vague aspirations ("make it faster") — only items with a concrete shape

Each task should be:

- One imperative sentence, **8–15 words** preferred
- Self-describing — no "fix it", "do that"
- Title Case is fine but not required

If the conversation has no clear task content, tell the user that and stop
without writing anything.

### B3. Confirm with the user

Use `AskUserQuestion` with `multiSelect: true`, presenting each candidate
as an option. The user picks which ones land in the Backlog. If they
select zero, stop without writing.

If there are more than 4 candidates, group them sensibly — pick the 3-4
strongest as primary options and mention the rest in the question text
so the user can manually request additions.

### B4. Read current Tasks.md

```bash
TASKS_PATH="$PROJECT_DIR/Tasks.md"
```

Read it with the `Read` tool. The expected structure (Obsidian Kanban
plugin format):

```
---

kanban-plugin: board

---

# Tasks · <slug>

## Backlog

<existing backlog items as `- [ ] text` lines>

## Doing

<reconciler-owned>

## Blocked
...
```

### B5. Insert confirmed tasks into Backlog

For each confirmed task, append a `- [ ] <task text>` line directly under
the `## Backlog` heading and above the next `## ` heading. **Do not touch
the Doing/Blocked/Done/Archive sections** — those are reconciler-owned.

Use the `Edit` tool with `old_string` set to the existing Backlog block
and `new_string` set to that block with the new entries appended. Preserve
existing Backlog entries.

### B6. Emit audit events

For each confirmed task, emit:

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" task_backlog_filled \
  --project "$PROJECT_SLUG" \
  --text "<task text>" \
  --source "chat-parse"
```

The reconciler doesn't act on `task_backlog_filled` (the file is already
updated by Mode B5) — recorded for audit only.

### B7. Confirm

Display the list of tasks written to Backlog, and:

> "<N> task(s) added to Backlog for <slug>. Use `/claude-kanban:task <exact
> text>` to claim one when you start work."
