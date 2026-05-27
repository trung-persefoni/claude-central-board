---
description: "Append a timestamped paragraph to Plan.md / Design.md / Note.md (default). Note.md is a casual fallback for things that aren't plans, designs, or tasks."
argument-hint: "[plan|design] <body text>"
allowed-tools: [Bash, Read, Write, Edit]
---

# Append a note

The user typed: `$ARGUMENTS`

## Parse

Inspect the first whitespace-separated token of `$ARGUMENTS`:

- If it is exactly `plan` → `KIND=plan`, `BODY=`*rest of arguments*. Append target: `Plan.md`.
- If it is exactly `design` → `KIND=design`, `BODY=`*rest of arguments*. Append target: `Design.md`.
- Otherwise → `KIND=general`, `BODY=$ARGUMENTS` (whole thing). Append target: `Note.md`.

`BODY` must be non-empty. If empty, show usage and stop:

```
Usage:
  /claude-kanban:note <body>              → append to Note.md (general)
  /claude-kanban:note plan <body>         → append to Plan.md decision log
  /claude-kanban:note design <body>       → append to Design.md decision log
```

## Mode plan / design — go through the reconciler

These are the established channels. The reconciler owns the append:

```bash
EV=note_plan        # or note_design
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" "$EV" --body "$BODY"
```

Display:

> "Appended to `<Plan.md|Design.md>` Decision log (timestamped with your
> session id). Open it in Obsidian to see the entry."

Stop.

## Mode general — direct append to Note.md

The reconciler does not yet handle `note_general` events, so this command
does the file write itself. (The Note.md file is fully user-owned just like
README.md — no risk of reconciler conflict.)

### G1. Resolve the current project

```bash
eval "$("$CLAUDE_PLUGIN_ROOT/scripts/lib/resolve-project.sh" --export)"
```

Surface stderr + stop on non-zero exit.

### G2. Ensure Note.md exists

```bash
NOTE_PATH="$PROJECT_DIR/Note.md"
TMPL="$CLAUDE_PLUGIN_ROOT/scripts/templates/note.md.tmpl"

if [ ! -f "$NOTE_PATH" ]; then
  PROJECT_NAME="$(jq -r --arg s "$PROJECT_SLUG" '.[$s].displayName // $s' "$CLAUDE_KANBAN_DATA_DIR/projects.json" 2>/dev/null || echo "$PROJECT_SLUG")"
  CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sed \
    -e "s|{{PROJECT_NAME}}|$PROJECT_NAME|g" \
    -e "s|{{CREATED_AT}}|$CREATED_AT|g" \
    "$TMPL" > "$NOTE_PATH"
fi
```

### G3. Append the entry

Read `$NOTE_PATH` with the `Read` tool. Use the `Edit` tool to insert a new
entry directly after the `## Entries` heading (and before the existing
content, so newest is at top). Entry format:

```
### <ISO timestamp UTC>  ·  session <8-char session id prefix>

<body text>

```

Where:
- ISO timestamp = `date -u +%Y-%m-%dT%H:%M:%SZ` value
- 8-char session id prefix = first 8 characters of `$CLAUDE_CODE_SESSION_ID`
- body text = `$BODY` (preserve newlines if any)

### G4. Emit an audit event

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" note_general \
  --project "$PROJECT_SLUG" \
  --body "$BODY"
```

Reconciler ignores `note_general` (Note.md is already written by step G3) —
recorded for audit only.

### G5. Confirm

> "Noted in `Note.md` for <slug>. Open it in Obsidian to see the entry."
