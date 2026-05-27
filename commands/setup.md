---
description: "First-run wizard for claude-kanban: pick vault path, scaffold data dir, install LaunchAgent, render initial _Index board."
argument-hint: "[--vault=<path>]"
allowed-tools: [Bash, Read, Write]
---

# claude-kanban setup

Initialize the claude-kanban workspace.

Arguments (raw): `$ARGUMENTS`

## Steps

### 1. Determine vault path

Parse `--vault=<path>` from arguments if present. Otherwise, ask the user:

> "Where is your Obsidian vault? (default: `~/workspace/shared-mcp-vault`)"

Resolve `~` to `$HOME`. If the user supplied no path and no default exists, ask again.

### 2. Verify vault path

Run:

```bash
test -d "<resolved-vault-path>"
```

If it doesn't exist, ask whether to create it. Create with `mkdir -p` if confirmed; abort otherwise.

### 3. Write config.json and initialize data files

Create the data directory and initial files (using bash):

```bash
DATA_DIR="$HOME/.claude/data/claude-kanban"
mkdir -p "$DATA_DIR"

# Write config.json (replace <vault> with the resolved path)
cat > "$DATA_DIR/config.json" <<EOF
{
  "vaultPath": "<vault>",
  "reconcilerInterval": 10,
  "stalenessActiveMin": 5,
  "stalenessStaleMin": 120
}
EOF

# Initialize projects and worktree-map only if missing (preserves prior data)
[ -f "$DATA_DIR/projects.json" ] || echo '{}' > "$DATA_DIR/projects.json"
[ -f "$DATA_DIR/worktree-map.json" ] || echo '{}' > "$DATA_DIR/worktree-map.json"
[ -f "$DATA_DIR/events.jsonl" ] || touch "$DATA_DIR/events.jsonl"
```

### 4. Install the LaunchAgent

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/install-launchd.sh"
```

This compiles `scripts/reconciler.ts` to a standalone signed binary at
`~/Library/Application Support/claude-kanban/bin/reconciler`, then registers a
LaunchAgent that runs the binary **only when `events.jsonl` changes**
(WatchPaths-triggered, no polling).

`bun` is required *at install time* to compile the binary. It is not required
at runtime. If `bun` is missing the script will exit with an install hint —
surface the error and stop.

### 5. Bootstrap the vault (one immediate reconciler tick)

```bash
"$HOME/Library/Application Support/claude-kanban/bin/reconciler"
```

If the compiled binary somehow isn't present, fall back to:

```bash
bun run "$CLAUDE_PLUGIN_ROOT/scripts/reconciler.ts"
```

### 6. Confirm to the user

Display:

```
claude-kanban is set up.

Vault:       <vault>/Projects/
Data:        ~/.claude/data/claude-kanban/
Binary:      ~/Library/Application Support/claude-kanban/bin/reconciler
LaunchAgent: com.persefoni.claude-kanban.reconciler (event-driven)

Next steps:
  1. Register a project:  /claude-kanban:project-new <slug> "<Display Name>"
  2. Assign sessions:     drop a .claude-project file at your worktree root,
                          OR run /claude-kanban:project <slug> after starting a session.
  3. Open <vault>/Projects/_Index.md in Obsidian to see the board.
```
