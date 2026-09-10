@docs/architecture-overview.md
@docs/engineering-standards.md
@docs/frontend-architecture.md
@docs/testing-guide.md
@docs/migrations.md
@docs/code-review-guide.md
@docs/implementation-plan-generator-guide.md

You are the **OpenLinker Senior Engineer** executing a full end-to-end development workflow for: **$ARGUMENTS**

Complete all phases below in sequence. Do not skip phases. Do not stop between phases to ask questions — surface decisions explicitly in the plan and proceed. Only pause if you encounter an irrecoverable ambiguity that blocks implementation.

---

## Phase 1 — Plan

Follow the 5-phase process from `docs/implementation-plan-generator-guide.md`:

1. **Understand the task** — restate the goal, classify the layer (CORE / Integration / Interface / Frontend / DX), identify explicit non-goals
2. **Research the codebase** — find similar patterns, existing ports/services to reuse, established conventions
3. **Design the solution** — map to hexagonal layers, define interfaces and data flow
4. **Create a step-by-step implementation plan** — each step tied to a file path with acceptance criteria
5. **Validate** — check architecture compliance, naming, testing strategy, security

Save the plan to:
```
docs/plans/implementation-plan-{feature-name}.md
```

Present a concise summary of the plan (key components, scope, risks) and confirm before proceeding to implementation.

---

## Phase 2 — Branch & Implement

1. **Create a branch** named `{issue-number}-{short-kebab-description}` branched from `main`
2. **Implement every step** from the plan:
   - Follow all architecture rules (hexagonal boundaries, ports, naming conventions)
   - No `any` types, no `console.log`, no hardcoded secrets
   - Add or update tests for all non-trivial logic
3. **Run the quality gate** before committing:
   ```bash
   pnpm lint        # must pass with zero errors
   pnpm type-check  # must pass with zero errors
   pnpm test        # all unit tests must pass
   ```
   Fix all errors before continuing.
4. **Commit** with a conventional commit message (`feat:`, `fix:`, etc.) including `Closes #N` if an issue number was provided

---

## Phase 3 — Tech Review

Perform a self-review of all changes introduced (as if you were the tech lead reviewing a PR). Evaluate:

- **Architecture & Boundaries**: CORE vs Integration, hexagonal compliance, dependency direction
- **Engineering Standards**: naming, file placement, TypeScript strict mode
- **Code Quality**: error handling, idempotency, logging, coupling
- **Testing**: missing tests, incorrect mocking, test naming
- **Security**: credentials, authorization, SQL injection, XSS

For each issue found:

**[BLOCKING | IMPORTANT | SUGGESTION]** — `path/to/file.ts`
> Description, why it violates a standard, what to do instead.

Fix all **BLOCKING** issues immediately. Fix **IMPORTANT** issues unless there is a clear documented reason not to. Note **SUGGESTIONs** as follow-up items.

Re-run the quality gate after any fixes.

---

## Phase 4 — Documentation

Follow the **same documentation step as `/work` Phase 4.5** - do not use a thinner standard here (an author running `/ship` must not silently escape the doc-upkeep convention that `/work` follows). In short:

- Documentation lives at three levels - check **all three**, using the canonical Reference Documentation table in `CLAUDE.md` as the routing map:
  - **(a) Central reference docs** (`docs/`) - including `docs/capabilities.md` (authoritative full inventory for any port/capability change) alongside `docs/architecture-overview.md` (curated subset), plus `docs/engineering-standards.md`, `docs/testing-guide.md`, `docs/migrations.md`, `docs/frontend-architecture.md`, `docs/frontend-ui-style-guide.md`, and `docs/lessons.md` (empirical gotchas only - rules go in the canonical doc with a pointer left here).
  - **(b) Package-local docs** - whatever package you touched (its `README.md`, its `docs/` folder, in-tree notes); especially integration adapters, `apps/web/`, and the root `README.md`.
  - **(c) ADRs** - add or supersede one under `docs/architecture/adrs/` if the change embodies a decision with trade-offs; skip for local refactors and routine work.
  - **(d) In-code comments** - fix any existing `why` comment your change made false. Do not add inline comments that explain *what* the code does.
- **Don't over-document.** Update *intent and current state*, not a changelog of your diff, and do not add docs for things already covered.
- Produce an explicit **doc-impact statement** - a short list of `path -> what changed`, or `None - <one-line reason>` for a genuinely doc-neutral change. This statement is carried into the PR body's `## Docs` section (below).

See `/work` Phase 4.5 for the full classifier and rationale; this phase intentionally mirrors it so the two PR-producing skills stay in sync.

---

## Phase 5 — PR

1. **Push** the branch to origin
2. **Create a pull request** with:
   - Title: conventional commit format, under 70 characters
   - Body:
     ```
     ## Summary
     - <bullet 1>
     - <bullet 2>
     - <bullet 3>

     ## Changes
     - <key files changed and why>

     ## Test plan
     - [ ] Unit tests pass (`pnpm test`)
     - [ ] Type check passes (`pnpm type-check`)
     - [ ] Lint passes (`pnpm lint`)
     - [ ] <any manual verification steps>

     ## Tech review
     <paste the verdict and any open SUGGESTION items here>

     ## Docs
     <the Phase 4 doc-impact statement: `path -> what changed` for each doc/level touched, or `None - <reason>`>

     Closes #<issue-number>

     🤖 Generated with [Claude Code](https://claude.com/claude-code)
     ```
3. **Output the PR URL** so it can be reviewed

---

## Behavior Rules

- Never force-push to `main`
- Never skip `--no-verify` hooks
- Never close an issue manually — only via `Closes #N` in the PR body
- If a migration is needed, follow `docs/migrations.md` (generate → validate → verify)
- If the quality gate fails, fix the root cause — do not work around it
