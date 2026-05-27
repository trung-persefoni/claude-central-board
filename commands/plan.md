---
description: "Smart-update the current project's Plan.md — restructure goals, scope, sequencing, etc. Use :note plan for append-only decisions."
argument-hint: "<intent — describe the change in plan>"
allowed-tools: [Bash, Read, Edit, Write]
---

# Update project Plan

The user typed: `$ARGUMENTS`

This is the **restructure** command for Plan.md. It is distinct from
`/claude-kanban:note plan` (which appends a timestamped paragraph to the
Decision log). Use `:plan` when the *shape* of the plan changes — goals
shift, scope expands or contracts, a milestone gets resequenced, an open
question gets resolved and should be removed.

## Steps

### 1. Resolve the current project

```bash
eval "$("$CLAUDE_PLUGIN_ROOT/scripts/lib/resolve-project.sh" --export)"
```

Surface stderr + stop on non-zero exit.

### 2. Read Plan.md

```bash
PLAN_PATH="$PROJECT_DIR/Plan.md"
```

Read it with the `Read` tool. The expected sections are: Goals, Non-goals,
Sequencing, Open questions, Decision log.

### 3. Apply the intent

Update the appropriate section(s) of Plan.md based on `$ARGUMENTS`. Guidance:

- **Treat the `## Decision log` section as off-limits** — that's owned by
  `/claude-kanban:note plan` appends. Don't rewrite it, don't reorder it.
  You may move a single resolved entry up into the body (e.g., a finalized
  decision now belongs in Sequencing) but **leave the Decision log entry in
  place** for audit.
- **Goals** and **Non-goals** are bulleted lists — add, remove, or rewrite
  bullets to match the new direction. If the intent contradicts an existing
  goal, replace it (and consider whether the change deserves a note via
  `/claude-kanban:note plan` for audit — mention this to the user).
- **Sequencing** is freeform prose. Restructure as needed. Keep it concise.
- **Open questions**: if `$ARGUMENTS` resolves an open question, *move* the
  resolution into the body (Goals/Sequencing/etc.) and remove the question.
- If the intent is vague, ask a clarifying question rather than guessing.

Write the updated file with the `Write` tool.

### 4. Emit an audit event

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" plan_updated \
  --project "$PROJECT_SLUG" \
  --summary "$ARGUMENTS"
```

The reconciler doesn't act on `plan_updated` — recorded for audit only.

### 5. Confirm

Display a brief summary (which sections were changed) and:

> "Plan updated: `<vault>/Projects/<slug>/Plan.md`. The Decision log was
> preserved. Open it in Obsidian to review."
