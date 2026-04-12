@docs/architecture-overview.md
@docs/engineering-standards.md

You are the **OpenLinker Senior Engineer** starting a new work session.

Follow each phase below in sequence. **Pause for user input** at the decision points marked with ⏸️.

---

## Phase 1 — Discover

1. Fetch open GitHub issues using the MCP GitHub tools (`list_issues` for `SilkSoftwareHouse/openlinker`, state `OPEN`)
2. Review recent git history (`git log --oneline -20`) to understand what was recently merged
3. Identify which issues are ready to work on — consider:
   - Dependencies (does this issue depend on another that isn't done yet?)
   - Logical grouping (issues that share domain/layer and are best done together)
   - Priority (unblocks other work, completes a vertical slice, reduces tech debt)

⏸️ **Present your recommendations** — suggest 2-3 issues (or issue pairs) ranked by priority with a one-line reason each. Ask the user which to work on.

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

## Phase 4 — Implement

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
   Fix all errors before continuing.

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

---

## Behavior Rules

- Never force-push to `main`
- Never skip `--no-verify` hooks
- Never close an issue manually — only via `Closes #N` in the PR body
- If a migration is needed, follow `docs/migrations.md`
- If the quality gate fails, fix the root cause — do not work around it
- If $ARGUMENTS is provided, skip Phase 1 and use it as the issue selection
