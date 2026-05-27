---
description: "Smart-update the current project's README.md based on your intent. Reads + restructures, doesn't just append."
argument-hint: "<intent — describe what the README should say, or what to change>"
allowed-tools: [Bash, Read, Edit, Write]
---

# Update project README

The user typed: `$ARGUMENTS`

The intent string `$ARGUMENTS` describes the change. It can be a high-level
description ("this project is for refactoring the frai service") or a targeted
edit ("update the Scope section to say X"). Apply the intent thoughtfully —
preserve structure where it still makes sense, restructure where the intent
demands it. Do **not** append a timestamped paragraph (that's what
`/claude-kanban:note` is for).

## Steps

### 1. Resolve the current project

```bash
eval "$("$CLAUDE_PLUGIN_ROOT/scripts/lib/resolve-project.sh" --export)"
```

If this exits non-zero, surface the stderr to the user and stop. They need to
claim or create a project first.

### 2. Read the existing README

```bash
README_PATH="$PROJECT_DIR/README.md"
```

Use the `Read` tool on `$README_PATH`. If it doesn't exist (unusual — the
reconciler scaffolds it on project-new), tell the user and stop.

### 3. Apply the intent

Apply `$ARGUMENTS` to the README content. Guidance:

- **Preserve the wikilink section** (`[[Plan]]`, `[[Design]]`, `[[Tasks]]`, `[[Sessions]]`, `Spikes/`) — Obsidian relies on these.
- **Preserve the "Project slug" frontmatter** line.
- The **What is this project?**, **Scope**, and **Owning worktrees / repos** sections are the ones most worth refining based on intent.
- If the intent introduces new top-level concerns the template didn't cover, add a new `##` section in a sensible place (above "Where things live", which is meta-navigation).
- Keep the tone concise. README is a one-page orientation doc, not a wiki.
- If the intent is vague or contradicts the existing content in a way you can't reconcile, **ask the user a clarifying question** rather than guessing.

Write the updated content with the `Write` tool (full overwrite is fine since
README is fully user-owned and reconciler never touches it).

### 4. Emit an audit event

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" readme_updated \
  --project "$PROJECT_SLUG" \
  --summary "$ARGUMENTS"
```

The reconciler ignores `readme_updated` events — they're recorded in
`events.jsonl` for audit history only. (If you want them to surface on the
kanban board later, that's a reconciler change.)

### 5. Confirm

Display a 2-3 line summary of what changed (sections updated, sections added),
plus:

> "README updated: `<vault>/Projects/<slug>/README.md`. Open it in Obsidian to review."
