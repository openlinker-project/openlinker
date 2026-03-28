# Claude Code Workflow Guide

How to use Claude Code effectively in the OpenLinker monorepo — worktrees, parallel development, context management, skills, agents, rules, and permissions.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Session Strategy](#session-strategy)
3. [Worktrees — Parallel Development](#worktrees--parallel-development)
4. [Context Management](#context-management)
5. [Skills & Commands](#skills--commands)
6. [Agents & Subagents](#agents--subagents)
7. [Rules — Path-Scoped Instructions](#rules--path-scoped-instructions)
8. [Permissions & Settings](#permissions--settings)
9. [Hooks — Automation](#hooks--automation)
10. [Monorepo Workflow Recipes](#monorepo-workflow-recipes)
11. [Reference](#reference)

---

## Quick Start

```bash
# Start a session in the repo root
claude

# Start a focused session with a name (easier to resume later)
claude -n "auth-api"

# Start a parallel session in an isolated worktree
claude --worktree auth-ui

# Resume a previous session
claude --resume
```

---

## Session Strategy

### One Session vs. Multiple

| Scenario | Approach | Why |
|----------|----------|-----|
| Pure BE task (e.g., new API endpoint) | Single session | Tight feedback loop, all context in one place |
| Pure FE task (e.g., new page) | Single session | Same reason |
| Full-stack feature (BE + FE) | **Two worktree sessions** | Isolated files, independent verification, no context bloat |
| Quick fix touching both | Single session | Overhead of worktrees not worth it for small changes |
| Research / investigation | Subagent (Explore) | Keeps main session context clean |

### Golden Rule

**Don't pivot from BE to FE in the same session.** Context fills with `apps/api/` exploration, then `apps/web/` loads on top — you lose focus fast. Start a new session or use a worktree.

---

## Worktrees — Parallel Development

Worktrees give each Claude session an **isolated copy of the repo** with its own branch. No file conflicts, independent commits, shared git history.

### How It Works

```bash
# Terminal 1: Work on BE auth
claude --worktree auth-api -n "auth-api"

# Terminal 2: Work on FE auth (separate terminal)
claude --worktree auth-ui -n "auth-ui"
```

This creates:
```
openlinker/
├── .claude/worktrees/
│   ├── auth-api/          ← full repo checkout, branch: worktree-auth-api
│   └── auth-ui/           ← full repo checkout, branch: worktree-auth-ui
```

### Inspecting Code in Your IDE

Each worktree is a regular directory. Open it like any project:

```bash
# Open BE worktree in VS Code
code /Users/piotrswierzy/Work/Github/openlinker/.claude/worktrees/auth-api/

# Open FE worktree in a second VS Code window
code /Users/piotrswierzy/Work/Github/openlinker/.claude/worktrees/auth-ui/

# Keep the main repo in a third window for reference
code /Users/piotrswierzy/Work/Github/openlinker/
```

VS Code Source Control panel shows the correct branch per window. Git commands in each worktree only affect that worktree's branch.

**JetBrains:** File → Open → navigate to the worktree directory.

### Managing Worktrees

```bash
# List all active worktrees
git worktree list

# When done — Claude prompts on exit:
#   No changes → auto-cleaned
#   Has commits → asks to keep or remove
```

### Merging Worktree Changes Back

**Option A — Merge locally:**
```bash
cd /Users/piotrswierzy/Work/Github/openlinker/
git merge worktree-auth-api
git worktree remove .claude/worktrees/auth-api
```

**Option B — Push & PR (recommended):**
```bash
# Inside the worktree, push the branch
git push -u origin worktree-auth-api
# Create PR from worktree-auth-api → main
```

### Environment Files in Worktrees

Gitignored files (`.env`, `.env.local`) don't copy automatically. The `.worktreeinclude` file in the repo root fixes this — any file matching both `.worktreeinclude` and `.gitignore` gets copied into new worktrees.

```text
# .worktreeinclude
.env
.env.local
```

---

## Context Management

Context is your most limited resource. Every file read, grep result, and tool output consumes it.

### Do

- **Scope reads and greps** to the relevant app:
  ```
  # Good — scoped to API
  Grep "JwtStrategy" path:apps/api/src/

  # Bad — searches everything
  Grep "JwtStrategy"
  ```
- **Use `/compact`** when context grows large — it summarizes history and frees space
- **Use `/clear`** between unrelated tasks in the same session
- **Delegate investigation to subagents** — Explore agents run in their own context
- **Name sessions** (`claude -n "auth-api"`) so you can `/resume` them later with full context

### Don't

- Don't grep across `apps/` when you only need `apps/api/`
- Don't read entire large files — use `offset` and `limit` params
- Don't keep one session running for hours across different features
- Don't let exploration accumulate — compact or clear between phases

### Context Commands

| Command | Effect |
|---------|--------|
| `/compact` | Summarize conversation history, re-inject CLAUDE.md, free context |
| `/compact "keep auth changes"` | Compact with guidance on what to preserve |
| `/clear` | Start fresh within the same session |
| `/resume` | Resume a previous named session with its full context |

---

## Skills & Commands

Skills (`.claude/commands/*.md`) define reusable workflows invoked via `/slash-commands`.

### Available Skills

| Command | Purpose |
|---------|---------|
| `/plan <task>` | Generate a 5-phase implementation plan → `docs/plans/` |
| `/tech-review <file\|diff>` | Quick tech lead review (BLOCKING / IMPORTANT / SUGGESTION) |
| `/pr-review <PR number>` | Full systematic PR review |
| `/migrate <description>` | TypeORM migration creation, validation, verification |
| `/create-issue <description>` | Turn rough idea into a well-defined GitHub issue |
| `/ship <task>` | End-to-end: plan → branch → implement → test → PR |

### How Skills Work

Skills are markdown files in `.claude/commands/` with optional frontmatter:

```markdown
---
description: "Deploy the application"
argument-hint: "[environment]"
allowed-tools: Bash, Read
---

Deploy to $ARGUMENTS:

1. Run quality gate
2. Build application
3. Deploy
```

- `$ARGUMENTS` — replaced with whatever follows the `/command`
- Skills show in autocomplete when you type `/`
- Claude can also invoke skills automatically if the description matches your request

### Creating New Skills

Add a `.md` file to `.claude/commands/`:

```bash
# Example: .claude/commands/verify-contract.md
```

```markdown
---
description: "Verify BE/FE API contract alignment"
argument-hint: "[endpoint]"
allowed-tools: Read, Grep, Bash(git diff *)
---

Verify that FE expectations match BE implementation for $ARGUMENTS:

1. Find the BE controller/DTO for this endpoint
2. Find the FE TanStack Query hook and types
3. Compare request payload, response shape, status codes, error handling
4. Report any mismatches
```

Usage: `/verify-contract POST /auth/login`

---

## Agents & Subagents

Subagents run in **isolated context** — their work doesn't pollute your main session.

### Built-in Agent Types

| Agent | Use For | Has Access To |
|-------|---------|---------------|
| `Explore` | Codebase research, finding patterns, answering questions | Read, Grep, Glob, Bash (read-only) |
| `Plan` | Designing implementation strategy | Read, Grep, Glob, Bash (read-only) |
| `general-purpose` | Complex multi-step tasks, writing code | All tools |

### When to Use Each

| Situation | Tool |
|-----------|------|
| "How does the FE query layer work?" | **Explore** agent — read-only research |
| "Plan the auth implementation" | **Plan** agent — architecture design |
| "Implement the login form" | Direct work (no agent needed) |
| "Fix the BE endpoint AND update the FE hook" | **Two worktrees** — parallel full sessions |
| "Run tests and report results" | **general-purpose** agent in background |

### Example Usage

In a Claude session, agents are invoked automatically when appropriate, or you can request them explicitly:

```
Use an Explore agent to research how TanStack Query hooks are structured in apps/web/
```

```
Use a Plan agent to design the authorization model for issue #58
```

Agents return a summary to your main session — their full context stays separate.

### Custom Agents (`.claude/agents/`)

Define specialized agents for your project:

```markdown
---
name: code-reviewer
description: Expert code review for OpenLinker. Use after writing or modifying code.
tools: Read, Grep, Glob, Bash(git diff *)
model: sonnet
---

You are a senior code reviewer for OpenLinker.

Review against:
- @docs/engineering-standards.md
- @docs/architecture-overview.md

Focus on:
1. Hexagonal architecture violations
2. Port/adapter boundary correctness
3. Test coverage
4. Naming conventions

Return findings organized by severity: BLOCKING / IMPORTANT / SUGGESTION.
```

Place in `.claude/agents/code-reviewer/CODE_REVIEWER.md`.

---

## Rules — Path-Scoped Instructions

Rules in `.claude/rules/` load **only when Claude works with matching files**. This keeps context lean — backend rules don't load during frontend work and vice versa.

### Structure

```
.claude/rules/
├── backend.md      ← loads for apps/api/**, libs/core/**, libs/integrations/**
├── frontend.md     ← loads for apps/web/**
└── database.md     ← loads for **/*.orm-entity.ts, **/migrations/**
```

### Format

Rules use YAML frontmatter with `paths` to scope when they activate:

```markdown
---
paths:
  - "apps/api/**"
  - "libs/core/**"
---

# Backend Rules

- Domain layer has ZERO framework dependencies (no NestJS/TypeORM in domain/)
- Application services depend on port interfaces, never concrete repositories
- ORM entities stay in infrastructure/persistence/
- All services implement an interface (separate file)
- Unit tests mock ports, not concrete adapters
```

### Why Path-Scoped?

Without scoping, all rules load at session start and consume context permanently. With path scoping:
- Working on `apps/web/` → only frontend rules load
- Working on `libs/core/` → only backend rules load
- Working on a migration → database rules load

---

## Permissions & Settings

### Settings Files (Priority Order)

| File | Shared | Purpose |
|------|--------|---------|
| `~/.claude/settings.json` | No | Personal global preferences |
| `.claude/settings.json` | **Yes** (git) | Team-shared project settings |
| `.claude/settings.local.json` | No (gitignored) | Personal project overrides |

Higher-priority files override lower ones. Team settings go in `.claude/settings.json`, personal overrides in `.claude/settings.local.json`.

### Permission Patterns

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git checkout *)",
      "Bash(git push *)",
      "Bash(docker ps *)"
    ],
    "deny": [
      "Bash(git push * main)",
      "Bash(rm -rf *)"
    ]
  }
}
```

**Pattern syntax:**
- `Bash(pnpm *)` — any pnpm command
- `Bash(git * main)` — any git command ending with "main"
- `Read(/src/**)` — read anything under src/
- `Edit(/src/**/*.ts)` — edit TypeScript files under src/
- `mcp__github__*` — all GitHub MCP tools

### What Goes Where

| Setting | `settings.json` (shared) | `settings.local.json` (personal) |
|---------|--------------------------|----------------------------------|
| Quality gate commands | Yes | No |
| Git operations | Yes | No |
| MCP server permissions | No | Yes (tokens are personal) |
| IDE-specific paths | No | Yes |
| Hook automation | Yes (team hooks) | Yes (personal hooks) |

---

## Hooks — Automation

Hooks run shell commands in response to Claude Code events. Configure in `settings.json`.

### Common Hooks

**Auto-format on file edit:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx prettier --write \"$(echo $CLAUDE_TOOL_INPUT | jq -r '.file_path')\""
          }
        ]
      }
    ]
  }
}
```

**Desktop notification when Claude needs input:**
```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Code needs your attention\" with title \"Claude Code\"'"
          }
        ]
      }
    ]
  }
}
```

### Hook Events

| Event | Fires When | Can Block? |
|-------|-----------|------------|
| `PreToolUse` | Before a tool executes | Yes (exit 2) |
| `PostToolUse` | After a tool succeeds | No |
| `SessionStart` | Session starts/resumes | No |
| `Stop` | Claude finishes responding | No |
| `Notification` | Claude sends a notification | No |

---

## Monorepo Workflow Recipes

### Recipe 1: Full-Stack Feature (e.g., Auth API + Auth UI)

```bash
# 1. Plan the API contract first
claude -n "auth-plan"
> /plan Implement authentication flow — BE endpoints + FE login page

# 2. Start BE implementation in a worktree
claude --worktree 59-auth-api -n "auth-api"
> Implement POST /auth/login, POST /auth/refresh per the plan
> Run pnpm test && pnpm type-check

# 3. Start FE implementation in parallel (new terminal)
claude --worktree 59-auth-ui -n "auth-ui"
> Implement login page, useAuth hook, route guards
> Run pnpm test && pnpm type-check

# 4. Inspect in IDE
code .claude/worktrees/59-auth-api/
code .claude/worktrees/59-auth-ui/

# 5. Integration test (back in main repo)
git merge worktree-59-auth-api
git merge worktree-59-auth-ui
pnpm dev:stack:up && pnpm start:dev:api & pnpm start:dev:web
# Manual E2E: login → token → protected route

# 6. Push and PR
git push -u origin 59-auth-flow
# /ship or manual PR creation
```

### Recipe 2: Backend-Only Task

```bash
claude -n "issue-58-authz"
> /plan Add minimal authorization model (issue #58)
# ... implement ...
> pnpm lint && pnpm type-check && pnpm test
# /ship when ready
```

### Recipe 3: Investigation Before Implementation

```bash
claude -n "research"
# Let the Explore agent do the research (stays out of your context)
> Use an Explore agent to find all places where JwtAuthGuard is used
> Use an Explore agent to understand how the FE session provider works

# Then start implementation with clean context
/clear
> Now implement the authorization model based on what we found
```

### Recipe 4: Code Review

```bash
# Review a PR
claude
> /pr-review 42

# Review local changes
claude
> /tech-review apps/api/src/auth/
```

---

## Reference

### File Locations

```
openlinker/
├── CLAUDE.md                          # Main project instructions (git-tracked)
├── .worktreeinclude                   # Files to copy into worktrees
├── .claude/
│   ├── settings.json                  # Shared team settings (git-tracked)
│   ├── settings.local.json            # Personal settings (gitignored)
│   ├── commands/                      # Slash command skills
│   │   ├── plan.md
│   │   ├── tech-review.md
│   │   ├── pr-review.md
│   │   ├── migrate.md
│   │   ├── create-issue.md
│   │   └── ship.md
│   ├── rules/                         # Path-scoped rules
│   │   ├── backend.md
│   │   └── frontend.md
│   └── worktrees/                     # Created by --worktree (gitignored)
│       ├── feature-a/
│       └── feature-b/
├── docs/
│   ├── claude-code-workflow-guide.md  # This guide
│   ├── architecture-overview.md
│   ├── engineering-standards.md
│   └── ...
```

### Key Commands

| Command | What It Does |
|---------|-------------|
| `claude` | Start new session |
| `claude -n "name"` | Start named session |
| `claude --worktree name` | Start session in isolated worktree |
| `claude --resume` | Resume previous session |
| `/compact` | Compress context, free space |
| `/clear` | Clear session history |
| `/plan` | Generate implementation plan |
| `/tech-review` | Quick code review |
| `/pr-review` | Full PR review |
| `/migrate` | Database migration workflow |
| `/create-issue` | Create GitHub issue |
| `/ship` | End-to-end implementation flow |

### Further Reading

- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Architecture Overview](./architecture-overview.md)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md)
- [Frontend Architecture](./frontend-architecture.md)
