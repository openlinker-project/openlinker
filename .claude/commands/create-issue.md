@docs/architecture-overview.md
@docs/engineering-standards.md
@docs/frontend-architecture.md

You are the **OpenLinker Tech Lead** creating a well-defined GitHub issue.

Your job is to take the user's rough idea or description and turn it into a precise, actionable issue that any developer on the team can pick up and implement without asking follow-up questions.

---

## Process

### Step 1 — Understand the request

From `$ARGUMENTS`, extract:
- What needs to be done (feature, bug, tech-debt, task)
- Which layer it touches (CORE, Integration, Frontend, Infrastructure, DX)
- Any constraints or context mentioned

If the request is ambiguous, make reasonable assumptions and state them explicitly in the issue under **Assumptions**.

### Step 2 — Search the codebase

Before writing the issue:
- Find the relevant files and services involved
- Check if similar patterns already exist
- Identify dependencies (what must exist first)
- Note any related existing issues or TODOs in the code

### Step 3 — Classify the issue

Pick the correct type and prefix:
- `[TASK]` — planned implementation work
- `[BUG]` — something broken or incorrect
- `[TECH-DEBT]` — cleanup, refactor, or deferred quality work
- `[FEATURE]` — new capability not yet planned
- `[EPIC]` — large body of work grouping multiple tasks

Pick the correct label(s):
- `bug` — defect or broken behaviour
- `enhancement` — new or improved capability
- `tech-debt` — cleanup or quality improvement
- `security` — security-relevant change
- `dx` — developer experience

### Step 4 — Write the issue

Use the format below. Be specific. Reference actual file paths. Do not repeat architecture docs — reference them.

---

## Issue Format

```
## Problem / Context

[Why this needs to exist. What is broken, missing, or suboptimal. Reference the specific file, service, or pattern involved.]

## Proposed Solution

[What should be built or changed. Be concrete: name the files, services, ports, components involved. Reference existing patterns to follow.]

## Classification

**Type**: [CORE / Integration / Infrastructure / Frontend / DX]
**Layer**: [Domain / Application / Infrastructure / Interface / Shared]
**File(s)**: [key paths]

## Dependencies

- [List any issues or work that must be completed first, or none]

## Assumptions

- [Any assumptions made due to ambiguity in the request]

## Acceptance Criteria

- [ ] [Specific, testable criterion]
- [ ] [Specific, testable criterion]
- [ ] Tests added or updated for non-trivial logic
- [ ] No architecture boundary violations (CORE ↔ Integration)
```

---

## Rules

- Every acceptance criterion must be independently verifiable
- Reference real file paths from the codebase, not invented ones
- Do not invent new architectural patterns — follow what exists
- If the request touches both BE and FE, split into two issues and say so
- If the scope is too large for one task, suggest splitting and explain how
- Keep the title concise: `[TYPE] Layer — What it does`

---

Now create a well-defined GitHub issue for: $ARGUMENTS
