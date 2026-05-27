---
description: "Claim an existing task (Backlog or Doing) by its exact text. Moves it to Doing and attaches your session."
argument-hint: "<exact task text>"
allowed-tools: [Bash]
---

# Claim a task

The user typed: `$ARGUMENTS`

`TEXT` is the entire argument string, trimmed. If empty, explain usage and stop.

## Emit

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" task_claim --text "$TEXT"
```

## Confirm

Display: "Claimed task: \"`<TEXT>`\". The card will move to `Doing` with your session attached within a few seconds. If no matching Backlog card existed, a new Doing card was created."
