---
description: "Create a new task in the current project's Doing column and attach your session."
argument-hint: "<task text>"
allowed-tools: [Bash]
---

# Create a new task in Doing

The user typed: `$ARGUMENTS`

`TEXT` is the entire argument string, trimmed. If empty, explain usage and stop.

## Emit

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" task_new --text "$TEXT"
```

## Confirm

Display: "Created task: \"`<TEXT>`\" in `Doing` with your session attached. Use `/claude-kanban:task-done` when complete."
