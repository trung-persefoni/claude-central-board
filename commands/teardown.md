---
description: "Uninstall the claude-kanban LaunchAgent and optionally remove plugin data. Never deletes vault content."
argument-hint: "[--purge-data]"
allowed-tools: [Bash]
---

# claude-kanban teardown

Remove the LaunchAgent and (optionally) the plugin data directory. Vault content is **never** deleted automatically.

Arguments (raw): `$ARGUMENTS`

## Steps

### 1. Uninstall the LaunchAgent

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/uninstall-launchd.sh"
```

### 2. Decide whether to purge data

If `--purge-data` was passed, skip the prompt and remove `~/.claude/data/claude-kanban/`. Otherwise, ask:

> "Remove the plugin data directory (`~/.claude/data/claude-kanban/`)? This includes the event log and project registry. Your vault content is untouched either way. [y/N]"

If yes:

```bash
rm -rf "$HOME/.claude/data/claude-kanban"
echo "Removed ~/.claude/data/claude-kanban"
```

If no, leave it in place.

### 3. Final report

Display:

```
Teardown complete.
  LaunchAgent:  removed
  Plugin data:  <kept | removed>
  Vault content: preserved (delete manually if desired)

To finish removing the plugin itself:
  /plugin uninstall claude-kanban@claude-kanban
```
