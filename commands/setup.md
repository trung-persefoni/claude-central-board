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

If this fails (no `bun` in PATH), surface the error to the user and stop — the rest depends on the reconciler.

### 5. Bootstrap the vault (one immediate reconciler tick)

```bash
bun run "$CLAUDE_PLUGIN_ROOT/scripts/reconciler.ts"
```

### 6. Confirm to the user

Display:

```
claude-kanban is set up.

Vault:    <vault>/Projects/
Data:     ~/.claude/data/claude-kanban/
LaunchAgent: com.claude-kanban.reconciler (every 10s)

Next steps:
  1. Register a project:  /claude-kanban:project-new <slug> "<Display Name>"
  2. Assign sessions:     drop a .claude-project file at your worktree root,
                          OR run /claude-kanban:project <slug> after starting a session.
  3. Open <vault>/Projects/_Index.md in Obsidian to see the board.
```
