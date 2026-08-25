# OMS Programme Execution Ledger — Waves 0 → 2

**Branch**: `oms-programme-waves-0-2` (worktree `.claude/worktrees/oms-wave2-programme`).
**This file is the resume point.** A session continuing the programme reads this first, then the
wave epics (#2312 #2326 #2337 #2389) for per-issue detail. Update it after every issue completes
and commit it with the work.

## Owner decisions (2026-08-22, binding)

1. **Integration model (amended 2026-08-23 — stacked waves)**: per-issue work happens on short
   issue branches off the current wave branch; the orchestrator merges them back after review. At
   each wave boundary run `/pr-review` over the wave's accumulated diff, apply all findings, open
   the wave PR to `main` (owner merges) — and IMMEDIATELY branch the next wave's long-lived branch
   off the reviewed wave tip (`oms-programme-waves-0-2` carries Wave 0; then `oms-programme-wave-1`
   off it; then `oms-programme-wave-2` off Wave 1) and continue the loop there without waiting for
   the PR merge. When an earlier wave's PR merges to main, merge `origin/main` forward into the
   active wave branch.
2. **Spec §8 Q1 = YES** — automation v1 is in scope (W2-21…W2-29 stay).
3. **Severity rule (spec §4.3 ambiguity)**: decision-table row carries the fact's severity (red
   where nothing decides); the attention card is **always amber** (it is a to-do list). Fold into
   the spec when Wave-2 FE copy is first touched.
4. **#2289 spike method**: desk research against developer.allegro.pl (no sandbox credentials).
5. **Wave-2 FE pre-work**: #2435 (FormField single-child), #2436 (index.css token defects),
   #2299 (Dialog barrel) are scheduled before the Wave-2 FE children that hit them.

## Per-issue process (non-negotiable)

read spec/design refs → `/pre-implement` → plan (Opus) → `/tech-review` plan, apply ALL findings →
implement (Opus, on an issue branch off this branch) → quality gate (`pnpm lint && pnpm type-check
&& pnpm test`; `test:integration` when the slice warrants; `migration:show` on schema changes) →
`/tech-review` the diff, apply ALL findings → iterate until clean → orchestrator merges the issue
branch here → tick this ledger + the epic checklist. Fable orchestrates/reviews only; Opus produces
every line. Commits: `git commit -s`, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
Migration-bearing issues use synthetic-sequential timestamps (docs/migrations.md rule 3).

## Status

Legend: ☐ not started · ◐ plan in review · ◑ implementing · ◕ diff in review · ☑ merged to branch · ⛔ blocked

### Wave 0 (no epic)
| Issue | Subject | Status |
|---|---|---|
| #2282 | persistOrder source-attribution immutability | ☑ merged b91088599 (commit a5f59a370; reviewed, approved) |
| #2283 | ingestion line-diff + `amended` fact | ☑ merged 45aa9351c (reviewed, approved; migration 1841000000000) |
| #2284 | `WHERE cancelledAt IS NULL` provisioning predicate | ☑ merged 4587122c9 (commit 99ab27462; reviewed, approved) |
| #2285 | `inv:{hash}` idempotency-key swap | ☑ merged 641e07bad (commit 97dfdf1d0; reviewed, approved) |
| #2286 | `never`-default exhaustiveness (5 consumers) | ☑ merged 9b48585b4 (commit 885b63f9e; reviewed, approved) |
| #2287 | `packedAt` BE | ☑ merged b6b06df76 (commit 943e0fa91; reviewed, approved) |
| #2288 | `packedAt` FE | ☑ committed 8a2567199 directly on the wave branch (reviewed, approved; agent lost worktree isolation across sleep-resumes — work verified additive + green) |

**WAVE 0 COMPLETE (8/8).** Boundary: /pr-review sweep → findings applied → PR to main → `oms-programme-wave-1` branched off the reviewed tip (owner decision 1, amended).
| #2289 | Allegro returns-feed spike → 1c fork | ☑ verdict 4A (two-pass); findings on branch + issue comment |

### Wave 1a (epic #2312) — entry criteria ✓ (Wave 0 complete; #2298 merged 1373784cd with ADOPTED ADR-054 storage amendment: routing rules are ROWS in plugin `oms_routing_rules`)

Branch: `oms-programme-wave-1` (stacked off Wave-0 tip feb78054d; Wave-0 PR to main = #2438, awaiting owner merge).

| Issue | Slug | Subject | Status |
|---|---|---|---|
| #2304 | W1a-1 | fulfillment-authority vocabulary leaf | ☑ merged d80e91769 (KNOB_THRESHOLD conflict resolved 5→7, both knobs registered) |
| #2305 | W1a-2 | order-lifecycle vocabulary leaf | ☑ merged 3bc094e71 |
| #2307 | W1a-3 | deriveOrderLifecyclePhase (pure) | ☑ merged 40f1e6bba |
| #2309 | W1a-4 | SQL CASE twin + phase surfacing | ☑ merged f0f1d04a0 (commit 442fc350f; reviewed, approved) |
| #2310 | W1a-5 | lifecycle-phase badge/filter/summary on orders surfaces | ☑ merged 2e4d9bda9 (commit 90640ce14; reviewed, approved) |
| #2311 | W1a-6 | authority-kind + lifecycle-phase mirror checks | ☑ merged a51efe54d (commit 4640575ee; 7/7 drift proofs) |
| #2306 | W1a-7 | dispatch-risk surface + cancelled-overdue fix | ☑ merged cfe78a9de |
| #2308 | W1a-8 | walker generalisation + ADR pointers | ☑ merged c2278a549 (commit 3423580e5; 3-injection proof; root barrel resolved by removal; epic ADR table resolved to live issues) |

**WAVE 1a COMPLETE (8/8).** Boundary sweep clean (knob gate 6/7, three-way mirrors green, walker 22/22, FE coexistence verified); ledger was the only divergence.
### Wave 1b (epic #2326) — **COMPLETE (11/11)** on `oms-programme-wave-1`; boundary in progress
| Issue | Slug | Subject | Status |
|---|---|---|---|
| #2313 | W1b-1 | inventory_locations table/entity/repo | ☑ merged fbcf24b27 (commit bbe58cf1d; reviewed, approved; migration 1843000000000; port trimmed to 5 methods; synchronize-parity index names) |
| #2316 | W1b-2 | locations CRUD API | ☑ merged 11c145daa (commit a30f46a36; reviewed, approved; int-spec 20/20 run by orchestrator after a transient Docker hang) |
| #2314 | W1b-3 | ladder step (i): sourceConnectionId + OL-owned group | ☑ merged 426f6bdc4 (commit 4f77854ea; reviewed, approved; migration 1844000000000) |
| #2315 | W1b-11 | deprecate reserve/releaseInventory in place | ☑ merged 4692d815d (commit 9f3ebd5a6; reviewed, approved; 3 files docs-only) |
| #2317 | W1b-4 | ladder step (ii): 'legacy' sentinel backfill sweep | ☑ merged dd262a818 (commit 483a2e561; reviewed, approved; survived one transient API-403 agent death + resume; union-resolved tokens/module conflicts with #2321) |
| #2323 | W1b-7 | rewire buffer sites onto the seam | ☑ merged 5439a436c (commit 03fac9c9a; reviewed, approved; D1 applyPublishControls + getAppliedReserve; no-direct-buffer-read gate, NO exemptions; parity int-spec 135 tests) |
| #2324 | W1b-8 | retire locationId propagation skip (BREAKING) | ☑ merged d4db3e5d2 (commit 5ee283056; reviewed, approved; BREAKING CHANGE footer verified; Q5 staling-propagation tail included) |
| #2319 | W1b-9 | duplicate-position detection pass | ☑ merged a2b557e4b (commit 671a050df; reviewed, approved; finding: duplicates only reachable via NULL key columns — recorded in ops doc) |
| #2321 | W1b-6 | IAvailabilityService computed seam | ☑ merged bdcdb6711 (commit 104d37869; reviewed, approved; consumed by nobody until #2323) |
| #2320 | W1b-5 | provenance-scoped lookup + per-source prune | ☑ merged a9bd024da (ANALYSIS-2320; imports LEGACY const from #2317; Decision A typed InventoryCrossSourcePositionConflictError naming #2325; #1904 guard unchanged) |
| #2322 | W1b-10 | enforce locationId-NULL semantics | ☑ merged 776152089 (commit 1466b6d6a; reviewed, approved; finding: reversal is half-free — per-variant prune granularity leaves abandoned located rows live; propagate-on-stale gap deferred to #2324) |
### Wave 1c (epic #2337) — gated on #2289 fork decided; Wave 1a
### Wave 2 (epic #2389) — gated per its epic body; §8 Q1 = YES (decision 2 above)

(Fill per-issue tables for each wave when its frontier opens; until then the epic checklist is the list.)

## Wave boundaries completed

- **Wave 0** (2026-08-23): 8 issues + #2298 on `oms-programme-waves-0-2`; boundary review applied at feb78054d; **PR #2438 to main OPEN, awaiting owner merge**.
- **Wave 1a** (2026-08-24): 8 issues on `oms-programme-wave-1` (feb78054d..c2278a549, 70 files +6419/−97); boundary sweep clean. Formal `/pr-review` of **PR #2441** ran (0 BLOCKING, 7 IMPORTANT, 16 SUGGESTIONS; adjudication in scratchpad `prreview-2441-adjudication.md`); ALL 23 applied in fix commit `b1adacdc9`, merged `debcb59a7`. #2441 based on `oms-programme-waves-0-2`; retarget to main after #2438 merges, then merge `origin/main` forward.
- **Migration re-timestamp #2** (2026-08-24 evening): main gained `1841000000006` (#2014 analytics), outranking #2283's amendment migration — renamed `1841→1845` on BOTH lineages (wave-1 `88c92b947`, waves-0-2 `09554111a`). Every unmerged week risks another; merging #2438 then #2441 stops the churn.
- **Migration re-timestamp** (2026-08-24): main gained `1840000000000-reset-fx-stamp…` after the branches were cut, tying with #2287's packed migration. Renamed `1840→1842` on BOTH lineages (wave-1 via `b1adacdc9`; waves-0-2 via `53cbf6f74`, byte-identical → stacked merge stays clean). Consequence: **1842 is consumed — #2313 uses 1843000000000**, next free 1844.

## Resume instructions

1. `cd .claude/worktrees/oms-wave2-programme` (or EnterWorktree with that path); `git fetch origin`.
2. Read this ledger + `git log --oneline origin/main..HEAD` to see what landed.
3. If `node_modules` is missing: `pnpm install`, then `pnpm -r --filter "./libs/**" build`.
4. Continue the frontier: unblocked ☐ issues first, honoring the chains in
   `docs/plans/oms-backlog-overview.md` § Cross-wave critical paths.
5. At a wave boundary: `/pr-review` the wave diff, apply findings, merge `origin/main` in, open the
   wave PR to `main`, ask the owner to merge, and record it here.
