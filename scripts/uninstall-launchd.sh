#!/usr/bin/env bash
# uninstall-launchd.sh — removes the claude-kanban reconciler LaunchAgent
# (both the current label and the legacy label, for clean upgrades from v0.1.x).

set -u

LABEL="com.persefoni.claude-kanban.reconciler"
LEGACY_LABEL="com.claude-kanban.reconciler"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"
BIN_DIR="$HOME/Library/Application Support/claude-kanban/bin"
UID_NUM="$(id -u)"

bootout_one() {
  local label="$1" plist="$2"
  if launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null; then
    echo "Bootout: $label"
  elif [ -f "$plist" ] && launchctl unload "$plist" 2>/dev/null; then
    echo "Unloaded (legacy): $label"
  fi
  if [ -f "$plist" ]; then
    rm -f "$plist"
    echo "Removed: $plist"
  fi
}

bootout_one "$LABEL" "$PLIST"
bootout_one "$LEGACY_LABEL" "$LEGACY_PLIST"

# Remove the compiled binary. Leaves config/state/events untouched so a
# subsequent /setup can rebuild without losing project data.
if [ -d "$BIN_DIR" ]; then
  rm -rf "$BIN_DIR"
  echo "Removed: $BIN_DIR"
fi

exit 0
