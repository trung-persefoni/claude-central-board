#!/usr/bin/env bun
/**
 * claude-kanban reconciler
 *
 * Reads events.jsonl, derives state, and renders the Obsidian vault:
 *   - <vault>/Projects/_Index.md       (project rollup board)
 *   - <vault>/Projects/<slug>/Sessions.md
 *   - <vault>/Projects/<slug>/Tasks.md (user Backlog preserved; other columns reconciler-owned)
 *
 * Side-effects of certain events:
 *   - note_plan / note_design: append timestamped paragraph to Plan.md / Design.md
 *   - spike: create Spikes/<date>-<slug>.md
 *   - project_new: register in projects.json and scaffold the folder from templates
 *
 * Single-instance via mkdir lockdir. Idempotent on event replay via stored
 * cursor + per-event ulids for note appends.
 *
 * Usage:
 *   bun run reconciler.ts            # one-shot tick
 *   bun run reconciler.ts --tick     # same (alias)
 *   bun run reconciler.ts --watch    # not implemented; launchd handles cadence
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, rmdirSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

// ────────────────────────────────────────────────────────────────────────────
// Paths & config
// ────────────────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.CLAUDE_KANBAN_DATA_DIR ?? join(homedir(), ".claude/data/claude-kanban");
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(homedir(), "workspace/claude-kanban");
const EVENTS_FILE = join(DATA_DIR, "events.jsonl");
const STATE_FILE = join(DATA_DIR, "state.json");
const CONFIG_FILE = join(DATA_DIR, "config.json");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");
const LOCK_DIR = join(DATA_DIR, ".reconciler.lock");
const LOG_FILE = join(DATA_DIR, "reconciler.log");
const TEMPLATES_DIR = join(PLUGIN_ROOT, "scripts/templates");

type Config = {
  vaultPath: string;
  reconcilerInterval?: number;
  stalenessActiveMin?: number;   // minutes before Active → Idle (default 5)
  stalenessStaleMin?: number;    // minutes before Idle → Stale (default 120)
};

type SessionRec = {
  sessionId: string;
  project: string;
  cwd: string;
  repo: string;
  branch: string;
  startedAt: string;
  lastActivity: string;
  lastPrompt: string;
  endedAt?: string;
  claimedTaskId?: string;
};

type TaskColumn = "Doing" | "Blocked" | "Done" | "Archive";
type TaskRec = {
  id: string;
  project: string;
  text: string;
  column: TaskColumn;
  createdAt: string;
  updatedAt: string;
  sessions: string[];
  blockedReason?: string;
};

type ProjectRec = {
  slug: string;
  displayName: string;
  createdAt: string;
};

type State = {
  cursor: number;
  sessions: Record<string, SessionRec>;
  tasks: Record<string, TaskRec>;
  appliedNoteUlids: string[];          // for idempotency of note appends
  appliedSpikeUlids: string[];
};

type Event = {
  ulid: string;
  ts: string;
  event: string;
  session_id?: string;
  cwd?: string;
  repo?: string;
  branch?: string;
  prompt?: string;
  project?: string;
  slug?: string;
  display_name?: string;
  text?: string;
  reason?: string;
  type?: string;       // for note: "plan" | "design"
  body?: string;
  resolved_via?: string;
};

// ────────────────────────────────────────────────────────────────────────────
// Logging — to stderr if interactive, else log file
// ────────────────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try {
    writeFileSync(LOG_FILE, line, { flag: "a" });
  } catch {}
  if (process.stderr.isTTY) process.stderr.write(line);
}

// ────────────────────────────────────────────────────────────────────────────
// Single-instance lock
// ────────────────────────────────────────────────────────────────────────────

function acquireLock(): boolean {
  try {
    mkdirSync(LOCK_DIR);
    return true;
  } catch {
    // Stale lock detection: if older than 60s, force release
    try {
      const stats = statSync(LOCK_DIR);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs > 60_000) {
        rmdirSync(LOCK_DIR);
        log(`reclaimed stale lock (age ${Math.round(ageMs / 1000)}s)`);
        try {
          mkdirSync(LOCK_DIR);
          return true;
        } catch {}
      }
    } catch {}
    return false;
  }
}

function releaseLock(): void {
  try { rmdirSync(LOCK_DIR); } catch {}
}

// ────────────────────────────────────────────────────────────────────────────
// State load/save
// ────────────────────────────────────────────────────────────────────────────

function loadState(): State {
  if (!existsSync(STATE_FILE)) {
    return { cursor: 0, sessions: {}, tasks: {}, appliedNoteUlids: [], appliedSpikeUlids: [] };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return { cursor: 0, sessions: {}, tasks: {}, appliedNoteUlids: [], appliedSpikeUlids: [] };
  }
}

function saveState(state: State): void {
  atomicWrite(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadConfig(): Config | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Config; } catch { return null; }
}

function loadProjects(): Record<string, ProjectRec> {
  if (!existsSync(PROJECTS_FILE)) return {};
  try { return JSON.parse(readFileSync(PROJECTS_FILE, "utf8")) as Record<string, ProjectRec>; } catch { return {}; }
}

function saveProjects(projects: Record<string, ProjectRec>): void {
  atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// ────────────────────────────────────────────────────────────────────────────
// Atomic write
// ────────────────────────────────────────────────────────────────────────────

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // Skip if unchanged (avoid touching mtime in Obsidian)
  if (existsSync(path)) {
    try {
      const cur = readFileSync(path, "utf8");
      if (cur === content) return;
    } catch {}
  }
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

// ────────────────────────────────────────────────────────────────────────────
// Event replay
// ────────────────────────────────────────────────────────────────────────────

function readNewEvents(state: State): { events: Event[]; newCursor: number } {
  if (!existsSync(EVENTS_FILE)) return { events: [], newCursor: 0 };
  const stats = statSync(EVENTS_FILE);
  if (stats.size < state.cursor) {
    // file truncated/rotated — replay from start
    log(`events.jsonl shrunk (${stats.size} < ${state.cursor}); replaying from 0`);
    return readEventsRange(0, stats.size);
  }
  return readEventsRange(state.cursor, stats.size);
}

function readEventsRange(start: number, end: number): { events: Event[]; newCursor: number } {
  if (end <= start) return { events: [], newCursor: end };
  const fd = openSync(EVENTS_FILE, "r");
  try {
    const buf = Buffer.alloc(end - start);
    readSync(fd, buf, 0, end - start, start);
    const lines = buf.toString("utf8").split("\n").filter(l => l.trim());
    const events: Event[] = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line) as Event); } catch { /* skip malformed */ }
    }
    return { events, newCursor: end };
  } finally {
    closeSync(fd);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Task ID — stable hash of (project, text)
// ────────────────────────────────────────────────────────────────────────────

function taskId(project: string, text: string): string {
  return createHash("sha1").update(`${project} ${text}`).digest("hex").slice(0, 12);
}

function slugifyDate(ts: string): string {
  return ts.slice(0, 10); // YYYY-MM-DD from ISO
}

// ────────────────────────────────────────────────────────────────────────────
// Event handlers — mutate state in place
// ────────────────────────────────────────────────────────────────────────────

function applyEvent(state: State, ev: Event, ctx: { config: Config; projects: Record<string, ProjectRec> }): void {
  const sid = ev.session_id ?? "";

  switch (ev.event) {
    case "SessionStart": {
      if (!sid) return;
      const project = ev.project ?? "_unassigned";
      state.sessions[sid] = {
        sessionId: sid,
        project,
        cwd: ev.cwd ?? "",
        repo: ev.repo ?? "",
        branch: ev.branch ?? "",
        startedAt: ev.ts,
        lastActivity: ev.ts,
        lastPrompt: "",
      };
      break;
    }
    case "Stop":
    case "UserPromptSubmit": {
      const s = state.sessions[sid];
      if (!s) return;
      s.lastActivity = ev.ts;
      if (ev.prompt) s.lastPrompt = ev.prompt;
      break;
    }
    case "SessionEnd": {
      const s = state.sessions[sid];
      if (!s) return;
      s.lastActivity = ev.ts;
      s.endedAt = ev.ts;
      break;
    }
    case "project_assigned": {
      const s = state.sessions[sid];
      if (!s) return;
      const target = ev.slug ?? "_unassigned";
      if (target !== "_unassigned" && !ctx.projects[target]) {
        log(`project_assigned: unknown slug "${target}", ignoring`);
        return;
      }
      s.project = target;
      s.lastActivity = ev.ts;
      // Reassign any claimed task to the new project? No — task stays with its original project.
      break;
    }
    case "project_new": {
      const slug = ev.slug;
      const displayName = ev.display_name ?? slug ?? "";
      if (!slug) return;
      if (ctx.projects[slug]) {
        log(`project_new: "${slug}" already exists`);
        return;
      }
      ctx.projects[slug] = { slug, displayName, createdAt: ev.ts };
      saveProjects(ctx.projects);
      scaffoldProjectFolder(ctx.config.vaultPath, slug, displayName);
      break;
    }
    case "task_claim": {
      const s = state.sessions[sid];
      if (!s || !ev.text) return;
      const id = taskId(s.project, ev.text);
      const existing = state.tasks[id];
      if (existing) {
        if (existing.column !== "Doing") existing.column = "Doing";
        if (!existing.sessions.includes(sid)) existing.sessions.push(sid);
        existing.updatedAt = ev.ts;
      } else {
        // No tracked task yet — but it may exist in user-authored Backlog.
        // Promote to tracked task in Doing. Renderer will strip from Backlog.
        state.tasks[id] = {
          id,
          project: s.project,
          text: ev.text,
          column: "Doing",
          createdAt: ev.ts,
          updatedAt: ev.ts,
          sessions: [sid],
        };
      }
      s.claimedTaskId = id;
      s.lastActivity = ev.ts;
      break;
    }
    case "task_new": {
      const s = state.sessions[sid];
      if (!s || !ev.text) return;
      const id = taskId(s.project, ev.text);
      if (state.tasks[id]) {
        // Already exists; behave like task_claim
        const t = state.tasks[id];
        if (t.column === "Done" || t.column === "Archive") t.column = "Doing";
        if (!t.sessions.includes(sid)) t.sessions.push(sid);
        t.updatedAt = ev.ts;
      } else {
        state.tasks[id] = {
          id, project: s.project, text: ev.text, column: "Doing",
          createdAt: ev.ts, updatedAt: ev.ts, sessions: [sid],
        };
      }
      s.claimedTaskId = id;
      s.lastActivity = ev.ts;
      break;
    }
    case "task_done": {
      const s = state.sessions[sid];
      if (!s) return;
      const id = ev.text ? taskId(s.project, ev.text) : s.claimedTaskId;
      if (!id) return;
      const t = state.tasks[id];
      if (!t) return;
      t.column = "Done";
      t.sessions = t.sessions.filter(x => x !== sid);
      t.updatedAt = ev.ts;
      if (s.claimedTaskId === id) s.claimedTaskId = undefined;
      s.lastActivity = ev.ts;
      break;
    }
    case "task_block": {
      const s = state.sessions[sid];
      if (!s) return;
      const id = ev.text ? taskId(s.project, ev.text) : s.claimedTaskId;
      if (!id) return;
      const t = state.tasks[id];
      if (!t) return;
      t.column = "Blocked";
      t.blockedReason = ev.reason ?? "";
      t.updatedAt = ev.ts;
      s.lastActivity = ev.ts;
      break;
    }
    case "note_plan":
    case "note_design": {
      if (!ev.ulid || state.appliedNoteUlids.includes(ev.ulid)) return;
      const s = state.sessions[sid];
      const project = s?.project ?? "_unassigned";
      if (project === "_unassigned") {
        log(`${ev.event}: session ${sid} has no project; skipping (not marked applied — will retry on replay)`);
        return;
      }
      const kind = ev.event === "note_plan" ? "Plan" : "Design";
      const target = join(ctx.config.vaultPath, "Projects", project, `${kind}.md`);
      appendNote(target, ev.ts, ev.body ?? ev.text ?? "", ev.ulid, sid);
      state.appliedNoteUlids.push(ev.ulid);  // mark only after successful write
      if (s) s.lastActivity = ev.ts;
      break;
    }
    case "spike": {
      if (!ev.ulid || state.appliedSpikeUlids.includes(ev.ulid)) return;
      const s = state.sessions[sid];
      const project = s?.project ?? "_unassigned";
      if (project === "_unassigned" || !ev.slug) return;
      const date = slugifyDate(ev.ts);
      const safe = (ev.slug || "spike").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      const spikeDir = join(ctx.config.vaultPath, "Projects", project, "Spikes");
      mkdirSync(spikeDir, { recursive: true });
      const target = join(spikeDir, `${date}-${safe}.md`);
      if (!existsSync(target)) {
        const body = `# Spike: ${ev.slug}\n\nCreated: ${ev.ts}\nSession: \`${sid.slice(0,8)}\`\n\n## Question\n\n_What are we investigating?_\n\n## Findings\n\n_Notes go here._\n\n## Outcome\n\n_Decision, follow-ups, links._\n`;
        atomicWrite(target, body);
      }
      state.appliedSpikeUlids.push(ev.ulid);
      if (s) s.lastActivity = ev.ts;
      break;
    }
    default:
      // unknown event types ignored
      break;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Note append with idempotency
// ────────────────────────────────────────────────────────────────────────────

function appendNote(path: string, ts: string, body: string, ulid: string, sid: string): void {
  mkdirSync(dirname(path), { recursive: true });
  let cur = "";
  if (existsSync(path)) cur = readFileSync(path, "utf8");
  // Idempotency guard
  if (cur.includes(`<!-- claude-kanban:note:${ulid} -->`)) return;
  const stamp = `\n\n### ${ts} · session \`${sid.slice(0,8)}\`\n${body.trim()}\n<!-- claude-kanban:note:${ulid} -->\n`;
  writeFileSync(path, cur + stamp);
}

// ────────────────────────────────────────────────────────────────────────────
// Staleness sweep
// ────────────────────────────────────────────────────────────────────────────

type SessionColumn = "Active" | "Idle" | "Stale" | "Ended";

function sessionColumn(s: SessionRec, cfg: Config): SessionColumn {
  if (s.endedAt) return "Ended";
  const activeMin = cfg.stalenessActiveMin ?? 5;
  const staleMin = cfg.stalenessStaleMin ?? 120;
  const ageMin = (Date.now() - Date.parse(s.lastActivity)) / 60_000;
  if (ageMin <= activeMin) return "Active";
  if (ageMin <= staleMin) return "Idle";
  return "Stale";
}

function humanAge(iso: string): string {
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ────────────────────────────────────────────────────────────────────────────
// Markdown rendering — Obsidian kanban-plugin format
// ────────────────────────────────────────────────────────────────────────────

const FRONTMATTER = "---\n\nkanban-plugin: board\n\n---\n\n";
const SETTINGS_BLOCK = '\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%\n';

function renderSessionsBoard(project: string, sessions: SessionRec[], cfg: Config): string {
  const COLUMNS: SessionColumn[] = ["Active", "Idle", "Stale", "Ended"];
  const byCol: Record<SessionColumn, SessionRec[]> = { Active: [], Idle: [], Stale: [], Ended: [] };
  for (const s of sessions) byCol[sessionColumn(s, cfg)].push(s);
  for (const c of COLUMNS) byCol[c].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

  let out = FRONTMATTER;
  out += `# Sessions · ${project}\n\n`;
  for (const col of COLUMNS) {
    out += `## ${col}\n\n`;
    for (const s of byCol[col]) {
      const short = s.sessionId.slice(0, 8);
      const repoBranch = [s.repo, s.branch].filter(Boolean).join(" · ");
      const title = `Session \`${short}\`${repoBranch ? " — " + repoBranch : ""}`;
      out += `- [ ] ${title}\n`;
      out += `    Project: ${s.project}\n`;
      out += `    Worktree: ${s.cwd}\n`;
      if (s.branch) out += `    Branch: ${s.branch}\n`;
      out += `    Started: ${s.startedAt}\n`;
      out += `    Last active: ${s.lastActivity} (${humanAge(s.lastActivity)})\n`;
      if (s.claimedTaskId) out += `    Task: \`${s.claimedTaskId}\`\n`;
      if (s.lastPrompt) out += `    Last prompt: ${truncate(s.lastPrompt, 200)}\n`;
      if (s.endedAt) out += `    Ended: ${s.endedAt}\n`;
      out += "\n";
    }
  }
  out += SETTINGS_BLOCK;
  return out;
}

function renderTasksBoard(project: string, tasks: TaskRec[], existingBacklog: string): string {
  const COLUMNS: TaskColumn[] = ["Doing", "Blocked", "Done", "Archive"];
  const byCol: Record<TaskColumn, TaskRec[]> = { Doing: [], Blocked: [], Done: [], Archive: [] };
  for (const t of tasks) byCol[t.column].push(t);
  for (const c of COLUMNS) byCol[c].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Strip claimed task texts from existingBacklog so we don't double-render
  const claimedTexts = new Set<string>();
  for (const t of tasks) if (t.column !== "Archive") claimedTexts.add(t.text);
  const cleanedBacklog = stripClaimedFromBacklog(existingBacklog, claimedTexts);

  let out = FRONTMATTER;
  out += `# Tasks · ${project}\n\n`;
  out += `## Backlog\n\n`;
  out += cleanedBacklog;
  if (!cleanedBacklog.endsWith("\n")) out += "\n";
  out += "\n";

  for (const col of COLUMNS) {
    out += `## ${col}\n\n`;
    for (const t of byCol[col]) {
      out += `- [${col === "Done" || col === "Archive" ? "x" : " "}] ${t.text}\n`;
      out += `    id: \`${t.id}\`\n`;
      out += `    Created: ${t.createdAt}\n`;
      out += `    Updated: ${t.updatedAt}\n`;
      if (t.sessions.length) {
        out += `    Sessions: ${t.sessions.map(x => "`" + x.slice(0,8) + "`").join(", ")}\n`;
      }
      if (col === "Blocked" && t.blockedReason) {
        out += `    Reason: ${t.blockedReason}\n`;
      }
      out += "\n";
    }
  }
  out += SETTINGS_BLOCK;
  return out;
}

function stripClaimedFromBacklog(backlog: string, claimedTexts: Set<string>): string {
  if (claimedTexts.size === 0) return backlog;
  const lines = backlog.split("\n");
  const out: string[] = [];
  let skipIndent = false;
  for (const line of lines) {
    const taskMatch = line.match(/^- \[ \] (.+)$/);
    if (taskMatch && claimedTexts.has(taskMatch[1]!.trim())) {
      skipIndent = true;
      continue;
    }
    if (skipIndent) {
      // Skip indented description lines belonging to the removed task
      if (/^( {4}|\t)/.test(line)) continue;
      skipIndent = false;
    }
    out.push(line);
  }
  return out.join("\n");
}

function parseBacklog(tasksMdPath: string): string {
  if (!existsSync(tasksMdPath)) return "";
  const content = readFileSync(tasksMdPath, "utf8");
  // Find "## Backlog" section, capture until next "## " or settings block
  const lines = content.split("\n");
  let inBacklog = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const col = line.slice(3).trim();
      inBacklog = col === "Backlog";
      continue;
    }
    if (line.startsWith("%% kanban:settings")) break;
    if (inBacklog) collected.push(line);
  }
  // Trim leading/trailing blank lines but preserve internal structure
  while (collected.length && collected[0]!.trim() === "") collected.shift();
  while (collected.length && collected[collected.length - 1]!.trim() === "") collected.pop();
  return collected.join("\n");
}

function renderIndex(projects: Record<string, ProjectRec>, sessions: Record<string, SessionRec>, tasks: Record<string, TaskRec>, cfg: Config): string {
  type Bucket = "Hot" | "Warm" | "Cold" | "Archived";
  const buckets: Record<Bucket, ProjectRec[]> = { Hot: [], Warm: [], Cold: [], Archived: [] };

  for (const p of Object.values(projects)) {
    const projSessions = Object.values(sessions).filter(s => s.project === p.slug);
    const sessionCols = projSessions.map(s => sessionColumn(s, cfg));
    let bucket: Bucket;
    if (sessionCols.includes("Active")) bucket = "Hot";
    else if (sessionCols.includes("Idle")) bucket = "Warm";
    else bucket = "Cold";
    buckets[bucket].push(p);
  }

  let out = FRONTMATTER + "# Projects · Index\n\n";
  for (const b of ["Hot", "Warm", "Cold", "Archived"] as Bucket[]) {
    out += `## ${b}\n\n`;
    for (const p of buckets[b]) {
      const projSessions = Object.values(sessions).filter(s => s.project === p.slug);
      const projTasks = Object.values(tasks).filter(t => t.project === p.slug);
      const doing = projTasks.filter(t => t.column === "Doing").length;
      const blocked = projTasks.filter(t => t.column === "Blocked").length;
      const lastActivity = projSessions
        .map(s => s.lastActivity)
        .sort()
        .pop();
      out += `- [ ] [[${p.slug}/README|${p.displayName}]]\n`;
      out += `    Slug: \`${p.slug}\`\n`;
      out += `    Sessions: ${projSessions.length} (${summarizeCols(projSessions, cfg)})\n`;
      out += `    Tasks: ${doing} doing, ${blocked} blocked, ${projTasks.length} total\n`;
      if (lastActivity) out += `    Last activity: ${humanAge(lastActivity)}\n`;
      out += "\n";
    }
  }
  out += SETTINGS_BLOCK;
  return out;
}

function summarizeCols(ss: SessionRec[], cfg: Config): string {
  if (ss.length === 0) return "none";
  const counts: Record<string, number> = {};
  for (const s of ss) {
    const c = sessionColumn(s, cfg);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// ────────────────────────────────────────────────────────────────────────────
// Project folder scaffolding
// ────────────────────────────────────────────────────────────────────────────

function scaffoldProjectFolder(vaultPath: string, slug: string, displayName: string): void {
  const dir = join(vaultPath, "Projects", slug);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "Spikes"), { recursive: true });

  // Render templates with simple {{TOKEN}} substitution
  const tokens = {
    "PROJECT_SLUG": slug,
    "PROJECT_NAME": displayName,
    "CREATED_AT": new Date().toISOString().slice(0, 10),
  };
  const seed = (tmplName: string, target: string) => {
    const targetPath = join(dir, target);
    if (existsSync(targetPath)) return;
    const tmplPath = join(TEMPLATES_DIR, tmplName);
    if (!existsSync(tmplPath)) return;
    let content = readFileSync(tmplPath, "utf8");
    for (const [k, v] of Object.entries(tokens)) {
      content = content.replaceAll(`{{${k}}}`, v);
    }
    writeFileSync(targetPath, content);
  };
  seed("readme.md.tmpl", "README.md");
  seed("plan.md.tmpl", "Plan.md");
  seed("design.md.tmpl", "Design.md");
}

// ────────────────────────────────────────────────────────────────────────────
// Vault rendering pass
// ────────────────────────────────────────────────────────────────────────────

function renderVault(state: State, cfg: Config, projects: Record<string, ProjectRec>): void {
  // Ensure base dirs exist
  const projectsDir = join(cfg.vaultPath, "Projects");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(join(projectsDir, "_unassigned"), { recursive: true });

  // Collect all project slugs that appear in state (registered + _unassigned)
  const slugs = new Set<string>(Object.keys(projects));
  slugs.add("_unassigned");
  for (const s of Object.values(state.sessions)) slugs.add(s.project);
  for (const t of Object.values(state.tasks)) slugs.add(t.project);

  for (const slug of slugs) {
    const dir = join(projectsDir, slug);
    mkdirSync(dir, { recursive: true });

    const projSessions = Object.values(state.sessions).filter(s => s.project === slug);
    const projTasks = Object.values(state.tasks).filter(t => t.project === slug);

    // Sessions.md — reconciler-owned
    atomicWrite(join(dir, "Sessions.md"), renderSessionsBoard(slug, projSessions, cfg));

    // Tasks.md — preserve user-authored Backlog
    const backlog = parseBacklog(join(dir, "Tasks.md"));
    atomicWrite(join(dir, "Tasks.md"), renderTasksBoard(slug, projTasks, backlog));
  }

  // _Index.md
  atomicWrite(join(projectsDir, "_Index.md"), renderIndex(projects, state.sessions, state.tasks, cfg));
}

// ────────────────────────────────────────────────────────────────────────────
// Main tick
// ────────────────────────────────────────────────────────────────────────────

function tick(): void {
  const cfg = loadConfig();
  if (!cfg) {
    log("config.json not found; run /claude-kanban:setup first");
    return;
  }
  if (!cfg.vaultPath) {
    log("config.json missing vaultPath; skipping tick");
    return;
  }

  if (!acquireLock()) {
    log("another reconciler instance is running; skipping tick");
    return;
  }
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const state = loadState();
    const projects = loadProjects();

    const { events, newCursor } = readNewEvents(state);
    for (const ev of events) {
      applyEvent(state, ev, { config: cfg, projects });
    }
    state.cursor = newCursor;

    // Bound idempotency lists to avoid unbounded growth
    if (state.appliedNoteUlids.length > 5000) state.appliedNoteUlids = state.appliedNoteUlids.slice(-2500);
    if (state.appliedSpikeUlids.length > 5000) state.appliedSpikeUlids = state.appliedSpikeUlids.slice(-2500);

    renderVault(state, cfg, projects);
    saveState(state);

    if (events.length > 0) log(`tick applied ${events.length} events`);
  } catch (err) {
    log(`tick error: ${(err as Error).message}\n${(err as Error).stack}`);
  } finally {
    releaseLock();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Entry
// ────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--watch")) {
  log("--watch not implemented; launchd should invoke --tick on an interval");
  process.exit(2);
}
tick();
