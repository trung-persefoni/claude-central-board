---
description: "Append a timestamped paragraph to the current project's Plan.md or Design.md."
argument-hint: "<plan|design> <body text>"
allowed-tools: [Bash]
---

# Append a planning or design note

The user typed: `$ARGUMENTS`

Parse:
- First token = `KIND` — must be `plan` or `design`. If neither, tell the user the correct usage and stop.
- Remainder = `BODY` — the paragraph text. Must be non-empty.

## Emit

```bash
if [ "$KIND" = "plan" ]; then EV=note_plan; else EV=note_design; fi
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" "$EV" --body "$BODY"
```

## Confirm

Display: "Appended to `<Plan.md|Design.md>` for the current project (timestamped with your session id). Open it in Obsidian to see the entry." If the current session has no project assigned, the reconciler will skip the write and log a warning — surface that hint to the user.
