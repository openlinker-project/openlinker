@docs/architecture-overview.md
@docs/engineering-standards.md
@docs/frontend-architecture.md
@docs/testing-guide.md
@docs/migrations.md
@docs/code-review-guide.md
@docs/implementation-plan-generator-guide.md

You are the **OpenLinker Senior Engineer & Architect** generating an execution-ready implementation plan.

Follow the 5-phase process defined in `docs/implementation-plan-generator-guide.md` exactly. Do not skip phases. Do not ask questions mid-run — surface uncertainty explicitly in the plan under **Questions & Assumptions**.

---

## Setup — Worktree & branch (run once at the start)

A plan produces committed artifacts (the plan doc + any ADR drafts) that ship as their own PR. Always run in an isolated worktree to keep `main` clean and enable a self-contained PR at the end — same pattern as `/work` and `/refine-product`.

**Skip this section** if the session is already in a worktree for this issue (check: `git rev-parse --show-toplevel` includes `.claude/worktrees/`). Otherwise:

1. **Sync local main with origin:**
   ```bash
   git fetch origin main
   git checkout main
   git merge origin/main --ff-only
   ```
2. **Create the worktree** via the `EnterWorktree` tool. Name format: `{issue-number}-{kebab-slug}-plan` (slug from the issue's domain noun). If `EnterWorktree` isn't loaded, fetch it via `ToolSearch` with `select:EnterWorktree`.
3. **Inside the worktree, reset to latest origin/main and rename the branch:**
   ```bash
   git reset --hard origin/main
   git branch -m {issue-number}-{kebab-slug}-plan
   ```
4. **Install dependencies** (the pre-commit hook runs full lint + type-check, which need `node_modules`):
   ```bash
   pnpm install --prefer-offline
   ```
5. Confirm the worktree is ready before proceeding. The same branch carries the plan doc + ADR(s) and becomes the eventual PR.

**At the end** (after the plan + ADR drafts are written): commit on the branch with DCO sign-off (`git commit -s`), push, open a PR with `mcp__github__create_pull_request` (reference the issue, do **not** `Closes` it — the plan precedes implementation), then `ExitWorktree` (`action: remove`, `discard_changes: true` once the PR is open, since the work is preserved on the remote branch).

---

## Your Task

Generate a complete implementation plan for: **$ARGUMENTS**

---

## Execution

### Phase 1 — Discovery & Analysis

**Step 1: Understand the task**
- Restate the goal in your own words
- Identify primary and secondary objectives
- Identify explicit non-goals and constraints
- Classify: CORE / Integration / Infrastructure / Frontend / DX / Testing / Documentation

**Step 2: Research the codebase**
Search for:
- Similar implementations to follow as reference
- Existing ports, services, or adapters that can be reused
- Patterns already established for this type of work
- Related TODOs or known gaps

**Step 3: Research external systems** (if applicable)
- Authentication method and OAuth flow
- Rate limits, retry strategies
- API documentation, data models
- Webhooks vs polling patterns

### Phase 2 — Architecture & Design

**Step 4: Map to architecture**
- Identify target layer(s): CORE, Integration, Infrastructure, Interface, Shared, App
- Identify ports involved (existing or new)
- Confirm CORE vs Integration boundary decisions with justification

**Step 5: Design the solution**
- List new components required (entities, ports, adapters, services, repositories, controllers)
- Define interfaces and contracts
- Map data flow: how data enters, flows through layers, exits, events emitted

### Phase 3 — Plan Creation

**Step 6: Create step-by-step implementation plan**
Group into phases. Each step must be:
- Small and independently testable
- Tied to a specific file path
- Clear about intent, not just actions
- Include acceptance criteria

### Phase 4 — Analysis & Validation

**Step 7: Validate against architecture and codebase**
Check:
- Architecture compliance (hexagonal layers, boundaries)
- Naming conventions (engineering-standards.md)
- File structure consistency
- Missing error handling, missing tests, security concerns

**Step 8: Identify risks and edge cases**
- What could go wrong?
- Boundary conditions, error scenarios
- Backward compatibility
- Migration needs, performance implications

### Phase 5 — Improvement & Refinement

**Step 9: Refine the plan**
- Simplify complex steps
- Fill missing error handling and tests
- Remove unnecessary complexity

**Step 10: Final validation checklist**
- [ ] Follows hexagonal architecture
- [ ] Respects CORE vs Integration boundaries
- [ ] Uses existing patterns (no unnecessary abstractions)
- [ ] Idempotency considered
- [ ] Event-driven patterns used where applicable
- [ ] Rate limits & retries addressed
- [ ] Error handling comprehensive
- [ ] Testing strategy complete
- [ ] Naming conventions followed
- [ ] File structure matches standards
- [ ] Plan is execution-ready

---

## Output

Save the completed plan as a Markdown file at:
```
docs/plans/implementation-plan-{feature-name}.md
```

Use the required output format from `docs/implementation-plan-generator-guide.md`.

The plan must be self-contained: understandable without additional context.

When the architecture work surfaces a non-trivial decision (per `docs/architecture/adrs/README.md` § When to write an ADR), also draft the ADR under `docs/architecture/adrs/NNN-*.md` (next free number) with `Status: Proposed`, and add its row to the ADR index in that README.

Then commit + open the PR per the **Setup — Worktree & branch** section, and `ExitWorktree`.
