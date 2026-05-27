---
name: using-claude-kanban
description: "Use when working in a kanban-tracked project (the SessionStart briefing said 'You are working in claude-kanban project ...'). Tells you when to proactively invoke /claude-kanban slash commands to keep README, Plan, Design, Note, Tasks, and Spikes up to date without the user asking."
---

# Using claude-kanban — proactive command reference

This skill is your reference for *when* to invoke each `/claude-kanban:*` slash command. Invoke commands **without waiting to be asked** whenever a trigger fires. Be terse — log only what you would not want to lose. Never log obvious or trivial chatter.

## The two writing modes

claude-kanban has two distinct writing patterns. Pick the right one for the situation.

| Mode | When to use | Commands |
|---|---|---|
| **Append** | A small, dated entry. The doc keeps growing. | `:note` / `:note plan` / `:note design` / `:spike` |
| **Restructure** | The *shape* of the doc needs to change. The doc gets rewritten thoughtfully. | `:readme` / `:plan` / `:design` |

If you're tempted to use a restructure command for a one-paragraph update, use append instead. Restructure is heavier and meant for genuine shape changes.

## Append-only logs

### `/claude-kanban:note plan <one paragraph>`

Fire when you make a **planning decision** worth keeping:
- Scope change (added or removed work)
- Sequence change (reordered milestones, deferred something)
- Resolved open question
- Acceptance of a constraint or deadline

Goes to `Plan.md` → Decision log. Reconciler-appended.

### `/claude-kanban:note design <one paragraph>`

Fire when you make a **technical decision** worth keeping:
- Architecture choice (chose library X, schema Y, protocol Z)
- Trade-off you explicitly accepted (chose simplicity over throughput, etc.)
- New constraint you're designing around
- Risk you decided to accept rather than mitigate

Goes to `Design.md` → Decision log. Reconciler-appended.

### `/claude-kanban:note <body>`

Fire for **everything else worth remembering** that isn't a plan, design, or task:
- An idea you don't want to lose
- A blocker you can't act on yet
- A surprising fact that doesn't fit anywhere structured
- "Come back to this later"

Goes to `Note.md`. Direct-write append (Note.md is user-owned).

### `/claude-kanban:spike <slug>`

Fire **before** spending a self-contained chunk of effort on:
- Research
- A POC or experiment
- A focused investigation that has a clear question to answer

Creates `Spikes/<date>-<slug>.md`. Write findings as you go.

## Restructure (shape-changing)

### `/claude-kanban:readme <intent>`

Fire when:
- The project's purpose or scope is clarified for the first time, and the template stubs in README are still in place
- The README is stale relative to what the project has actually become
- A major pivot reframes what the project is

Do **not** fire for small updates — those usually go in `:note` instead.

### `/claude-kanban:plan <intent>`

Fire when the *shape* of `Plan.md` should change:
- A goal is added, removed, or replaced
- Scope expands or contracts in a way that needs restructuring
- A milestone gets resequenced
- An open question is resolved and should be moved from the questions section into the body

Preserves the Decision log section (owned by `:note plan`).

### `/claude-kanban:design <intent>`

Fire when the *shape* of `Design.md` should change:
- Architecture pivot (e.g., monolith → microservices, or vice versa)
- A new interface or contract gets introduced
- A discovered failure mode reshapes the risk section
- A previously implicit assumption needs to be promoted to a documented constraint

Preserves the Decision log section (owned by `:note design`).

## Tasks

### `/claude-kanban:task` (no args)

Fire when **multiple tasks were discussed or split out of one larger item in chat**. The command will:
1. Parse the recent conversation for actionable items
2. Propose candidate tasks via AskUserQuestion (multi-select)
3. Write confirmed ones to `Tasks.md` Backlog

Use this when a planning conversation produces 3+ discrete work items and you want them captured without forcing the user to retype each one.

### `/claude-kanban:task <exact text>`

Fire when **you (or the user) are about to start work on a specific task that already exists in Backlog**. Moves it to Doing and attaches the current session.

If no matching Backlog card exists, a new Doing card is created with the given text.

### `/claude-kanban:task-new <text>`

Fire when **a single new task should be created and immediately picked up**. Goes straight to Doing.

Contrast with `:task` (no args): use `:task` when several tasks emerged from discussion; use `:task-new` when you have one task and you're starting it now.

### `/claude-kanban:task-done`

Fire when the **task currently claimed by this session is complete**. Moves it to Done.

### `/claude-kanban:task-block <reason>`

Fire when **you can't make progress on the claimed task** because of an external blocker. Records the reason and moves the card to Blocked.

## Heuristics

These help when the right command isn't obvious:

- **Plan vs Design**: If the decision is about *what* we'll build and in what order → Plan. If it's about *how* we'll build it (architecture, interface, trade-off) → Design.
- **Cross-cutting decisions**: A decision can touch both plan and design (e.g., "we're using SQLite, which means the migration plan changes"). Log to both via `:note plan` AND `:note design`. Don't try to merge them.
- **Note vs note plan vs note design**: If you can clearly name which section of Plan or Design this belongs to, route it there. If it's free-floating ("interesting paper I should read", "weird behavior I observed once") → Note.
- **Note vs Task**: Is there a clear, actionable next step a person could pick up? *Yes* → task. *No* → note.
- **`:note` vs `:plan`/`:design`**: Default to `:note`. Use the restructure commands only when the shape of the document needs to change. Daily decisions are append items.
- **Read before write**: The smart-update commands (`:readme`, `:plan`, `:design`) always Read the file before they Write. Don't skip that step.
- **Stay in scope**: Only run kanban commands for the project this session is claimed to. If you're working across multiple projects, claim the right one first via `:project <slug>`.
- **Audit events fire even on direct writes**: The smart-update commands emit `readme_updated` / `plan_updated` / `design_updated` events for the audit log. You don't need to log a separate `:note` decision unless the change has prose worth preserving in its own right.

## Anti-patterns

Things to *not* do:

- **Don't log every assistant turn.** Only log decisions you'd want to find a month later. A normal Q&A exchange is not a decision.
- **Don't claim a task with `:task` if you're not actually about to work on it.** That's what `:task-new` is for if you're creating; `:task` is for claiming intent to start.
- **Don't use `:plan` / `:design` to add a one-line note.** That's `:note plan` / `:note design`. Restructure commands are for shape changes.
- **Don't overwrite documents you didn't read.** The smart-update commands enforce Read-before-Write, but the rule applies broadly — never blind-Write a doc that may have content you didn't see.
- **Don't spike trivially.** `:spike` is for self-contained investigations with a real question. "Let me check this one file" doesn't need a spike.
- **Don't proactively rewrite a fully user-edited doc.** If README.md has been hand-edited to a polished state, only run `:readme` when the user asks or when a major pivot demands it.
