---
description: "Show the current session's claude-kanban state: project, claimed task, last activity, registered projects."
argument-hint: ""
allowed-tools: [Bash]
---

# Show claude-kanban status

Read the plugin state and summarize for the user.

```bash
DATA_DIR="$HOME/.claude/data/claude-kanban"
SID="$CLAUDE_CODE_SESSION_ID"

echo "Session id: ${SID:-(unset)}"
echo ""

if [ ! -f "$DATA_DIR/state.json" ]; then
  echo "Plugin not yet set up or no events seen. Run /claude-kanban:setup."
  exit 0
fi

# Locate this session in state.json
jq -r --arg sid "$SID" '
  if .sessions[$sid] then
    "Current project: " + .sessions[$sid].project,
    "Worktree:        " + .sessions[$sid].cwd,
    "Branch:          " + (.sessions[$sid].branch // "(none)"),
    "Started:         " + .sessions[$sid].startedAt,
    "Last active:     " + .sessions[$sid].lastActivity,
    "Claimed task:    " + (.sessions[$sid].claimedTaskId // "(none)")
  else
    "No SessionStart event yet for this session id."
  end
' "$DATA_DIR/state.json"

echo ""
echo "Registered projects:"
jq -r 'to_entries[] | "  - " + .key + " (" + .value.displayName + ")"' "$DATA_DIR/projects.json"
```

Present the output as-is to the user.
