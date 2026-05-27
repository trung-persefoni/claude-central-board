#!/usr/bin/env bash
# install-launchd.sh — installs the claude-kanban reconciler as a LaunchAgent.
#
# Reads CLAUDE_KANBAN_DATA_DIR/config.json for the tick interval (default 10s),
# substitutes tokens into the plist template, writes to ~/Library/LaunchAgents/,
# and bootstraps it.

set -euo pipefail

DATA_DIR="${CLAUDE_KANBAN_DATA_DIR:-$HOME/.claude/data/claude-kanban}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/workspace/claude-kanban}"
CONFIG="$DATA_DIR/config.json"
TEMPLATE="$PLUGIN_ROOT/scripts/templates/launchd.plist.tmpl"
RECONCILER="$PLUGIN_ROOT/scripts/reconciler.ts"
LABEL="com.claude-kanban.reconciler"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_PATH="$DATA_DIR/launchd.out.log"

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Run /claude-kanban:setup first." >&2
  exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "error: template not found at $TEMPLATE" >&2
  exit 1
fi

BUN_PATH="$(command -v bun || true)"
if [ -z "$BUN_PATH" ]; then
  echo "error: bun not found in PATH. Install with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

INTERVAL="$(jq -r '.reconcilerInterval // 10' "$CONFIG")"

mkdir -p "$(dirname "$PLIST")" "$DATA_DIR"

# Substitute tokens
sed \
  -e "s|{{LABEL}}|$LABEL|g" \
  -e "s|{{BUN_PATH}}|$BUN_PATH|g" \
  -e "s|{{RECONCILER_PATH}}|$RECONCILER|g" \
  -e "s|{{PLUGIN_ROOT}}|$PLUGIN_ROOT|g" \
  -e "s|{{DATA_DIR}}|$DATA_DIR|g" \
  -e "s|{{PATH}}|$PATH|g" \
  -e "s|{{INTERVAL_SECONDS}}|$INTERVAL|g" \
  -e "s|{{LOG_PATH}}|$LOG_PATH|g" \
  "$TEMPLATE" > "$PLIST"

# Bootstrap (modern macOS), falling back to load
UID_NUM="$(id -u)"
TARGET="gui/$UID_NUM/$LABEL"

# Bootout first in case it's already loaded (idempotent install)
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true

if launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
  echo "Installed LaunchAgent: $LABEL"
elif launchctl load -w "$PLIST" 2>/dev/null; then
  echo "Installed LaunchAgent (legacy load): $LABEL"
else
  echo "error: failed to bootstrap LaunchAgent. Check '$PLIST'." >&2
  exit 1
fi

# Kickstart so it runs immediately
launchctl kickstart -k "$TARGET" 2>/dev/null || true

echo "Plist:    $PLIST"
echo "Interval: ${INTERVAL}s"
echo "Logs:     $LOG_PATH"
echo "Status:   launchctl print $TARGET | head"
