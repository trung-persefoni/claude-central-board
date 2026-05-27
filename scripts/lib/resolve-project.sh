#!/usr/bin/env bash
# resolve-project.sh — resolve the current Claude session to a kanban project slug.
#
# Output to stdout:
#   <slug>\n<vault-path>\n
#
# Exits 0 if a real project is resolved; exits 2 with a helpful message on stderr
# if the session is _unassigned (no project claimed yet).
#
# Resolution order:
#   1. state.json → sessions[$CLAUDE_CODE_SESSION_ID].project
#   2. .claude-project file at $PWD (or any ancestor)
#   3. fallback to error
#
# Source it OR call it standalone:
#   eval "$("$CLAUDE_PLUGIN_ROOT/scripts/lib/resolve-project.sh" --export)"
#   # → exports PROJECT_SLUG, PROJECT_DIR, VAULT_PATH, PROJECT_PATH

set -u

DATA_DIR="${CLAUDE_KANBAN_DATA_DIR:-$HOME/.claude/data/claude-kanban}"
STATE_FILE="$DATA_DIR/state.json"
CONFIG_FILE="$DATA_DIR/config.json"
SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}"

VAULT_PATH=""
if [ -f "$CONFIG_FILE" ]; then
  VAULT_PATH="$(jq -r '.vaultPath // ""' "$CONFIG_FILE" 2>/dev/null)"
fi
if [ -z "$VAULT_PATH" ]; then
  echo "error: no vaultPath in $CONFIG_FILE. Run /claude-kanban:setup first." >&2
  exit 3
fi

SLUG=""

# Path 1: state.json lookup by session id
if [ -n "$SESSION_ID" ] && [ -f "$STATE_FILE" ]; then
  SLUG="$(jq -r --arg s "$SESSION_ID" '.sessions[$s].project // ""' "$STATE_FILE" 2>/dev/null)"
fi

# Path 2: walk up from $PWD looking for .claude-project
if [ -z "$SLUG" ] || [ "$SLUG" = "_unassigned" ] || [ "$SLUG" = "null" ]; then
  DIR="$PWD"
  while [ "$DIR" != "/" ] && [ -n "$DIR" ]; do
    if [ -f "$DIR/.claude-project" ]; then
      CANDIDATE="$(head -1 "$DIR/.claude-project" | tr -d '[:space:]')"
      if [ -n "$CANDIDATE" ]; then
        SLUG="$CANDIDATE"
        break
      fi
    fi
    DIR="$(dirname "$DIR")"
  done
fi

if [ -z "$SLUG" ] || [ "$SLUG" = "_unassigned" ] || [ "$SLUG" = "null" ]; then
  echo "error: current session is not assigned to a project." >&2
  echo "       Run /claude-kanban:project <slug> to claim one, or" >&2
  echo "       /claude-kanban:project-new <slug> \"<Display Name>\" to register a new project." >&2
  exit 2
fi

PROJECT_DIR="$VAULT_PATH/Projects/$SLUG"
if [ ! -d "$PROJECT_DIR" ]; then
  echo "error: project directory not found: $PROJECT_DIR" >&2
  echo "       The slug ($SLUG) resolved but the folder is missing. The reconciler may not have scaffolded it yet." >&2
  exit 4
fi

if [ "${1:-}" = "--export" ]; then
  printf 'export PROJECT_SLUG=%q\n' "$SLUG"
  printf 'export VAULT_PATH=%q\n'    "$VAULT_PATH"
  printf 'export PROJECT_DIR=%q\n'   "$PROJECT_DIR"
else
  printf '%s\n' "$SLUG"
  printf '%s\n' "$VAULT_PATH"
  printf '%s\n' "$PROJECT_DIR"
fi
