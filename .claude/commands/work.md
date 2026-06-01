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
   - `issue_read` — confirm it is still `OPEN` (skip if closed).
   - Confirm it isn't already fixed: search merged PRs (`list_pull_requests` / `search_pull_requests`) and `git log origin/main --grep "#<n>"` for work that already landed. If it looks fixed, surface that and stop rather than duplicating it.

2. **Check for an existing claim** — note that parallel OpenLinker sessions all authenticate as the **same** GitHub account, so the GitHub *actor* cannot tell two sessions apart. The lock therefore keys on the **branch name**, not the assignee:
   - Read the issue's comments for a marker of the form
     `🤖 claimed for work by branch \`<branch>\` at <ISO-timestamp>`.
   - If a marker exists whose `<branch>` **differs** from the branch this session is about to create AND its timestamp is within the **2-hour** freshness window → another live session likely holds it. Stop and ask the user before proceeding (override allowed).
   - A marker from this session's **own** branch is a re-entry (resume), not a collision.
   - A marker older than 2 hours is **stale** — reclaim it.

3. **Post the claim** via the MCP GitHub tools:
   - `add_issue_comment` with `🤖 claimed for work by branch \`<issue>-<slug>\` at <ISO-timestamp>`.
   - If the repo has an `in-progress` label (verify once with `get_label`; if it doesn't exist, ask the user to create it or fall back to comment-only locking), add it via `issue_write`.

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
5. Push the branch and create a PR with `Closes #N` in the body
6. Output the PR URL
7. **Release the claim**: remove the `in-progress` label (if it was applied) via `issue_write`. The PR's `Closes #N` handles closure on merge — never close the issue manually. If work is **abandoned** instead of shipped, also release the label so another session can pick the issue up.

---

## Behavior Rules

- Never force-push to `main`
- Never skip `--no-verify` hooks
- Never close an issue manually — only via `Closes #N` in the PR body
- If a migration is needed, follow `docs/migrations.md`
- If the quality gate fails, fix the root cause — do not work around it
- If $ARGUMENTS is provided, skip Phase 1 and use it as the issue selection
