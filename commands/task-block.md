---
description: "Move the task currently claimed by this session to Blocked, with a reason."
argument-hint: "<reason>"
allowed-tools: [Bash]
---

# Block the current task

The user typed: `$ARGUMENTS` — treat this as the reason. If empty, ask: "What's blocking the task?" and wait for an answer.

## Emit

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" task_block --reason "$REASON"
```

## Confirm

Display: "Moved task to `Blocked`. Reason: \"`<REASON>`\". The card stays attached to your session until you unblock it (manually move on the board, or claim a different task with `/claude-kanban:task`)."
