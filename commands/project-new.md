---
description: "Register a new project in claude-kanban and scaffold its folder (README, Plan, Design, Tasks, Sessions, Spikes/)."
argument-hint: "<slug> \"<Display Name>\""
allowed-tools: [Bash]
---

# Register a new project

The user typed: `$ARGUMENTS`

Parse arguments into:
- `SLUG`: first token (no spaces; lowercase-with-dashes recommended)
- `DISPLAY`: remainder (strip outer quotes if any). If missing, default to the slug.

Validate SLUG is non-empty and matches `[a-zA-Z0-9_-]+`. If invalid, explain and stop.

## Emit the project_new event

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" project_new --slug "$SLUG" --display_name "$DISPLAY"
```

The reconciler will:
1. Add the slug to `~/.claude/data/claude-kanban/projects.json`
2. Create `<vault>/Projects/<slug>/` with README.md, Plan.md, Design.md from templates
3. Render the project on `_Index.md`

## Optional: assign the current session immediately

Ask the user: "Assign this session to `<slug>` now? [Y/n]"

If yes:

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" project_assigned --slug "$SLUG"
```

## Confirm

Display:

```
Registered: <slug> ("<Display Name>")
Folder:     <vault>/Projects/<slug>/
Files seeded: README.md, Plan.md, Design.md
Session assigned: <yes|no>

Tip: add a `.claude-project` file at your worktree root with the slug,
and future sessions will auto-resolve to this project.
```
