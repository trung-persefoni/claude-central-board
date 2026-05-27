#!/usr/bin/env bash
# uninstall-launchd.sh — removes the claude-kanban reconciler LaunchAgent.

set -u

LABEL="com.claude-kanban.reconciler"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

# bootout (modern), fall back to unload
if launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null; then
  echo "Bootout: $LABEL"
elif [ -f "$PLIST" ] && launchctl unload "$PLIST" 2>/dev/null; then
  echo "Unloaded (legacy): $LABEL"
else
  echo "LaunchAgent not loaded (or already gone)"
fi

if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "Removed: $PLIST"
fi

exit 0
