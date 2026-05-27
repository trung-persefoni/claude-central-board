---
description: "Create a new spike note in the current project's Spikes/ folder."
argument-hint: "<spike-slug>"
allowed-tools: [Bash]
---

# Create a spike note

The user typed: `$ARGUMENTS`

`SLUG` is the trimmed argument. Must be non-empty, lowercase-with-dashes recommended (the reconciler will sanitize). If empty, ask the user what to call the spike.

## Emit

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" spike --slug "$SLUG"
```

## Confirm

Display: "Created spike: `Spikes/<YYYY-MM-DD>-<SLUG>.md` in the current project. Open in Obsidian to fill it in."
