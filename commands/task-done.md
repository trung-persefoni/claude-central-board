---
description: "Mark the task currently claimed by this session as Done."
argument-hint: "[<task text — only if disambiguating>]"
allowed-tools: [Bash]
---

# Mark task done

The user typed: `$ARGUMENTS` (may be empty — defaults to the task your session has claimed).

## Emit

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" task_done --text "$ARGUMENTS"
```

## Confirm

Display: "Marked task done. It will move to the `Done` column within a few seconds." If `$ARGUMENTS` was empty and the session had no claimed task, the event becomes a no-op — note that the reconciler will simply ignore it.
