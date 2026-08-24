# Pre-implement gate — `implementation-plan-ci-paths-filter-quantifier.md` (#2296)

**Verdict: READY** — with one Warning that must be resolved *while* implementing Step 2, not after.

No Critical findings. No reuse collision. No contract surface in the usual sense is touched.

## Scope note — why the standard fan-out was not run

The gate's reuse audit is defined over ports, services, DI tokens, ORM entities and capabilities. This plan creates **none** of those: it adds one key to a third-party action's `with:` block in `.github/workflows/ci.yml` and rewrites an adjacent comment. Fanning `Explore` agents over `libs/core/**/domain/ports/**` for a plan that declares no port would produce five confident "confirmed absent" rows carrying no information.

The audit was instead run against the collision classes that *do* apply to a CI-config change: duplicate uses of the same idiom, other consumers of the changed output, competing skip mechanisms, and documentation that describes the behaviour being changed.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `predicate-quantifier: 'every'` on the `changes` job | **NEW (confirmed absent)** | `grep -rn "predicate-quantifier" .github/` → no hits |
| The `paths-filter` idiom itself | **ALREADY EXISTS — single instance** | `ci.yml` is the only consumer of `dorny/paths-filter`; no sibling workflow carries the same latent bug, so this fix needs no companion |
| Per-job path gating | **PARTIAL — a different, correct mechanism exists** | `scaffold-smoke.yml` uses native `on.pull_request.paths` with `!` negations. That is GitHub's own filter engine, not picomatch, and it handles negation correctly. It is **not** an alternative here: `paths:` is workflow-level, so it cannot gate individual jobs inside `ci.yml`. `paths-filter` remains the right tool. |

**Consumers of the changed output — exhaustive.** Five `if:` conditions read `needs.changes.outputs.code`, all identical: `lint` (58), `test` (117), `test-integration` (149), `build` (337), `docker-build-smoke` (362). Ungated: `type-check`, `test-php`, `changes`. The issue's assumption is **confirmed**.

**Adjacent workflows unaffected.** `e2e.yml` is `workflow_dispatch`-only (dormant). `cd.yml`, `staging.yml`, `release-please.yml` do not run on `pull_request` path filters. `scaffold-smoke.yml` filters independently.

**No live documentation describes the skip behaviour.** Every `grep` hit for "docs-only" / "Detect changed paths" outside `ci.yml` is a historical `docs/plans/implementation-plan-*.md`. Nothing in `docs/` (user- or contributor-facing) goes stale.

## Backward-compatibility findings

| Surface | Result |
|---|---|
| Top-level barrels | n/a — no TypeScript touched |
| Port signatures | n/a |
| DTO shapes | n/a |
| Symbol tokens | n/a |
| ORM schema / migration | n/a — no ORM entity, so `docs/migrations.md` does not engage |
| `check:invariants` | **Unaffected.** No script in the chain reads `.github/**`. Verified against the 22-check chain in `package.json`. |

### ⚠️ Warning — the plan restates a required-check claim that another document contradicts

Plan §2.5 concludes the existing comment is accurate and instructs the implementer **not** to change its arithmetic. That conclusion is right about the *slot counting* (5 gated, 4 self-hosted, 1 ungated self-hosted — verified). But the same comment also asserts:

> `Type Check` (**the only required check**)

and `GOVERNANCE.md:53-55` documents the intended branch protection as:

> `Require status checks to pass before merging` — **on** for `lint`, `type-check`, `test`, and integration-test workflows once those workflows can run reliably on fork PRs (tracked in #662)

So one of the two is wrong, or `GOVERNANCE.md` is aspirational and not yet applied. **The gate cannot resolve this** — branch-protection settings are not readable from the repository tree, and no PR to date has exercised the skip path (the gate has never fired), so there is no observational evidence either.

**Why it matters for this plan specifically.** Step 2 rewrites that exact comment block. Restating "the only required check" while a governance document says otherwise would launder an unverified claim into the file that the next person treats as authoritative.

**Why it is a Warning and not Critical.** The mechanism is safe in the direction that matters: a job skipped by a job-level `if:` still reports a check run with conclusion `skipped`, which GitHub counts as passing for a required status check. The dangerous shape — a required check that *never reports* and pins the PR at "Expected — waiting for status" — arises when the whole *workflow* is filtered out, which is not what this change does (`changes` always runs). So the expected outcome is safe; it is the *verification* that is missing.

**Required resolution during implementation** — either:

1. Drop the parenthetical from the rewritten comment and state only what is verifiable from the tree (which jobs are gated, which are self-hosted), leaving required-check status to `GOVERNANCE.md`; **or**
2. Confirm the actual protection setting and make `ci.yml` and `GOVERNANCE.md` agree, in this PR or a follow-up.

Option 1 is the smaller, safer move and keeps this PR's scope honest. Either way, **the plan's AC1 verification (a throwaway docs-only PR) is no longer optional** — it is the only available empirical test that a skipped gated job does not block a PR, and it costs one throwaway PR to run.

## Open questions

1. **Is `lint`/`test`/`test-integration` actually a required status check on `main` today?** Not answerable from the tree. Settles the `ci.yml` ↔ `GOVERNANCE.md` contradiction above. The docs-only test PR answers it observationally.
2. **Does #662 (fork-PR reliability) change the answer later?** If required checks are widened per `GOVERNANCE.md` after this ships, the skip path gets its first real exercise at that moment. Worth a line in the comment so the two changes are linked.

## Verdict rationale

No Critical ⇒ not `NEEDS-REVISION`. The single Warning is actionable inside Step 2 rather than requiring a plan rewrite, and the plan's own §5 already nominates the verification that resolves it. **READY.**
