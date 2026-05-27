#!/usr/bin/env bash
# event-emit.sh — append a single JSON Lines event to events.jsonl
#
# Usage:
#   event-emit.sh <event_name> [--key value ...]      # no stdin needed
#   event-emit.sh <event_name> [--key value ...] <<<"$HOOK_STDIN_JSON"
#
# The hook stdin JSON (when present) supplies session_id, cwd, transcript_path,
# and prompt. If stdin is empty, falls back to CLAUDE_CODE_SESSION_ID env and PWD.

set -u

DATA_DIR="${CLAUDE_KANBAN_DATA_DIR:-$HOME/.claude/data/claude-kanban}"
EVENTS_FILE="$DATA_DIR/events.jsonl"
mkdir -p "$DATA_DIR"

EVENT="${1:-unknown}"
shift || true

STDIN_JSON=""
# Read stdin only if data is actually piped in. macOS's system bash is 3.2
# which doesn't support fractional `read -t` timeouts, so we use perl's
# IO::Select to do a non-blocking peek (perl is preinstalled on macOS).
# This avoids `cat` blocking forever on a non-tty pipe with no data.
if [ ! -t 0 ]; then
  STDIN_JSON="$(perl -MIO::Select -e '
    my $s = IO::Select->new(\*STDIN);
    if ($s->can_read(0.2)) { local $/; print <STDIN>; }
  ' 2>/dev/null || true)"
fi

field_from_stdin() {
  local key="$1"
  if [ -z "$STDIN_JSON" ]; then
    printf ''
    return
  fi
  printf '%s' "$STDIN_JSON" | jq -r --arg k "$key" '.[$k] // ""' 2>/dev/null
}

SESSION_ID="$(field_from_stdin session_id)"
[ -z "$SESSION_ID" ] && SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}"

CWD="$(field_from_stdin cwd)"
[ -z "$CWD" ] && CWD="$PWD"

TRANSCRIPT_PATH="$(field_from_stdin transcript_path)"
PROMPT="$(field_from_stdin prompt)"

REPO="$(basename "$CWD" 2>/dev/null || echo "")"
BRANCH="$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

# ULID-ish: nanoseconds since epoch + 8 hex chars
NANOS="$(date +%s)$(printf '%09d' "$(date +%N 2>/dev/null | sed 's/^0*//' )" 2>/dev/null || echo "000000000")"
if [ -z "$NANOS" ] || [ "$NANOS" = "000000000" ]; then
  # macOS date has no %N — synthesize
  NANOS="$(date +%s)$(printf '%09d' $((RANDOM * RANDOM % 1000000000)))"
fi
RAND_HEX="$(od -An -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || echo "00000000")"
ULID="${NANOS}-${RAND_HEX}"

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build base JSON with jq for safe escaping
BASE_JSON="$(jq -n -c \
  --arg ulid "$ULID" \
  --arg ts "$TS" \
  --arg event "$EVENT" \
  --arg session_id "$SESSION_ID" \
  --arg cwd "$CWD" \
  --arg repo "$REPO" \
  --arg branch "$BRANCH" \
  --arg transcript_path "$TRANSCRIPT_PATH" \
  --arg prompt "$PROMPT" \
  '{ulid:$ulid, ts:$ts, event:$event, session_id:$session_id, cwd:$cwd, repo:$repo, branch:$branch, transcript_path:$transcript_path, prompt:$prompt}')"

# Merge any --key value pairs into the JSON
while [ "$#" -gt 0 ]; do
  case "$1" in
    --*)
      key="${1#--}"
      value="${2-}"
      BASE_JSON="$(printf '%s' "$BASE_JSON" | jq -c --arg k "$key" --arg v "$value" '.[$k] = $v')"
      shift 2 || shift
      ;;
    *)
      shift
      ;;
  esac
done

printf '%s\n' "$BASE_JSON" >> "$EVENTS_FILE"
