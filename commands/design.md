---
description: "Smart-update the current project's Design.md — restructure architecture, choices, interfaces, risks. Use :note design for append-only decisions."
argument-hint: "<intent — describe the change in design>"
allowed-tools: [Bash, Read, Edit, Write]
---

# Update project Design

The user typed: `$ARGUMENTS`

This is the **restructure** command for Design.md. It is distinct from
`/claude-kanban:note design` (which appends a timestamped paragraph to the
Decision log). Use `:design` when the architecture, interfaces, or risk
posture changes shape — e.g. picking a database, replacing a protocol,
discovering a new failure mode that reshapes the design.

## Steps

### 1. Resolve the current project

```bash
eval "$("$CLAUDE_PLUGIN_ROOT/scripts/lib/resolve-project.sh" --export)"
```

Surface stderr + stop on non-zero exit.

### 2. Read Design.md

```bash
DESIGN_PATH="$PROJECT_DIR/Design.md"
```

Read it with the `Read` tool. The expected sections are: Architecture overview,
Key choices and trade-offs, Interfaces / contracts, Risks & mitigations,
Decision log.

### 3. Apply the intent

Update the appropriate section(s) based on `$ARGUMENTS`. Guidance:

- **Treat the `## Decision log` section as off-limits** — owned by
  `/claude-kanban:note design` appends. Don't rewrite or reorder it.
- **Architecture overview** is the highest-leverage section to refine —
  it sets the frame for everything below. Keep it short (one paragraph or
  a small list).
- **Key choices and trade-offs** uses `- _<choice>_ — _<why, what we gave
  up>_` format. Preserve that structure when adding entries.
- **Interfaces / contracts** is for APIs, schemas, data formats. Add new
  contracts, update existing ones in place.
- **Risks & mitigations** uses `- _risk_ → _mitigation_` format. Add or
  refine entries as the design evolves.
- If `$ARGUMENTS` introduces a new concern the template didn't anticipate
  (e.g. deployment topology, observability), add a new `##` section in a
  sensible place above the Decision log.
- If the intent is vague, ask a clarifying question rather than guessing.

Write the updated file with the `Write` tool.

### 4. Emit an audit event

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/event-emit.sh" design_updated \
  --project "$PROJECT_SLUG" \
  --summary "$ARGUMENTS"
```

The reconciler doesn't act on `design_updated` — recorded for audit only.

### 5. Confirm

Display a brief summary (which sections were changed) and:

> "Design updated: `<vault>/Projects/<slug>/Design.md`. The Decision log was
> preserved. Open it in Obsidian to review."
