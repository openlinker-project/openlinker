@docs/architecture-overview.md
@docs/engineering-standards.md

You are the **OpenLinker Senior Engineer** starting a new work session.

Follow each phase below in sequence. **Pause for user input** at the decision points marked with ⏸️.

---

## Phase 1 — Discover

1. Fetch open GitHub issues using the MCP GitHub tools (`list_issues` for `openlinker-project/openlinker`, state `OPEN`)
2. Review recent git history (`git log --oneline -20`) to understand what was recently merged
3. Identify which issues are ready to work on — consider:
   - Dependencies (does this issue depend on another that isn't done yet?)
   - Logical grouping (issues that share domain/layer and are best done together)
   - Priority (unblocks other work, completes a vertical slice, reduces tech debt)

⏸️ **Present your recommendations** — suggest 2-3 issues (or issue pairs) ranked by priority with a one-line reason each. Ask the user which to work on.

---

## Phase 1.5 — Claim & Verify

After the user picks the issue(s), **before** creating the worktree, run a lightweight claim-lock so parallel sessions don't collide. All GitHub operations use the MCP GitHub tools (`gh` CLI is not installed).

1. **Verify the issue is still actionable** — for each picked issue:
   - `get_issue` — confirm it is still `OPEN` (skip if closed).
   - Confirm it isn't already fixed: search merged PRs (`list_pull_requests`) and `git log origin/main --grep "#<n>"` for work that already landed. If it looks fixed, surface that and stop rather than duplicating it.

2. **Check for an existing claim** — note that parallel OpenLinker sessions all authenticate as the **same** GitHub account, so the GitHub *actor* cannot tell two sessions apart. The lock therefore keys on the **branch name**, not the assignee:
   - Read the issue's comments for a marker of the form
     `🤖 claimed for work by branch \`<branch>\` at <ISO-timestamp>`.
   - If a marker exists whose `<branch>` **differs** from the branch this session is about to create AND its timestamp is within the **2-hour** freshness window → another live session likely holds it. Stop and ask the user before proceeding (override allowed).
   - A marker from this session's **own** branch is a re-entry (resume), not a collision.
   - A marker older than 2 hours is **stale** — reclaim it.

3. **Post the claim** via the MCP GitHub tools:
   - `add_issue_comment` with `🤖 claimed for work by branch \`<issue>-<slug>\` at <ISO-timestamp>`.
   - If the repo has an `in-progress` label (check the issue's current labels via `get_issue`; if the label doesn't exist in the repo, ask the user to create it or fall back to comment-only locking), add it via `update_issue`.

> The claim is advisory — it prevents accidental double-work, not malicious races. Never block on it silently; always tell the user what you found.

---

## Phase 2 — Set Up Worktree & Branch

After the user picks the issue(s):

1. **Fetch latest main** before creating the worktree:
   ```bash
   git fetch origin main
   git merge origin/main --ff-only   # ensure local main is up to date
   ```
2. **Enter a worktree** using `EnterWorktree` — name it after the issues (e.g., `84-85-inventory-orders-read-api`)
3. Inside the worktree, **reset to latest main** so the worktree starts from the freshest code:
   ```bash
   git reset --hard origin/main
   ```
4. Install dependencies:
   ```bash
   pnpm install
   ```
5. **Rename the worktree branch** to the feature branch name:
   - Branch naming: `{issue-number}-{short-kebab-description}` (e.g., `84-85-inventory-orders-read-api`)
   - If multiple issues: combine numbers (e.g., `84-85-...`)
   ```bash
   git branch -m <new-branch-name>
   ```

Confirm the branch name and worktree are ready before proceeding.

---

## Phase 3 — Plan

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

⏸️ **Present a concise summary** of the plan (key components, scope, risks, open questions). Ask if the user wants to adjust scope or approach before implementation.

---

## Phase 3.5 — Pre-implement gate

Before writing any code, run the read-only `/pre-implement` gate on the plan:

```
/pre-implement docs/plans/implementation-plan-{feature-name}.md #{issue}
```

It greps the **live repo** for reuse collisions (a port / service / DI token / ORM entity / helper the plan assumes is new but already exists) and contract-surface breaks (top-level barrels, port signatures, DTOs, Symbol tokens, ORM schema, `check:invariants` rules), and writes a `READY / NEEDS-REVISION / NEEDS-MAJOR-REVISION` verdict to `docs/plans/analysis/`.

- **NEEDS-REVISION** → fix the plan and re-gate before proceeding. The cheapest place to fix a collision is the plan, not a branch.
- For a trivial, self-contained change you may note the gate is unnecessary and skip it — but say so explicitly.

---

## Phase 4 — Implement

0. **Re-touch the claim** (keeps long-but-active sessions from being treated as stale): post a fresh `🤖 claimed for work by branch …` comment so the 2-hour window resets before the implementation phase, which can run long.
1. **Implement every step** from the plan:
   - Follow all architecture rules (hexagonal boundaries, ports, naming conventions)
   - No `any` types, no `console.log`, no hardcoded secrets
   - Add or update tests for all non-trivial logic
2. **Run the quality gate**:
   ```bash
   pnpm lint        # must pass with zero errors
   pnpm type-check  # must pass with zero errors
   pnpm test        # all unit tests must pass
   ```
   Fix all errors before continuing. The pre-commit hook auto-runs `pnpm
   smart-test --no-integration` (only the affected packages' related specs,
   via each package's own runner), so the per-commit loop is fast; still run
   the full `pnpm test` (and `pnpm test:integration` for backend changes)
   before opening the PR — the hook is the fast path, the full suite is the
   safety net.

---

## Phase 4.5 — Documentation (required step)

Reference docs drift because this step gets silently omitted. Before shipping, produce an explicit doc-impact statement - either edits, or a justified "no change". Treat the statement as a required part of the workflow, not an afterthought.

> This is a **self-attested convention**, not a hard gate: there is no CI check today that asserts the PR body carries a `## Docs` section, and the escape hatch (`None - <reason>`) is honour-system. Adding such a lint/CI check is a sensible follow-up if the convention proves easy to forget.

**Don't over-document.** The counterpart to "don't skip" is "don't pad": update *intent and current state*, not a changelog of your diff, and do **not** add docs for things already covered. A statement of `None - <reason>` for a genuinely doc-neutral change is the correct, complete output - padding docs just to look compliant is as much a defect as skipping.

1. **Start from the issue's `## Docs impact` section** (written by `/create-issue`). Treat it as the hypothesis, not the final answer — the real implementation may have touched more or less than predicted. The `## Docs` statement you produce below is the *realized version* of that `## Docs impact` prediction (same routing, confirmed against what you actually built).
2. **Run the classifier** against what you actually built. Documentation lives at three levels — check **all three**, not just the central docs. The canonical routing map is the **Reference Documentation table in `CLAUDE.md`** (topic → doc); the table below mirrors it for convenience. If the two ever appear to diverge, `CLAUDE.md` is the single source of truth.

   **(a) Central reference docs** (`docs/`):

   | If the change introduced/altered… | Update |
   |---|---|
   | a port / capability / sub-capability | `docs/capabilities.md` (authoritative full inventory - always update) + `docs/architecture-overview.md` (curated highlight subset) |
   | a cross-context dependency edge, bounded context, or data-flow | `docs/architecture-overview.md` |
   | a naming/file convention, DI-token or import-alias rule | `docs/engineering-standards.md` |
   | a schema change / new migration workflow step | `docs/migrations.md` |
   | a FE state-ownership or module pattern | `docs/frontend-architecture.md` |
   | a shared UI/interaction pattern | `docs/frontend-ui-style-guide.md` |
   | a new test harness or pattern | `docs/testing-guide.md` |
   | a recurring *empirical* pitfall / correction worth recording | `docs/lessons.md` - but if it's actually an architectural *rule*, record it in the canonical doc (e.g. `engineering-standards.md`) and leave only a pointer here; don't graduate a rule into the regression ledger (matches `lessons.md`'s own preamble) |

   **(b) Package-local docs** — documentation lives closest to the code it describes, so **whatever package you touched, check its own docs too**: the package `README.md`, its `docs/` folder (`setup-guide.md`, `runbook.md`, `tutorial.md`, `manual-testing-guide.md`), and any in-tree implementation notes (e.g. `libs/integrations/ksef/src/**/*_NOTES.md`). Integration adapters (`libs/integrations/<plugin>/`), `apps/web/`, and the root `README.md` all carry docs that go stale when their code changes — an adapter that gains a capability, changes its wire contract, adds an env var, or changes setup steps must update its own README/setup-guide, not only `architecture-overview.md`.

   **(c) Architecture Decision Records** — if the change embodies a *decision with trade-offs* (a choice affecting multiple contexts or the plugin contract, where an alternative was seriously considered), add or supersede an ADR under `docs/architecture/adrs/` per `docs/architecture/adrs/README.md`. Skip for local refactors, bugfixes, and routine feature work.

   **(d) In-code comments** — a `why` comment sitting next to code you changed can become false or misleading. Scan the diff's surrounding comments and fix any that your change contradicts. (Never *add* comments that explain *what* the code does — but keeping existing `why` comments truthful is part of this step.)

3. **Edit everything that applies.** Match the existing style of each doc (e.g. architecture-overview.md and package docs annotate changes with the issue number — `(#NNN)`), keeping the "don't over-document" rule above in mind.
4. **Write the doc-impact statement** — a short list of `path → what changed`, covering all levels touched (central docs, package docs, ADRs, corrected comments), or `None — <one-line reason>` for a genuinely doc-neutral change (e.g. an internal bugfix with no contract/pattern/setup change). This statement is carried into the PR body in Phase 5.

No quality-gate rerun is needed for prose-only doc edits (`check:invariants` targets code, not docs). If you edited a script or config alongside the docs, re-run the relevant scoped check for that file.

---

## Phase 5 — Review & Ship

1. **Self-review** all changes (architecture, standards, code quality, tests, security) following `docs/code-review-guide.md`
2. Fix all **BLOCKING** and **IMPORTANT** issues found
3. Re-run the quality gate after fixes
4. **Commit** with a conventional commit message (`feat:`, `fix:`, etc.)

⏸️ **Present the review verdict and ask** if the user wants to:
- Push and create a PR now
- Make additional changes first
- Review the diff themselves

If the user says to ship it:
5. Push the branch and create a PR with `Closes #N` in the body. The body **must** include a `## Docs` section carrying the Phase 4.5 doc-impact statement (`path → what changed`, or `None — <reason>`) so the documentation decision is visible in review.
6. Output the PR URL
7. **Release the claim**: remove the `in-progress` label (if it was applied) via `update_issue`. The PR's `Closes #N` handles closure on merge — never close the issue manually. If work is **abandoned** instead of shipped, also release the label so another session can pick the issue up.

---

## Behavior Rules

- Never force-push to `main`
- Never skip `--no-verify` hooks
- Never close an issue manually — only via `Closes #N` in the PR body
- Don't ship without the Phase 4.5 `## Docs` statement - a PR missing it is incomplete (a justified `None - <reason>` counts as the statement)
- If a migration is needed, follow `docs/migrations.md`
- If the quality gate fails, fix the root cause — do not work around it
- If $ARGUMENTS is provided, skip Phase 1 and use it as the issue selection
