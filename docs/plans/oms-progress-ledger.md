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
### Wave 1b (epic #2326) — **COMPLETE (11/11)** on `oms-programme-wave-1`; boundary DONE (sweep + formal review, all findings applied in b8ebdbf09/c8e0dfa24)
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
### Wave 1c (epic #2337) — **COMPLETE (9/9)**; boundary DONE (merge-forward + 3-reviewer /pr-review, all 13 findings applied)
| Issue | Slug | Subject | Status |
|---|---|---|---|
| #2327 | W1c-1 | returns context: model + migration 1846 | ☑ merged 902c83ebb (commit bd7b3b26f; reviewed, approved; incl. ADR-060 custody amendment) |
| #2329 | W1c-3 | ReturnSourceReader contract | ☑ merged 8ecc8b855 (commit 0edf7f52a; reviewed, approved; cursor-type AC deviation stated) |
| #2330 | W1c-4A | Allegro ReturnSourceReader + returns jobs | ☑ merged (commit 4d9d4e7c0; reviewed, approved; three job types; full test:integration surfaced 3 PRE-EXISTING failures → repair pass dispatched) |
| #2328 | W1c-2 | ReturnsService idempotent update-or-create | ☑ merged 29b2579f4 (commit fc4718112; reviewed, approved; O1 synthesise-adapter-side ruled; no created-detection) |
| #2332 | W1c-5 | orphan bucket + trigger block + reconcile | ☑ merged 7510c9639 (commit 171d93b99, reconciled onto #2333 as 16b901551; reviewed, approved; migration re-timestamped 1847→**1848**; issue premise corrected — `externalOrderId` was never persisted, column added with COALESCE apply, no backfill; mutation-tested int-specs killed two tests that passed while broken) |
| #2375 | W2-50 | spike: Allegro commission-refund claim writability | ☑ merged 89c92771b (verdict **Branch A — writable** via `POST /order/refund-claims`; spec §5.7 selects A. #2379 resized: the claim keys on an order LINE ITEM, ambiguous when one order repeats an offer; 422 `ClaimExistsException` is the only idempotency guarantee and carries no claim id. Sandbox availability UNDETERMINED → #2379 plans for recorded fixtures, not a live int-test) |
| #2384 | W2-46a | `check-ui-vocabulary.mjs` vocabulary gate | ☑ merged 15a052b8f (reviewed + adversarially verified by the orchestrator: correct line numbers, URL-in-docblock not flagged, exit 1 on a real hit. Two self-found defects fixed — comment stripper collapsed lines, and a non-string-aware stripper silently dropped strings containing `//`. **Follow-up to file:** the eslint `no-restricted-imports` slug groups the issue assumed do not exist yet; a 4th mirror becomes possible once the FE issues land) |
| #2334 | W1c-7 | returns read API | ☑ merged 1601efe4b (commit 0c3c6953f; reviewed, approved; `total` bucket-applied vs `counts` bucket-less; `declineAvailability` backend-resolved because FE derivation fails in the wrong direction; `ReturnDeclineExceptionFilter`→`ReturnsExceptionFilter`, 404/409/400 mapping unchanged and predating this slice) |
| #2335 | W1c-8 | returns list with the orphan bucket | ☑ merged ac57d1d9d (commit 4361af847; reviewed, approved; 5 empty-state branches incl. past-the-end + all-rows-unreadable; vocabulary gate now scans `features/returns`, 6 files; declared deviation — chips are All/Orphan/Matched, no `declined` chip, since the API offers no such filter and it would misreport beyond page 1) |
| #2333 | W1c-6 | `return.decline` + the `order_changes` table (**Wave-2 gate**) | ☑ merged (commit bbcdef929; reviewed, approved; migration 1847; index-name + partial-predicate parity verified against the ORM entity; no-OL-clock-fallback on `declinedAt` verified at source; `ReturnDecliner` shipped as its own capability, not a `ReturnSourceReader` method) |
| #2336 | W1c-9 | FE return detail + verbatim source status + decline | ☑ merged c2260eb4b (commit 1e1199b91; reviewed, approved; `declinedAt` ALONE drives the Declined badge so a 2xx cannot claim a decline; an unreadable `declineAvailability.reason` says OL could not establish, never "the channel does not"; landed the filter's `trigger` on the 409, which its own docblock had instructed consumers to read while the field never crossed the HTTP boundary) |

### Wave 1c boundary (2026-08-26)

1. **Integration debt settled** — the #2330 "repair pass dispatched" never landed (no commit existed). Re-run and classified: 2 wave-introduced failures fixed, 1 pre-existing on `origin/main` left alone and filed. One was a **production defect**, not a test defect: `markLocationlessStaleForSource` (#2322) read node-postgres UPDATE results as the row list rather than the `[rows, affectedCount]` tuple, making `markedCount` a constant 2, `variantIds` a constant `[]` — so `MasterInventorySyncService` enqueued an aggregate propagation on EVERY inventory sync carrying no variant, and never the correct one. Merged 1adb9ca35.
2. **Merge-forward** of `origin/main` (0.8.0, chiefly #2014) — 30 files conflicted, resolved by intent. No migration re-timestamp needed (main's tail 1841000000006 < our 1842–1848). Merged fb729d9a5.
3. **Two defects that exist ONLY in the combination of the branch and main** — each side correct alone, compiles clean, no pre-existing test catches either:
   - main's `upsertWithLineItems` used full-object `save()` (the shape #2282 abandoned) and so **bypassed the source-attribution freeze**. Fixed 7024571a9 with one shared `buildFrozenAttributionUpsert` parameterised across both write paths, plus a test proven to fail before and pass after.
   - `fromRawRow`'s hand-enumerated reset list was outflanked by six new columns from main (a record could assert `salesDocumentBlockedAt` with a nulled `salesDocumentBlockReason`). Fixed **structurally** — the reset set is now derived from the statement's write set — which caught a seventh column nobody had named (`taxRateEra`).
   Both were the same mechanism: a hand-enumerated guarantee meeting a branch that added members. Both are now derived rather than enumerated.
4. **`/pr-review`** — three Opus reviewers over the unreviewed slice `2a7a49052..7024571a9` (1a/1b were already reviewed at b8ebdbf09). **13 findings: 1 BLOCKING, 6 IMPORTANT, 6 SUGGESTION — all applied, none declined** (96f970404 web, 23e63c366 backend). The blocking one: an unreadable response *envelope* fell through to "No returns recorded yet." — the page defended against rows it could not read but not an envelope it could not read. Also renamed `order_changes.confirmedAt` → `terminalisedAt` (decline and expire both wrote it, so `WHERE confirmedAt IS NOT NULL` silently included refusals and timeouts) — migration 1847 edited in place, no data exists.
5. **Gates**: build, lint, `check:invariants`, type-check, full unit suite, `apps/web` (385 files / 4060 tests) all green. Integration verified in targeted batches — **14 suites / 110 tests** across the whole blast radius (migration rename schema-parity, #2282's own attribution spec, the `fromRawRow`/`upsert` consumers, returns read+ingestion). The full 119-suite run was killed twice before starting a single test; the remaining ~105 suites are green as of 1adb9ca35 and untouched since. CI runs the full suite on the PR.
6. **PR #2441 retargeted from the stack to `main`** and expanded to cover Waves 0–1c (39 `Closes`). The stack had stopped working: this branch has main merged in while `oms-programme-waves-0-2` does not, so a stacked diff rendered main's #2014 as if it were ours. **PR #2438 is superseded** (this branch contains all of Wave 0 — `feb78054d` is an ancestor and both lineages carry byte-identical 1842/1845 files) and can be closed.
7. **Filed against main, not fixed here**: #2496 (`earliest-order-date` is timezone-dependent — passes under `TZ=UTC`, fails for any contributor not running UTC, invisible in CI) and #2497 (`carrier-mapping S-3`, `HTTP 0` on the OL-module `importorder`, reproduced on a clean `origin/main`).

### Wave 2 (epic #2389) — OPEN. Gate satisfied: Wave 1c landed with its fork decided; #2333 (`order_changes`) merged; §8 Q1 = YES.

Branch: `oms-programme-wave-2`, cut from the Wave-1c tip. Deliberately NOT stacked on `oms-programme-wave-1` — #2441 is open against `main` awaiting merge, and stacking 49 more issues onto its head branch would grow a PR already in review.

Already merged early (dependency-free, per the epic's own scheduling): **#2375** (spike) and **#2384** (vocabulary gate) — both rode the Wave-1c PR.

Five bodies, run concurrently (different surfaces), serial within each body, each agent in its OWN worktree:
- **A · Order holds** — #2338 → #2339 → #2340 → #2341 → #2342
- **B · Reservation ledger** — #2343 → #2344 → #2345 → #2346/#2347/#2348 → #2349 → #2350
- **C · Authority surface + presets** — #2351 → #2352 → #2353 → #2354/#2355/#2356; #2357 DX mirror
- **D · Automation v1** — #2358 → #2359 → #2360/#2361 → #2362 → #2363 → #2364/#2365/#2366; ops half #2385 → #2386, #2387
- **E · Returns custody, disposition, money** — #2367, #2368 → #2369, #2370, #2371, #2372, #2373, #2374, #2376, #2377, #2379 (scoped by the #2375 spike), FE #2378/#2380/#2381/#2382/#2383
- **#2388** (responsive audit) LAST, once all four new surfaces exist.

Migration tail: **1848**. Next free: **1849**.

(Fill per-issue tables for each wave when its frontier opens; until then the epic checklist is the list.)

## Wave boundaries completed

- **Wave 0** (2026-08-23): 8 issues + #2298 on `oms-programme-waves-0-2`; boundary review applied at feb78054d; **PR #2438 to main OPEN, awaiting owner merge**.
- **Wave 1b** (2026-08-25): 11 issues complete; boundary = consistency sweep (3 docs fixes) + formal two-reviewer review (3 BLOCKING incl. the unscoped no-change-guard lookup, 17 IMPORTANT) adjudicated apply-all in prreview-1b-adjudication.md, applied as b8ebdbf09, merged c8e0dfa24. PR #2441 retitled to cover Waves 1a+1b with the full Closes list + BREAKING note. Wave 1c OPENED (Scope A recorded on epic #2337): #2327 implementing, #2329 gate-cleared behind it.
- **Wave 1a** (2026-08-24): 8 issues on `oms-programme-wave-1` (feb78054d..c2278a549, 70 files +6419/−97); boundary sweep clean. Formal `/pr-review` of **PR #2441** ran (0 BLOCKING, 7 IMPORTANT, 16 SUGGESTIONS; adjudication in scratchpad `prreview-2441-adjudication.md`); ALL 23 applied in fix commit `b1adacdc9`, merged `debcb59a7`. #2441 based on `oms-programme-waves-0-2`; retarget to main after #2438 merges, then merge `origin/main` forward.
- **Migration re-timestamp #4** (2026-09-01): re-timestamp #3 computed its range against the `apps/api`-only baseline. The check pools core AND plugin migrations (`scripts/plugin-migration-dirs.json`; one shared `migrations` table via `apps/api/src/plugin-migrations.ts`), and main gained `libs/integrations/allegro/src/migrations/1850000000000-widen-allegro-quantity-command-unique-index.ts` (epic #2630), moving the true pooled floor to `1850000000000` — so all eight of #3s block PLUS `1850000000000-create-reservations` were at or below it, the last EXACTLY TYING the Allegro migration (the #374 collision class). Renumbered into `1850000000001`–`1850000000009`, relative order preserved. NOT moved to the tail: `1851000000000-create-automation-tables` already exists and `1852`–`1869` depend on these tables, so the only correct window is between the Allegro floor and `1851000000000`. Every `up()` is now SELF-HEALING (`DELETE FROM migrations` for both the #3 and pre-#3 class names) and every `CREATE INDEX` in `create-returns` gained `IF NOT EXISTS`, so already-migrated dev DBs converge on a plain `migration:run`.
- **Migration re-timestamp #3** (2026-08-28): main advanced to `1849000000003-add-operational-settings.ts`, putting EIGHT branch migrations below the baseline — and `1849000000000-create-order-holds.ts` in the SAME slot as main's `1849000000000-add-sync-job-last-attempt-duration.ts` (the #374 collision). Renumbered into the contiguous block `1849000000004`–`1849000000011`, relative order preserved: packed→1849000000004, inventory-locations→…005, source-connection-id→…006, amendment→…007, returns→…008, order-changes→…009, return-external-order-id→…010, order-holds→…011. `1853000000000-add-oms-attention` and `1855000000000-add-order-record-active-hold-reason` already sorted above the baseline and were left alone. Renumbering wave-1/PR #2441's migrations is safe ONLY because the owner has decided the whole feature merges to main as ONE PR from this branch, so no duplicate numbering can reach main. Slots reserved by in-flight wave bodies (1850/1851/1853/1854/1855/1856/1861) are untouched.
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
