---
description: "Assign the current Claude session to a registered project in the claude-kanban workspace."
argument-hint: "<project-slug>"
allowed-tools: [Bash]
---

# Assign session to project

The user typed: `$ARGUMENTS`

The slug should be a single token (no spaces). Trim whitespace; if empty, tell the user the correct usage and stop.

## Validate the slug exists

```bash
DATA_DIR="$HOME/.claude/data/claude-kanban"
SLUG="<trimmed-arguments>"
if ! jq -e --arg s "$SLUG" '.[$s]' "$DATA_DIR/projects.json" >/dev/null 2>&1; then
  echo "error: project slug '$SLUG' is not registered."
  echo "Registered projects:"
  jq -r 'keys[]' "$DATA_DIR/projects.json"
  echo ""
  echo "Create one with: /claude-kanban:project-new <slug> \"<Display Name>\""
  exit 1
fi
```

If the slug doesn't exist, surface the message to the user and stop.

## Emit the event

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" project_assigned --slug "$SLUG"
```

## Confirm

Display: "Assigned session to project `<slug>`. The session card will move to that project's `Sessions.md` within a few seconds."
