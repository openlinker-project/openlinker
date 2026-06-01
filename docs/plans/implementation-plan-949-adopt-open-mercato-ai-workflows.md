# Implementation Plan — Adopt open-mercato AI dev workflows (#949)

## TL;DR

Port four lightweight DX workflows from [`open-mercato/open-mercato`](https://github.com/open-mercato/open-mercato)'s MIT-licensed `.ai/` tooling into OpenLinker's Claude Code flow:

1. `/pre-implement` — a read-only readiness gate between `/plan` and `/work`.
2. A GitHub claim-lock protocol added to `/work` startup (parallel-session safety).
3. `scripts/smart-test.mjs` — diff-driven `pnpm --filter` test selection + integration-tier gating.
4. `docs/lessons.md` — a committed, shared project-lessons ledger, referenced from `CLAUDE.md`.

This is a **DX / tooling** change only. No runtime code in `libs/` or `apps/`, no migrations, no change to the `pnpm check:invariants` contract.

## Classification

- **Type**: DX (process / tooling)
- **Layer**: none (repo-level `.claude/`, `scripts/`, `docs/`)
- **Non-goals**: porting open-mercato's `tiers.json` / `install-skills` dual-runtime distribution; a plugin-scaffold skill; `sync-merged-pr-issues`; an architecture-guardian score; `/merge-buddy`. All explicitly deferred per #949.

## Research notes (existing patterns reused)

- **Commands** live as tracked markdown in `.claude/commands/*.md` (`plan.md`, `work.md`, …). They open with `@docs/...` includes and a role line, use `$ARGUMENTS`, and mark human pauses with ⏸️. New command mirrors this.
- **Invariant scripts** in `scripts/check-*.mjs` use a pure classifier + a `--self-check` mode exercising synthetic cases (canonical example: `check-service-interfaces.mjs`). `smart-test.mjs` reuses that exact shape so its classifier is testable without a root jest spec.
- **`check-repo-urls.mjs`** scans `docs/` and `scripts/` (skips `.claude/`) and forbids the old `SilkSoftwareHouse` org slug — new files use the canonical `openlinker-project/openlinker`.
- **Contract surfaces** the pre-implement gate checks are already named in `docs/engineering-standards.md`: top-level barrels (`@openlinker/core/<ctx>`), `*.tokens.ts` Symbol tokens, capability `*Port`s, ORM entities, plus the `check:invariants` rules (`check-cross-context-imports.mjs`, `check-service-interfaces.mjs`).

## Design & steps

### Item 1 — `/pre-implement` gate · `.claude/commands/pre-implement.md` (new)
Read-only command. Input via `$ARGUMENTS`: a plan path (`docs/plans/implementation-plan-*.md`) and/or an issue number.
- Phase A — load the plan + issue (`issue_read`).
- Phase B — **reuse audit**: fan out `Explore` agents to grep the real repo for each port / service / DI token / ORM entity / capability the plan treats as *new*, flagging anything that already exists as a reuse candidate.
- Phase C — **backward-compat checklist** over contract surfaces: barrel exports, port method signatures, DTO shapes, `*.tokens.ts` symbols, ORM schema (migration needed?), and the `check:invariants` rules the plan might trip.
- Phase D — emit a verdict **READY / NEEDS-REVISION / NEEDS-MAJOR-REVISION** with Critical/Warning findings, written to `docs/plans/analysis/ANALYSIS-{plan-name}.md`. No code or plan edits.
- **Seam note (I2)**: the command must open with a short "How this differs from `/plan` and `/tech-review`" section — `/plan` Phase 4 validates the plan *in the abstract*; `/tech-review` reviews a *diff*; `/pre-implement`'s unique job is grepping the **live repo** for collisions (does this token/port/entity already exist?) and contract-surface breaks *before* code exists. Without this, it bitrots as a duplicate of `/plan`'s checklist.
- Create `docs/plans/analysis/.gitkeep` (S2) so the output directory exists and is tracked.
- **AC**: command exists, is read-only, carries the seam note, names the contract-surface checklist, writes to `docs/plans/analysis/`.

### Item 2 — claim-lock · `.claude/commands/work.md` (edit)
Insert a **"Phase 1.5 — Claim & verify"** between issue selection and worktree setup:
- Verify the issue is still **open and unfixed**: `issue_read` state + search merged PRs (`list_pull_requests` / `search_pull_requests`) + `git log origin/main --grep "#N"`.
- **Lock identity (B2)**: parallel OpenLinker sessions all run as the **same** GitHub account, so the GitHub *actor* cannot distinguish two sessions. The claim therefore keys on the **session's branch/worktree name**, not the assignee. The claim comment is `🤖 claimed for work by branch \`{issue}-{slug}\` at {ISO-ts}`; the gate reads existing `🤖 claimed for work by branch …` comments and only blocks when the holder branch **differs** from this session's branch. A claim from this session's own branch is a no-op re-entry, not a collision.
- **Existing-claim handling**: if an `in-progress` label is present AND a live foreign-branch claim comment exists within the freshness window → stop unless the user overrides. Outside the window → treat as stale and reclaim.
- **Freshness window (I3)**: `/work` sessions routinely exceed an hour, so a 60-min steal window is too short. Use a **2-hour** window, and re-touch the claim (new timestamped comment) at the start of Phase 4 (Implement) so long but active sessions aren't stolen.
- **Label precondition (I3)**: before relying on the `in-progress` label, confirm it exists in the repo (`get_label`); if absent, the command instructs the operator to create it once (or falls back to comment-only locking) rather than assuming `issue_write` auto-creates it.
- Post the claim via GitHub MCP: `issue_write` (add `in-progress` label, if present) + `add_issue_comment` (branch-scoped `🤖` marker).
- Add a release note to Phase 5: on ship/abandon, remove `in-progress` (never close the issue — existing rule).
- Drive-by: fix the stale `SilkSoftwareHouse` org slug already in `work.md` line 12 → `openlinker-project/openlinker`.
- **AC**: `/work` startup verifies open/unfixed, claims via a **branch-scoped** marker (no false collision for same-user sessions), recovers stale locks on a 2-hour window, re-touches on Phase 4, releases on finish.

### Item 3 — `scripts/smart-test.mjs` (new) + `package.json` (edit)
Pure classifier `classify(changedFiles) → { scope, packages, runIntegration, reason }`:
- **Granularity (B1)**: pnpm's finest test unit is the **workspace package**, not the bounded context — `libs/core` is a *single* package (`@openlinker/core`) with subpath exports, so a change under `libs/core/src/orders/` can only select the whole `@openlinker/core` Jest project via `pnpm --filter`. The classifier therefore maps changed paths → **workspace package names** (`@openlinker/core`, `@openlinker/api`, `@openlinker/worker`, each `libs/integrations/*` package, `@openlinker/web`). Intra-package narrowing (run only the specs touching the changed files) is delegated to **`jest --findRelatedTests <files>`** within the selected package — *not* `pnpm --filter`, which can't reach below package level.
- **WIDE** (run everything) when any changed path is under `libs/shared/`, a core top-level barrel (`libs/core/src/<ctx>/index.ts` / `*.tokens.ts`), or root config (`package.json`, `tsconfig*.json`, `pnpm-workspace.yaml`, jest config).
- **Layer gating**: pure `apps/web/**` → skip backend packages + skip integration tier; backend-only → skip `@openlinker/web`; integration (`pnpm test:integration`) runs only when backend/core/integration code or `*.int-spec.ts` changed.
- Driver: resolve base ref (`SMART_TEST_BASE_REF` env or `origin/main`), `git diff --name-only <base>...HEAD` + uncommitted + untracked, classify, print the plan; exec the `pnpm --filter <pkg> exec jest --findRelatedTests …` (and `pnpm test:integration` when gated in) unless `--dry-run`.
- **No cache (S1)**: drop the commit-pinned `.smart-test-cache.json` for v1 — the classifier + `--dry-run` is the valuable core; cache invalidation is a foot-gun deferred until there's evidence it's needed.
- `--self-check`: exercise the pure classifier on synthetic diffs incl. the AC cases (backend-only skips `@openlinker/web`; `libs/shared` → WIDE; pure `apps/web` skips the integration tier), mirroring `check-service-interfaces.mjs --self-check`.
- Wire `"smart-test": "node scripts/smart-test.mjs"` in `package.json`. **Not** added to `check:invariants` (respects the AC) and CI keeps running the full suite.
- **Wired into the pre-commit hook (revised — replaces I1's "follow-up")**: smart-test replaces the hand-rolled test-scoping block in `.husky/pre-commit`, unit-only via a new `--no-integration` flag. The old hook ran the **full** suite on any `libs/` touch, so a `libs/core` backend change dragged in the flaky `apps/web` suite; now it runs only `@openlinker/core`'s related specs (`jest --findRelatedTests`). It is **not** added to `check:invariants`; `/work` Phase 4 and CI still run the full suite — the hook is the fast local path, the full suite the safety net. The real exec path was validated end-to-end before wiring.
- **AC**: maps a backend-only diff to `@openlinker/*` backend packages + skips `@openlinker/web`; treats `libs/shared` as WIDE; uses `jest --findRelatedTests` for intra-package selection; `--no-integration` skips the Testcontainers tier; wired into `.husky/pre-commit`; `--self-check` passes.

### Item 4 — `docs/lessons.md` (new) + `CLAUDE.md` (edit)
- Create `docs/lessons.md`: preamble + topical `## <imperative rule>` entries, each with `**Context** / **Problem** / **Rule** / **Applies to**` (open-mercato `.ai/lessons.md` shape).
- **Seam definition (I4)**: the preamble must state that `docs/lessons.md` holds **empirical regression gotchas** discovered during work — *not* architectural rules (those stay canonical in `docs/engineering-standards.md`, `docs/architecture-overview.md`, `.claude/rules/*`). When a lesson hardens into a rule, it graduates to the canonical doc and the lesson links to it. This prevents the five-rule-homes drift.
- **Seed-verification step (I4)**: each candidate lesson is sourced from accumulated memory that reflects *state when written*; before writing each entry, **verify it against the current repo** (the named file/flag/command still exists) and cite the PR/ADR. Drop or correct any that no longer hold.
- Seed with durable, **verified, project-level** lessons (not personal workflow prefs): PrestaShop WS carrier→`validateOrder` (ADR-016 / #916); rebuild `libs` dist after pulling main before type-check; FE zod `.nullish()` over snapshot nulls (#941); worker int-specs escape the quality gate; Allegro label vs protocol endpoint; Allegro `boughtAt` placed-time. Personal-workflow items (e.g. the single-int-spec invocation form) stay in agent memory unless they prove to be team-wide.
- Reference `docs/lessons.md` from `CLAUDE.md` (Reference Documentation table + a "read at session start" note).
- **AC**: file exists in the prescribed format with the seam definition, seeded with verified lessons, referenced from `CLAUDE.md`.

## Risks & validation

- **Quality gate**: changes are non-TS-source; `pnpm lint` / `type-check` / `test` should be unaffected. Risk is `check-repo-urls` (mitigated: canonical slug in `docs/` + `scripts/`) — run the full gate before commit.
- **smart-test correctness**: under-testing a boundary-crossing change. Mitigation: `libs/shared` + core-barrel + root-config ⇒ WIDE; CI still runs everything; `--self-check` locks the classifier; it's opt-in (I1) so a misclassification can't silently weaken the default gate.
- **Testability reality (S3)**: 3 of 4 deliverables are markdown (commands, docs) with no automated test by nature; only `smart-test.mjs` carries logic and is covered by `--self-check`. The Phase 5 self-review should treat "tests added" as satisfied by the self-check + N/A for the prose artifacts, not a gap.
- **No migration**, no ORM entity, no barrel change ⇒ no `migration:show` step.

## Final checklist

- [ ] Four deliverables implemented as scoped above
- [ ] Item 1 carries the seam note vs `/plan` + `/tech-review`; `docs/plans/analysis/.gitkeep` added
- [ ] Item 2 lock keys on branch identity (no same-user false collision), 2-hour window + Phase-4 re-touch, label-existence precondition
- [ ] Item 3 maps to workspace packages + `jest --findRelatedTests`, no cache, `--no-integration` flag, wired into `.husky/pre-commit` (not `check:invariants`); exec path validated
- [ ] Item 4 has the seam definition; every seeded lesson verified against the current repo
- [ ] `pnpm smart-test --self-check` passes
- [ ] `pnpm lint && pnpm type-check && pnpm test` green
- [ ] No change to `check:invariants` chain; CI full suite intact
- [ ] `CLAUDE.md` references the new command + lessons ledger
