#!/usr/bin/env bash
# on-session-start.sh — SessionStart hook for claude-kanban.
#
# 1. Parses stdin JSON from harness.
# 2. Resolves project via 3-layer lookup:
#      a) .claude-project file (walked up from cwd)
#      b) worktree-map.json
#      c) unresolved → _unassigned
# 3. Appends SessionStart event to events.jsonl.
# 4. Emits additionalContext JSON to stdout briefing Claude on the project.
#
# All diagnostic output MUST go to stderr — stdout is reserved for the
# hook protocol JSON.

set -u

DATA_DIR="${CLAUDE_KANBAN_DATA_DIR:-$HOME/.claude/data/claude-kanban}"
CONFIG_FILE="$DATA_DIR/config.json"
PROJECTS_FILE="$DATA_DIR/projects.json"
WORKTREE_MAP="$DATA_DIR/worktree-map.json"

# If the plugin isn't set up yet, exit silently. The user must run
# /claude-kanban:setup first; we don't fail the session over it.
if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

# Read stdin JSON
STDIN_JSON="$(cat 2>/dev/null || echo '{}')"
SESSION_ID="$(printf '%s' "$STDIN_JSON" | jq -r '.session_id // empty' 2>/dev/null)"
CWD="$(printf '%s' "$STDIN_JSON" | jq -r '.cwd // empty' 2>/dev/null)"
TRANSCRIPT="$(printf '%s' "$STDIN_JSON" | jq -r '.transcript_path // empty' 2>/dev/null)"
[ -z "$CWD" ] && CWD="$PWD"

VAULT_PATH="$(jq -r '.vaultPath // empty' "$CONFIG_FILE" 2>/dev/null)"

# --- Layer 1: .claude-project walk upward from cwd ---
PROJECT_SLUG=""
RESOLVED_VIA=""
search_dir="$CWD"
while [ -n "$search_dir" ] && [ "$search_dir" != "/" ]; do
  if [ -f "$search_dir/.claude-project" ]; then
    PROJECT_SLUG="$(head -n 1 "$search_dir/.claude-project" | tr -d '[:space:]')"
    RESOLVED_VIA=".claude-project at $search_dir"
    break
  fi
  search_dir="$(dirname "$search_dir")"
done

# --- Layer 2: worktree-map.json lookup ---
if [ -z "$PROJECT_SLUG" ] && [ -f "$WORKTREE_MAP" ]; then
  mapped="$(jq -r --arg cwd "$CWD" '.[$cwd] // empty' "$WORKTREE_MAP" 2>/dev/null)"
  if [ -n "$mapped" ]; then
    PROJECT_SLUG="$mapped"
    RESOLVED_VIA="worktree-map.json"
  fi
fi

# --- Layer 3 (or unresolved): mark as _unassigned ---
if [ -z "$PROJECT_SLUG" ]; then
  PROJECT_SLUG="_unassigned"
  RESOLVED_VIA="no .claude-project or worktree-map entry"
fi

# Validate slug exists in registry (unless _unassigned, which is always allowed)
if [ "$PROJECT_SLUG" != "_unassigned" ] && [ -f "$PROJECTS_FILE" ]; then
  if ! jq -e --arg s "$PROJECT_SLUG" '.[$s]' "$PROJECTS_FILE" >/dev/null 2>&1; then
    echo "claude-kanban: project slug '$PROJECT_SLUG' not registered; treating as _unassigned" >&2
    PROJECT_SLUG="_unassigned"
    RESOLVED_VIA="$RESOLVED_VIA (slug not in projects.json)"
  fi
fi

# Resolve a human display name for the briefing
DISPLAY_NAME="$PROJECT_SLUG"
if [ "$PROJECT_SLUG" != "_unassigned" ] && [ -f "$PROJECTS_FILE" ]; then
  dn="$(jq -r --arg s "$PROJECT_SLUG" '.[$s].displayName // empty' "$PROJECTS_FILE" 2>/dev/null)"
  [ -n "$dn" ] && DISPLAY_NAME="$dn"
fi

# --- Append SessionStart event ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/event-emit.sh" SessionStart --project "$PROJECT_SLUG" --resolved_via "$RESOLVED_VIA" <<<"$STDIN_JSON" >/dev/null 2>&1 || true

# --- Build additionalContext briefing ---
build_briefing() {
  local proj_dir="$VAULT_PATH/Projects/$PROJECT_SLUG"
  local short_sid="${SESSION_ID:0:8}"

  if [ "$PROJECT_SLUG" = "_unassigned" ]; then
    cat <<EOF
You are working in claude-kanban with an **unassigned** session (id: $short_sid, cwd: $CWD).

Reason: $RESOLVED_VIA

Your session card is in the \`_unassigned\` workspace. To attach it to a project, run:
  - \`/claude-kanban:project <slug>\` (assign to an existing project)
  - \`/claude-kanban:project-new <slug> "<display name>"\` (register and assign)
  - List registered projects with \`/claude-kanban:status\`.
EOF
    return
  fi

  cat <<EOF
You are working in claude-kanban project **$DISPLAY_NAME** (slug: \`$PROJECT_SLUG\`, resolved from $RESOLVED_VIA). Session id: $short_sid.

EOF

  # Plan.md excerpt
  if [ -f "$proj_dir/Plan.md" ]; then
    local sz
    sz=$(wc -c <"$proj_dir/Plan.md" | tr -d ' ')
    echo "## Plan.md (${sz} bytes)"
    echo ""
    head -c 2000 "$proj_dir/Plan.md"
    [ "$sz" -gt 2000 ] && echo -e "\n\n...(truncated)"
    echo ""
    echo ""
  fi

  # Design.md excerpt
  if [ -f "$proj_dir/Design.md" ]; then
    local sz
    sz=$(wc -c <"$proj_dir/Design.md" | tr -d ' ')
    echo "## Design.md (${sz} bytes)"
    echo ""
    head -c 2000 "$proj_dir/Design.md"
    [ "$sz" -gt 2000 ] && echo -e "\n\n...(truncated)"
    echo ""
    echo ""
  fi

  # Open tasks: cheap grep of Tasks.md for now (reconciler keeps it fresh)
  if [ -f "$proj_dir/Tasks.md" ]; then
    echo "## Tasks snapshot"
    echo ""
    awk '
      /^## / { col = $0; sub(/^## /, "", col); print ""; print "### " col; next }
      /^- \[/ && col ~ /^(Doing|Blocked|Backlog)$/ { print $0 }
    ' "$proj_dir/Tasks.md" | head -c 1500
    echo ""
    echo ""
  fi

  cat <<'EOF'
## Working in a kanban-tracked project

For the full command reference and proactivity heuristics (when to log a decision, restructure a doc, fill the Backlog from chat, etc.), invoke the `claude-kanban:using-claude-kanban` skill.
EOF
}

BRIEFING="$(build_briefing)"

# Emit hook protocol JSON to stdout — and ONLY this.
jq -n --arg ctx "$BRIEFING" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'

exit 0
