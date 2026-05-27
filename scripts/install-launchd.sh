#!/usr/bin/env bash
# install-launchd.sh — compile the reconciler to a standalone binary, then
# install it as an event-driven LaunchAgent triggered by writes to events.jsonl.
#
# This is the v0.2.0 install model. Key differences from v0.1.x:
#   - The LaunchAgent runs a compiled bun binary, not `bun run <ts>`.
#   - The binary lives under ~/Library/Application Support/claude-kanban/bin/.
#   - The binary is ad-hoc signed (codesign -s -) so EDRs see a signed artifact.
#   - The plist uses WatchPaths on events.jsonl instead of StartInterval polling.
#     The reconciler only runs when something actually emits an event.
#   - Legacy LaunchAgent (com.claude-kanban.reconciler) is unloaded if present.
#
# bun is required at install time to compile the binary. It is NOT required at
# runtime — the compiled binary embeds the bun runtime.

set -euo pipefail

DATA_DIR="${CLAUDE_KANBAN_DATA_DIR:-$HOME/.claude/data/claude-kanban}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/workspace/claude-kanban}"
CONFIG="$DATA_DIR/config.json"
TEMPLATE="$PLUGIN_ROOT/scripts/templates/launchd.plist.tmpl"
RECONCILER_SRC="$PLUGIN_ROOT/scripts/reconciler.ts"
EVENTS_FILE="$DATA_DIR/events.jsonl"

# Binary location follows Apple's user-data convention.
APP_SUPPORT_DIR="$HOME/Library/Application Support/claude-kanban"
BIN_DIR="$APP_SUPPORT_DIR/bin"
RECONCILER_BIN="$BIN_DIR/reconciler"

# Reverse-DNS label that names a publisher rather than a feature.
LABEL="com.persefoni.claude-kanban.reconciler"
LEGACY_LABEL="com.claude-kanban.reconciler"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"
LOG_PATH="$DATA_DIR/launchd.out.log"

# ──────────────────────────────────────────────────────────────────────────
# Preconditions
# ──────────────────────────────────────────────────────────────────────────

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Run /claude-kanban:setup first." >&2
  exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "error: launchd.plist.tmpl not found at $TEMPLATE" >&2
  exit 1
fi
if [ ! -f "$RECONCILER_SRC" ]; then
  echo "error: reconciler.ts not found at $RECONCILER_SRC" >&2
  exit 1
fi

BUN_PATH="$(command -v bun || true)"
if [ -z "$BUN_PATH" ]; then
  echo "error: bun not found in PATH. Required at install time to compile the reconciler." >&2
  echo "       Install with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$(dirname "$PLIST")" "$DATA_DIR"
# Ensure events.jsonl exists before launchd watches it — WatchPaths requires
# the path to exist at bootstrap time.
[ -f "$EVENTS_FILE" ] || : > "$EVENTS_FILE"

# ──────────────────────────────────────────────────────────────────────────
# Unload any prior LaunchAgent (legacy and current label) so we start clean.
# ──────────────────────────────────────────────────────────────────────────

UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/$LEGACY_LABEL" 2>/dev/null || true
rm -f "$LEGACY_PLIST"

# ──────────────────────────────────────────────────────────────────────────
# Compile the reconciler to a standalone binary.
# ──────────────────────────────────────────────────────────────────────────

echo "Compiling reconciler..."
"$BUN_PATH" build "$RECONCILER_SRC" --compile --outfile "$RECONCILER_BIN" >/dev/null
chmod +x "$RECONCILER_BIN"

# Ad-hoc sign so the artifact has a signature, even though we don't have a
# Developer ID. EDRs treat ad-hoc-signed > unsigned. macOS Gatekeeper still
# blocks at first execution unless quarantined; LaunchAgents bypass that.
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$RECONCILER_BIN" 2>/dev/null || \
    echo "warning: codesign failed; continuing unsigned" >&2
fi

# ──────────────────────────────────────────────────────────────────────────
# Render the plist from the template.
# ──────────────────────────────────────────────────────────────────────────

sed \
  -e "s|{{LABEL}}|$LABEL|g" \
  -e "s|{{RECONCILER_BIN}}|$RECONCILER_BIN|g" \
  -e "s|{{PLUGIN_ROOT}}|$PLUGIN_ROOT|g" \
  -e "s|{{DATA_DIR}}|$DATA_DIR|g" \
  -e "s|{{EVENTS_FILE}}|$EVENTS_FILE|g" \
  -e "s|{{PATH}}|$PATH|g" \
  -e "s|{{LOG_PATH}}|$LOG_PATH|g" \
  "$TEMPLATE" > "$PLIST"

# ──────────────────────────────────────────────────────────────────────────
# Bootstrap.
# ──────────────────────────────────────────────────────────────────────────

if launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
  echo "Installed LaunchAgent: $LABEL"
elif launchctl load -w "$PLIST" 2>/dev/null; then
  echo "Installed LaunchAgent (legacy load): $LABEL"
else
  echo "error: failed to bootstrap LaunchAgent. Check '$PLIST'." >&2
  exit 1
fi

echo "Binary:   $RECONCILER_BIN"
echo "Plist:    $PLIST"
echo "Trigger:  WatchPaths on $EVENTS_FILE"
echo "Logs:     $LOG_PATH"
echo "Status:   launchctl print gui/$UID_NUM/$LABEL | head"
