# Implementation Plans Archive

This directory is an **archive**. One file per implementation plan, kept after the work merges as a searchable design record linked to its issue / PR.

## What lives here

- `implementation-plan-<feature-name>.md` — the output of `/plan` for a single change. Generated and saved by the `/plan` skill (see `docs/implementation-plan-generator-guide.md`).

## What does NOT live here

- Active work tracking — that's GitHub issues.
- Architectural decisions — those go in `docs/architecture-overview.md` and `docs/engineering-standards.md`.
- Operational runbooks — those go in `libs/integrations/<platform>/docs/` or `docs/webhooks/`.

## Reading a plan from this archive

Treat any file in this directory as a **historical snapshot of intent at plan time**. The merged code in `main` is the authoritative source of truth. If a plan says "we will do X" and the code says "we did Y", the code wins — the plan was just the proposal.

Plans are useful for answering "why did we do it this way?" — they capture the trade-offs, alternatives considered, and constraints at the time. They are not useful for answering "what does the code do now?" — read the code for that.

## Adding a plan

Run `/plan <description>` — the skill writes a new file here following the 5-phase format defined in `docs/implementation-plan-generator-guide.md`. Don't author plans here by hand.
