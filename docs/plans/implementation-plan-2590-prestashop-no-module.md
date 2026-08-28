# Implementation Plan: Close #2489 with adapter work and measurement, not a PrestaShop module (epic #2590)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: 30 to 40 working days across 27 implementable children plus one spike, and one verification run on separate hardware
**Epic**: #2590 (answers #2489). Epic branch `epic/2590-prestashop-no-module`, epic PR #2627.

---

## 1. Task Summary

**Objective**: close all ten acceptance criteria of #2489 without building the twelve-endpoint PrestaShop PHP module the issue asked for, and land everything the measurement campaign surfaced along the way.

**Context**: #2489 asked for a dedicated PrestaShop module so that synchronisation stops loading the shop. On 2026-08-27 the current integration was measured on a live stack (10 000 products by 3 variants, counted in PrestaShop's own Apache access log, median of three runs, plus a control run on untouched code from a fresh container). Two of the three premises did not survive.

| Premise in #2489 | Measured |
|---|---|
| Sync puts significant load on the shop | p95 under a full catalogue sweep is 0.989x idle. The shop does not slow down. |
| Bulk reads need a shop-side module | 3 requests, 0.38 s, 1.33 MB for 100 fully hydrated products over the plain Webservice. `PrestashopProductMasterAdapter.getProducts` already exists and has no caller. |
| Not in the issue at all | The queue grows about 145 jobs/h faster than it drains. The 15 066 backlogged jobs on the demo stack were days of normal operation. |

What survived is the one true sentence in the issue: there are too many requests. Two days of adapter work took requests per SKU from 7.96 to 3.97 and the 100-product tick from 977 s to 471 s, reproducing within 0.4% against the control run.

The campaign then produced its most consequential finding. Raising the connection rate limit to 300/min moved throughput from 50 to 63 req/min. The real ceiling is `OL_LANE_REALTIME_SCOPE_CAP`, default 2. With the correct cap raised the stack reached about 277 req/min at a p95 ratio of 0.995. The shop did not move at 5.5x the tempo. After the adapter fix the bottleneck is OpenLinker's own concurrency policy, which the module would not have solved either.

**Classification**: mixed epic.

| Part | Classification |
|---|---|
| PrestaShop TypeScript adapter, HTTP client, query builder | Integration / Infrastructure |
| `apps/prestashop-module/openlinker/**` | Integration (PHP), security |
| Lane and scope policy | Worker / Application, ADR-050 |
| Buyer tax id, job duration | CORE + Database (two migrations) |
| `isCursorRegression`, quantity-write ordering | CORE / Application |
| Connection form, sync-status view | Frontend + CORE |
| Perf harness, baseline reports | DX |
| Setup guide, cron guidance | Documentation |

**This plan is about the epic as a whole**: how the 28 children fit together, which decisions they share, what order they have to land in, and what can go wrong. Each child issue is already fully specified in its own issue. This document does not restate them.

---

## 2. Scope and Non-Goals

### In scope

Twenty-eight children, grouped by what they change. Twenty-seven of them change code or documentation; the twenty-eighth (#2612) is a spike that deliberately merges no implementation.

**Measurement and instrumentation (3)**
- #2595 perf harness and baseline reports under `perf/prestashop-baseline/**`
- #2611 persist job duration on `sync_jobs` (migration)
- #2596 update the PrestaShop setup guide after the adapter fix

**Adapter waste and bulk reads (2)**
- #2592 adapter waste removal: 3x product read, dead resolver cache, per-job currency pair
- #2593 wire the existing bulk product read into the catalogue sweep, with cadence, page budget and prune safety

**Throughput and retry policy (4)**
- #2594 sweep throughput is bounded by `OL_LANE_REALTIME_SCOPE_CAP`, not by the shop
- #2609 inventory propagation is serialised across the whole installation
- #2617 concurrent quantity writes for one offer can resolve to the older value
- #2613 retry classifier treats 429 and 503 identically

**Read-path correctness (5)**
- #2605 timezone and cursor handling in the order source loses orders
- #2606 `isCursorRegression` is wrong for every order source
- #2607 hardcoded order-state map 1 to 7
- #2608 unbounded list reads silently truncate at 100
- #2616 doubly wrapped filter makes search by reference silently fail

**Order and inventory data (4)**
- #2597 accept line prices on the existing order-import controller (conditional, see below)
- #2598 compute pack availability from components
- #2599 carry the buyer tax id on the order contract (migration)
- #2600 send the correct amount paid for cash-on-delivery orders

**PHP module correctness, retention and security (7)**
- #2601 HTML-200 module responses read as success on two paths
- #2602 module settings written per shop, so the secret is invisible on multistore
- #2603 outbox dedup collides with delivered rows and silently drops stock events
- #2604 the outbox has no DELETE and grows without bound
- #2614 outbox backoff has no reset on recovery and no jitter
- #2618 cron delivery on real hosting
- #2619 harden the four legacy module endpoints

**Operator visibility (2)**
- #2610 expose `stockSafetyBuffer`, `pricingRule` and a zero threshold on the connection form
- #2615 per-connection sync status with a backlog alert

**Decide, do not build (1)**
- #2612 spike: is a stock change log worth building

### Out of scope

- **#2625, the end-to-end verification run.** It runs last, on separate hardware, after every other child has merged. No implementation work is planned for it here. Its acceptance criteria are the epic's own closing artefact and are reproduced in section 9 as the exit gate, not as work.
- **The twelve endpoints of the original module design.** `/products/search`, the `/stock/search` full scan, `/products/bulk-upsert`, `/prices/bulk-update`, `/reference/list`, `/health`, the GDPR pack, key scopes, key rotation and the install self-test. Cut by decision, recorded in the epic so they do not return at the next review.
- **Returns and partial cancellation** (#2337, #2389), **reservation ledger and immediate stock hold** (#2389), **order-level discount**, **multilingual publish**. Product features with their own owners.
- **Hardcoded `sendmail=1` on bulk order-status updates.** A real footgun, on a path with no caller today. Noted, not fixed here.
- **The `out_of_stock = 2` sentinel.** Verified by grep that the adapter never reads it. Nothing can misread it.
- **Latency work that is not PrestaShop's fault.** Lives in the sibling sync-latency epic. Its outbox-flush child is blocked by #2603 here.

### Constraints

1. **Acceptance criterion 1 of #2489 is deliberately unassigned.** "Dedicated module implemented" hangs entirely on #2597. If that child is not taken, criterion 1 closes as not done by decision. Nine of ten ticked is the expected outcome, not an oversight.
2. **The baseline is perishable.** Once #2592 merges, baseline A is no longer reproducible on that code. Every measurement child has to land in the right order or the campaign's evidence is lost.
3. **Two migrations.** Both need synthetic sequential timestamps above the current tail `1841000000006`. They cannot be authored in parallel without a collision.
4. **One lane change under ADR-050.** Lane caps bound one worker process, not the deployment. Any cap change multiplies by replica count.
5. **No `pnpm test` on the planning machine.** CI is the gate. PHP children are covered by the existing `test-php` CI job (`pnpm test:php`, PHP 8.1).
6. **`main` requires verified GPG signatures.** Every commit in every child needs `-S`.

---

## 3. Architecture Mapping

### Target layers

| Layer | Children |
|---|---|
| Integration, PrestaShop TypeScript (`libs/integrations/prestashop/**`) | #2592, #2593, #2598, #2600, #2601, #2605, #2607, #2608, #2613, #2616 |
| Integration, PHP module (`apps/prestashop-module/openlinker/**`) | #2597, #2601, #2602, #2603, #2604, #2614, #2618, #2619 |
| CORE, orders | #2599, #2606 |
| CORE, inventory and listings | #2610, #2617 |
| CORE, sync | #2611 |
| CORE, analytics-trust and catalog-trust | #2615 |
| Worker, `apps/worker/src/sync/**` | #2593, #2594, #2609, #2613 |
| Interface, `apps/api/src/**` | #2607, #2611, #2615 |
| Frontend, `apps/web/src/**` | #2610, #2611, #2615 |
| Database | #2599, #2611 |
| DX and Documentation | #2595, #2596, #2618 |

Some children appear in two rows because they span two layers: #2601 (TypeScript client plus PHP controller), #2613 (plugin classifier plus worker runner), #2607, #2611 and #2615 (core plus interface plus frontend).

### Capabilities involved

No new capability port is created by this epic. Existing ports touched:

- `ProductMasterPort` and its `getProducts` bulk read, already implemented and unreferenced (#2593)
- `InventoryMasterPort.listInventory` for pack availability (#2598)
- `OrderSourcePort.listOrderFeed` and `getOrder` for the cursor and truncation fixes (#2605, #2608)
- `OrderProcessorManagerPort.createOrder` for amount paid and line prices (#2597, #2600)
- `OfferManagerPort.updateOfferQuantity` on the quantity-write ordering path (#2617)
- `ISyncJobsService`, `IOrderRecordService` and `IIntegrationsService` for the sync-status read model (#2615)

**Deliberately no new port.** The bulk read exists. The pack concept stays adapter-side by decision (#2598): WooCommerce has different pack semantics and Allegro has none, so a neutral pack model would cement one platform's shape in `libs/core`.

### Core versus Integration justification

Four children genuinely belong in CORE, and each is a case where the defect is platform-independent:

- **#2606 `isCursorRegression`.** The lexicographic fallback is wrong for every order source in the tree, not only PrestaShop. Fixing it in the adapter would leave Allegro, WooCommerce and Erli broken.
- **#2609 propagation lane and scope.** `SYSTEM_CONNECTION_ID` and the `fan-out` registration are OpenLinker's own code and serialise every stock propagation in the installation, whatever the platform.
- **#2617 quantity-write ordering.** The `realtime` lane executes concurrently and promises no ordering. That is a property of our runner.
- **#2599 buyer tax id.** The neutral order contract has no field for it, so no source can supply one. The adapter half is a two-line read from `ps_address.vat_number`; the missing half is the contract.

Everything else stays in the plugin. The plugin never bleeds domain logic back into CORE, and no PrestaShop string enters `libs/core` in this epic.

### Cross-context and cross-epic ripples

- **#2599 unblocks the sales-document rule engine.** `SalesDocumentOrderFacts.buyerHasTaxId` is permanently `undefined` today because no order can supply a value. `toSalesDocumentOrderFacts` (`libs/core/src/invoicing/application/mappers/`) must be updated in the same child, or the field stays `undefined` and the change delivers nothing. Absent must stay distinguishable from known-to-be-empty. Never default to `false` or `''`.
- **#2603 unblocks the sibling latency epic's outbox-flush child.**
- **#2615 extends two read models that consume sibling contexts only through `I*Service`.** That seam has to hold: `analytics-trust` and `catalog-trust` may not inject a `*RepositoryPort` from another context. See `docs/architecture-overview.md` § Cross-context dependencies in core.
- **#2610 touches `stock-safety-buffer.types.ts` and `pricing-rule.types.ts`**, both pure-rule files under the `*.types.ts` exception. Any function added there must stay pure or it has outgrown the exception.

---

## 4. Research

### The four shared decisions

Everything in this epic hangs off four decisions that no single child owns. They are the reason this plan exists.

#### Decision 1: no module, and one narrow exception

The Webservice can do everything the module was proposed for, except one thing. Measured on a real eight-line order: 27 requests, of which 16 are `POST /specific_prices` followed by `DELETE /specific_prices/{id}`, one pair per line. The formula is `k + 2n` with k = 13. Those sixteen cannot be removed over the Webservice: there is no bulk write on that resource, and the buyer-paid price must be pinned to the cart before `validateOrder` runs.

That is the only place in the whole measurement where shop-side code wins structurally. It needs no new endpoint. `controllers/front/importorder.php` already exists, is HMAC-authed, and already accepts an authoritative `amount_paid` passed to `validateOrder` with `$dont_touch_amount = true`.

| Variant | Saving | Cost | What comes with it |
|---|---|---|---|
| Line prices on the existing controller (#2597) | 16 of 27 | 1 to 2 days | Nothing. The signed endpoint already ships. |
| A new bulk order-import endpoint | 26 of 27 | 5 to 8 days | Security envelope, GDPR pack, version negotiation, a data channel to maintain forever |

This decision is drafted as **[ADR-066](../architecture/adrs/066-prestashop-webservice-first-integration.md)** in this same change, status Proposed.

#### Decision 2: the throughput ceiling is ours, and one answer covers both lane children

`OL_LANE_REALTIME_SCOPE_CAP` defaults to 2 (`apps/worker/src/sync/sync-job.runner.ts`, `resolveLaneCaps`). The per-product child `master.product.syncByExternalId` is registered in the `realtime` lane, so raising `OL_LANE_FANOUT_CAP` or `OL_LANE_BULK_CAP`, the obvious move, changes nothing at all.

| Run | req/min | p95 idle | p95 under load | ratio |
|---|---|---|---|---|
| Baseline, default lanes | ~50 | 0.0386 s | 0.0382 s | 0.989 |
| Adapter fix, default lanes | ~50 | 0.0378 s | 0.0380 s | 1.005 |
| Adapter fix, raised lanes | ~277 | 0.0405 s | 0.0403 s | 0.995 |

Applied to the catalogue: 39 700 requests at 277/min is about 2.4 h instead of 26.5 h.

Meanwhile `inventory.propagateToMarketplaces` is registered in the `fan-out` lane, whose total cap and per-scope cap are both 1, and every enqueue uses the same synthetic scope `SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000'` (`libs/core/src/inventory/application/services/inventory.service.ts`). Together those serialise every stock propagation in the entire installation, whatever the number of connections.

**#2594 and #2609 read the same slot accounting and must produce one coherent policy, not two independent tweaks.** Raising the realtime scope cap for sweep children while propagation still holds a single global slot leaves the queue growing. Giving propagation a real scope while sweep children monopolise the realtime lane starves the very orders the lane exists for. ADR-050 chose the caps by cost of starvation, not by throughput, so the number 277 is proof the shop tolerates more and is not a recommendation to set 12 globally.

Three constraints the decision has to respect, and none of them is a matter of taste:

1. **Caps bound one worker process, not the deployment.** Slot accounting is in-process (ADR-050 decision 3, ADR-051). N replicas multiply every effective cap by N.
2. **A raised realtime cap bounds every realtime job for every connection**, including a buyer's order sync. That is the starvation cost ADR-050 priced.
3. **#2609 multiplies concurrent quantity writes from a handful per hour to several per sale.** #2617 has to land with it or before it.

The likely shape, to be settled in #2594 and written into an ADR-050 amendment: a dedicated lane or per-job-type cap for sweep children, so their throughput is bought without lifting the ceiling on genuinely latency-sensitive work. Whatever is chosen, ADR-050 is amended or explicitly confirmed, and the justification is starvation cost, not this one throughput number.

#### Decision 3: safety before throughput on the bulk stock read

The bulk stock read in #2593 removes the only guard against a mass staling, and the failure mode is severe enough to gate the whole child.

`throwForAbsentStockRecords` (`prestashop-inventory-master.adapter.ts`) currently probes the product resource on a zero-row response and treats only a 404 as a deletion. Its comment says so: zero stock rows is an inference, not a platform deletion signal. That probe is exactly the second request the change removes. Meanwhile `MasterInventorySyncService` prunes unconditionally on an empty response with only a `logger.warn`, and the asymmetry against `MasterProductSyncService` is described in the code as deliberate.

A scope bug on multistore, `WHERE id_shop = N` while `share_stock = 1` puts the row on `id_shop = 0`, therefore yields a valid HTTP 200 with an empty page. That stales every known row, and the #1689 stale-variant offer pause then zeroes every mapped offer on Allegro and Erli.

Two acceptance criteria of #2593 exist purely for this, and neither is optional:
- the prune no longer fires on an empty response
- a bulk zero-quantity threshold halts propagation and waits for a human

#### Decision 4: the PHP module surface is small, shared and serialized

Eight children touch `apps/prestashop-module/openlinker/**`, and they collide on four files: `openlinker.php`, `classes/OutboxRepository.php`, `views/templates/admin/configure.tpl` and `upgrade/`.

Two of them also share a protocol rather than just a file. #2602 moves every setting to `Configuration::updateGlobalValue` and must migrate values already written per shop, which means a new upgrade script. #2604 adds retention, which means schema work on the outbox table and possibly another upgrade script. Whoever goes first establishes how `schemaVersion` is written: globally, at the very end of `install()` and of every upgrade script, never in the constructor or a hook. The second child follows that shape instead of inventing a second one.

There is exactly one upgrade script today (`upgrade/upgrade-1.2.0.php`), so the protocol is nearly unestablished and worth pinning deliberately.

### Internal patterns to follow

- **Bounded, resumable sweeps.** `apps/worker/src/sync/bounded-sweep.ts`, `SWEEP_BUDGET_DEFAULT = 100`, `SWEEP_BUDGET_MAX = 500`. #2593 retunes the budget through this shared shape, it does not add a second one. See ADR-048.
- **Migration timestamps.** Synthetic sequential prefixes, strictly greater than everything on `main`. Current tail is `1841000000006`. See `docs/migrations.md` § Timestamp uniqueness invariant.
- **Conditional single-writer updates.** `ShipmentRepository.claimWaybillRelay` is the precedent for a monotonic guard implemented as a narrow conditional UPDATE. #2617 should reach for that shape before reaching for a lock.
- **Status versus outcome.** ADR-007. A permanent condition is a terminal `business_failure`, not a retry. #2613 must not turn a maintenance window into `dead` jobs.
- **Trust read models.** `analytics-trust` (#1982) and `catalog-trust` (#2258) are the shape #2615 extends: a composition of `I*Service` reads with no persistence of its own, and honest vocabulary for what each value means.

### Prior work already on the remote

Two branches hold work that predates the epic and that two children exist to land:

- **`origin/2489-prestashop-baseline`** carries the harness plus baseline A and a plan doc for the adapter/baseline half (`docs/plans/implementation-plan-prestashop-adapter-baseline-and-etap0.md`). That doc covers the measurement method in detail; this plan does not duplicate it and should be read alongside it.
- **`origin/2489-etap0`** carries the adapter fix, the later reports, the control run and the raised-throughput run. It is a superset of the baseline branch.

**This is a sequencing problem, not a convenience.** The two children #2592 (adapter fix) and #2595 (harness plus reports) both draw from `2489-etap0`, so the branch has to be split before either can land cleanly, and the split has to keep the harness landing at or before the adapter fix. Section 6 Wave 0 states the order.

---

## 5. Questions and Assumptions

### Open questions for the epic owner

1. **Is #2597 taken?** It is the only carrier of acceptance criterion 1 and the only PHP work in the epic that is not a bug fix. If it is not taken, the epic closes 9 of 10 by decision and that should be stated in the epic body before the closing report is written, not after.
2. **What lane shape does #2594 choose?** A dedicated sweep lane, a per-job-type cap, or a per-scope override. This plan states the constraints and does not pick. The choice changes what #2593's cadence retune can assume.
3. **ADR numbering.** 065 is claimed by an unmerged branch on the sales-documents line (`docs/architecture/adrs/065-sales-document-read-surface.md`). This plan drafts **ADR-066**. If that branch is abandoned, 065 should be reused rather than left dark; if both merge, 066 is correct as drafted. Nothing guards ADR numbering mechanically (#2082).
4. **Migration prefix allocation.** Three children need one each: `1849000000000` (#2611), `1849000000001` (#2599), `1849000000002` (#2611 follow-up). The `1842`-`1848` band is claimed by open PR #2441 and `1841000000007` by open PR #2630 - neither is on `main`, so `check-migration-timestamps.mjs` cannot see them and this epic was re-prefixed off the `1842` band by hand. Whichever PR merges second re-prefixes again to stay strictly above `main`; someone has to own that ordering across open PRs, because the invariant script only compares against `origin/main`.
5. **Does #2607 need a data migration?** Existing operator-authored order-status mappings may be keyed by PrestaShop state id. Moving to flag-derived mapping could orphan them. The issue does not say. This needs an answer before the child starts, because a silent remap of live order statuses is worse than the hardcoded map it replaces.
6. **What is the backlog alert threshold in #2615, and where does it surface?** A fixed number will be wrong for every install. Arrival-versus-drain rate is the fact the campaign actually measured. The issue says "a threshold" and leaves it open.

### Assumptions

- **The lane decision lands before #2593's cadence retune.** Otherwise the retune is measured against a ceiling that is about to move, and the child's own acceptance criterion says as much.
- **#2625 runs on separate hardware after the last merge.** Stated by the task framing and by the issue itself.
- **CI is the test gate.** `pnpm test` is not run locally on the planning machine. The `test-php` job covers the module children.
- **The demo stack remains available for re-measurement.** Every throughput child's acceptance criteria require a measured before-and-after, and the traps list in #2625 is the record of what invalidates a run.
- **No breaking API change ships.** #2599 and #2611 add nullable columns and additive response fields. #2615 adds a new read. No existing endpoint changes shape.

### Documentation gaps

- **ADR-050 does not yet cover sweep-child throughput.** #2594 amends or confirms it. That amendment is part of the epic, not a follow-up.
- **The setup guide documents only the `curl` cron form** (`libs/integrations/prestashop/docs/setup-guide.md`). #2618 fixes it, and #2596 covers the connection settings the adapter reads, most visibly `config.currency`.
- **`docs/architecture-overview.md` § Inventory and § Sync Manager will need updating** once the lane decision lands. No child owns that edit today. Recommend folding it into #2594.

---

## 6. Proposed Implementation Plan

Five waves. Wave boundaries are dependency boundaries, not schedule boundaries. Inside a wave, children with no shared files can run in parallel.

### Wave 0: close the measurement floor, then apply the fix

**Goal**: land the evidence while it is still reproducible, and land the instrument that the campaign had to work around.

This wave is ordered, not parallel.

1. **#2595 perf harness and both reports.**
   - Files: `perf/prestashop-baseline/**`
   - Action: split the harness plus reports out of `origin/2489-etap0` and `origin/2489-prestashop-baseline` so it lands independently of the adapter change. Resolve the overlap with #1134 (k6 harness) explicitly: either merge them or scope them apart and say which.
   - Acceptance: harness and both reports merged, README explains how to re-run, every figure carries its method and repeat count, derived figures labelled as derived.
   - Depends on: nothing.

2. **#2611 persist job duration on `sync_jobs`.**
   - Files: `libs/core/src/sync/infrastructure/persistence/entities/**`, `apps/api/src/migrations/**`, `apps/api/src/sync/http/sync.controller.ts`, `apps/web/src/pages/sync-jobs/**`
   - Action: add a duration or a finished timestamp beside the existing `lockedAt`, and surface it on the jobs list and detail views. Allocate the migration prefix first (see Q4).
   - Acceptance: duration persisted for every terminal job, `migration:show` clean, visible in the UI.
   - Depends on: nothing, but it is the instrument every later throughput child reads, so it comes early rather than late.

3. **#2592 adapter waste removal.**
   - Files: `libs/integrations/prestashop/src/prestashop-plugin.ts`, `infrastructure/adapters/prestashop-adapter.factory.ts`, `prestashop-product-master.adapter.ts`, `infrastructure/provisioners/*.resolver.ts`, `infrastructure/mappers/prestashop.mapper.interface.ts`
   - Action: review, GPG-sign and merge the four changes already on `origin/2489-etap0`. Hoist the resolver cache out of the per-resolution factory into the plugin closure, memoize `GET /products/{id}` within one job, resolve the shop currency once, cache the VAT rate by tax-rules group.
   - Acceptance: requests per SKU drop to about 3.97 and the 100-product tick to about 471 s, reproduced against the control run. `GET /products/{id}` fetched once per product per job. No `/configurations` plus `/currencies` pair per child job.
   - **Hard gate: do not merge before the baseline numbers have been read and #2595 has landed.** After this merge, baseline A is no longer reproducible.

4. **#2596 update the PrestaShop setup guide.**
   - Files: `libs/integrations/prestashop/docs/setup-guide.md`
   - Action: cover every connection setting the adapter reads, including `config.currency`, and state the request cost of leaving each unset rather than implying it.
   - Acceptance: closes acceptance criterion 9 of #2489 in the no-module variant.
   - Depends on: #2592.

### Wave 1: read-path correctness

**Goal**: stop losing data on paths that currently return a valid-looking result and no error. Every child here is a silent failure today.

These are largely independent. #2605 and #2608 both touch `prestashop-order-source.adapter.ts` and `prestashop-query.builder.ts`, so they serialize against each other; #2616 also touches the query builder.

1. **#2616 doubly wrapped filter.** `filter[filter[reference]]` reaches the Webservice, which ignores it and returns the first 100 rows unfiltered. On a catalogue over 100 products, search by reference simply does not find things. Fix the call sites and make a malformed filter an error rather than a silent pass-through. An ignored filter that returns too much data looks like success, which is the failure shape this whole wave is about.
2. **#2608 unbounded reads truncate at 100.** `order_details` and the combinations list are fetched without a limit. A wholesale order loses every line past the hundredth. Page every list read and treat "returned exactly the page size" as "there may be more", never as "that is all".
3. **#2605 timezone and cursor handling.** Three independent mechanisms lose orders: a filter built with the worker's clock and compared against the shop's, no `sort` in the query while the cursor takes `max(date_upd)` of an id-ordered subset, and second-level precision with a strict `>`. Move to a keyset cursor over `(date_upd, id)` with a matching `ORDER BY`, explicit offsets end to end, and a bounded lookback that never moves the watermark backwards.
4. **#2606 `isCursorRegression`.** Make unknown not a regression. A false regression halts ingestion for a connection permanently; a missed one costs one repeated read of an idempotent ingestion. The check is biased the wrong way. Compare only where the format is understood, otherwise pass through and log once. Tests cover base64, ISO and numeric cursors.
5. **#2607 hardcoded order-state map.** Read the states from the shop and map by the real flags on `ps_order_state`. Surface the resolved list to the mapping-configuration UI. See Q5 before starting.
6. **#2598 pack availability from components.** Resolve `pack_stock_type` shop-side; the value 3 means "use the shop default" and must never reach core. A pack with no stock rows of its own must not be mistaken for a deleted product by `throwForAbsentStockRecords`, which makes this child touch the same guard #2593 rewrites. Coordinate the two.
7. **#2600 amount paid for cash on delivery.** No PHP change needed; the controller already accepts an authoritative `amount_paid`. The gap is that nothing on the OpenLinker side decides what value to send. The distinction must be explicit data, never inferred from a payment-method string.
8. **#2599 buyer tax id on the order contract.** Add the field, persist it on `order_records`, populate it from `ps_address.vat_number`, and make `toSalesDocumentOrderFacts` pass a real value instead of `undefined`. Absent stays distinguishable from empty. Migration prefix per Q4.
9. **#2613 retry classifier splits 429 from 503.** A shop in maintenance for twenty minutes currently burns the retry budget of every job touching it and pushes them to `dead`, even though the correct behaviour is to wait. `429` requeues penalty-free and must not be double-counted against the HTTP client's own internal retry; `503` backs off without consuming the whole budget.

### Wave 2: throughput, as one decision

**Goal**: make the drain rate exceed the arrival rate without letting a catalogue import delay a buyer's order.

Ordered, because each step changes what the next one measures.

1. **#2617 ordered per-offer quantity writes.** A monotonic token carried on the job and compared at the write, or per-offer serialisation. Do not rely on lane ordering, which the lane does not promise. The guard must cost no extra marketplace call. Tests cover the reversed-arrival case explicitly. This lands first because #2609 multiplies the number of concurrent writes.
2. **#2609 propagation lane and real scope.** Give propagation the destination connection as its scope instead of `SYSTEM_CONNECTION_ID`, and move it out of the single-slot `fan-out` lane. Acceptance requires two connections propagating concurrently and a measured drain rate exceeding the measured arrival rate on the demo catalogue.
3. **#2594 sweep-child throughput policy.** Write the decision down, amend or explicitly confirm ADR-050, justify the setting by starvation cost rather than by the 277 figure, re-measure catalogue cycle time under the chosen policy, and record acceptance criterion 5 of #2489 as measured at elevated tempo with the ratio and the run conditions. Fold in the `docs/architecture-overview.md` update.
4. **#2593 bulk product read, paged stock, cadence and prune safety.**
   - Pipe-join `filter[id]` (a comma is read by PrestaShop as a range, an OR list needs a pipe) and emit `sort`, with `date_upd` on the allowed sort list.
   - Wire `getProducts` and a paged `stock_availables` read into the sweep.
   - Retune `pageLimit` and cron cadence in the same change, accounting for the lane ceiling from step 3.
   - **Ship the two safety criteria from Decision 3 or the child is not done.**
   - Record measured catalogue cycle time before and after.

### Wave 3: the PHP module surface

**Goal**: fix what already runs at customers, and add the one thing shop-side code wins at. Serialized on the four shared files.

1. **#2602 global settings.** `Configuration::updateGlobalValue` for every setting including the shared secret. Today's webhooks are broken on every multistore install because a value saved from one shop is invisible from another. Ship the upgrade path that migrates per-shop values, and establish the `schemaVersion` protocol described in Decision 4.
2. **#2603 outbox dedup.** Exclude delivered rows from the uniqueness collision and remove the operator-facing dedup-window dial. The remedy must not depend on an operator setting two numbers in the correct relation, and the README must stop advising that the window be widened. Verify at a one-minute cron with no systematic loss. This also unblocks the sibling latency epic.
3. **#2604 outbox retention.** Prune delivered rows past a configurable horizon and add a hard row cap with defined behaviour on reaching it. Retention runs without an operator action. Any future change log or state table gets the same treatment from day one.
4. **#2614 backoff reset, jitter, wall-clock budget.** Reset on a successful delivery, jitter the retry times, cap a run's wall clock well below the tightest documented hosting limit (AZ.pl's lowest tier kills a process at 300 s), and recover rows left in `processing` by a killed process without the fifteen-minute wait.
5. **#2619 harden the four legacy endpoints.** Constant-time token comparison off the request body rather than the query string, a method check on every controller before any work, a nonce on the order-import path consumed by insert-and-catch-unique (never select-then-insert, which two concurrent copies both pass), and stop rendering the secret into the admin HTML after first display. A negative-test set covers each of the four.
6. **#2601 HTML-200 on two paths.** One parser validating content type and envelope shape, used by both call sites, plus an `active` check on the payment module before calling `validateOrder`. Note that `importOrder` in the same client already throws `malformed-import-order-response`; the sibling `writeCartShipping` call does not, and an order created with zero delivery cost is the consequence.
7. **#2597 line prices on the existing controller (conditional).** Optional line-prices field on the existing payload. The module pins the prices and, in the same request and transaction, deletes only the rows it created for that cart id. Not a registry of "our own" promotions, which the original design flagged as unsafe because several modules use `id_cart = 0`. The adapter falls back to the per-line path when the module reports the field unsupported. Rounding matches core's mode exactly, because a per-line net mismatch shifts the order total by a grosz. Target: 11 requests instead of 27, measured the same way as the baseline.
8. **#2618 cron delivery on real hosting.** Ship a cron entry file that reads its token from module configuration rather than from arguments (home.pl and AZ.pl define a job by file name and cannot pass arguments, so the documented `curl` command is unrunnable there), document OVH's one-hour minimum granularity with its consequence in operator terms, and call out `cron.prestashop.com` as a trap rather than an option: it was switched off in December 2025 and now returns HTTP 200 and does nothing. Show in the panel when delivery last actually ran.

### Wave 4: operator visibility

**Goal**: make the two things an operator can act on reachable, and make a backlog announce itself.

1. **#2610 connection-form fields plus the restore-path fix.** `stockSafetyBuffer` is the only remedy that works on the last unit, because it does not depend on any propagation delay, and it currently protects zero installations because there is no form field for it. `pricingRule` is in the same position. Add both plus the zero threshold, and fix the cancellation stock-restore path that wipes the buffer on the first cancellation. Below the threshold the published quantity is 0 as a deliberate operator choice, never as a side effect of a post-sale hold.
2. **#2615 per-connection sync status with a backlog alert.** Extend the existing trust read models rather than building a new one: transport in use and since when, last successful call, cursor age, ingestion backlog with an alert threshold, and page-shrink frequency translated into a sentence about the hosting rather than a flag in JSON. **The view must render when the shop is unreachable.** That is the whole reason it lives on our side rather than behind a module endpoint: diagnostics behind the controller that fails are diagnostics you cannot read when you need them. See Q6 on the threshold.

### Wave 5: decide, do not build

1. **#2612 stock change log spike.** `ps_stock_available` has no timestamp column of any kind, so the Webservice can never answer "what changed in stock since X". This is the only capability a shop-side module would provide that the Webservice cannot match, and simultaneously the largest and riskiest item of the original project. Produce a written recommendation with a cost including retention and reconciliation, and a stated kill condition: the measurement result at which it is not worth building. Answer specifically how much of the stock cycle remains painful once the catalogue cycle is measured in minutes rather than hours, whether the three-layer capture is affordable (`actionUpdateQuantity` is not fired by `StockAvailable::update()` and therefore not by Webservice writes, so the generic `actionObject*` hooks plus a periodic full reconciliation are needed), and how the `seq` visibility gap is handled since a number is assigned at insert and becomes visible at commit. If recommended, the hook registration and the feedback-loop fix are scoped as one indivisible change, because registering the `ObjectModel` hook closes a feedback loop across every product. **No implementation is merged under this issue.**
   - Depends on: #2593 and #2594.

### Exit gate, not a wave

**#2625 end-to-end verification run.** Out of scope for implementation here. Runs last, on separate hardware. Its comparison table is the artefact anyone reviewing this epic will read first.

---

## 7. Alternatives Considered

### Alternative 1: build the module as specified in #2489

Twelve endpoints, a signed data channel, GDPR pack, version negotiation, key scopes and rotation, an install self-test. Estimated 352 to 576 person-days in the original design work.

**Rejected because the measurement removed the premise.** The shop does not slow down (p95 ratio 0.989 under a full sweep). Bulk reads already work over the Webservice at 3 requests per 100 hydrated products. The one endpoint that would have won structurally, bulk order import, is 26 of 27 requests against 16 of 27 for a conditional field on a controller that already ships, at 5 to 8 days against 1 to 2. The remaining ten endpoints were infrastructure for a data channel we are not building.

**Trade-off accepted**: incremental stock detection is genuinely impossible over the Webservice, because `ps_stock_available` carries no timestamp. That is the one real capability gap and it is deferred to a spike (#2612) with an explicit kill condition rather than assumed away.

### Alternative 2: raise `OL_LANE_REALTIME_SCOPE_CAP` globally and call the throughput problem solved

The measurement is right there: cap 2 gives 50 req/min, a raised cap gives 277 at a p95 ratio of 0.995.

**Rejected because that cap bounds every realtime job for every connection**, and ADR-050 chose it by cost of starvation rather than by throughput. A catalogue import delaying a buyer's order sync is exactly the failure the lane partition exists to prevent. It is also per-process, so a multi-replica deployment multiplies whatever number is chosen. The measurement proves the shop tolerates more. It does not tell us what an order can tolerate.

### Alternative 3: ship the bulk stock read now and fix the prune guard as a follow-up

Faster, and the two changes are in different files.

**Rejected because the bulk read deletes the only guard that currently stands between an empty HTTP 200 and a mass staling**, and a mass staling propagates through #1689 to zero every mapped offer on every marketplace. The guard's replacement is not a follow-up, it is a precondition. #2593's acceptance criteria say so.

### Alternative 4: one branch, one PR for the whole epic

**Rejected.** Twenty-seven children spanning CORE, two host apps, a PHP module, the frontend and two migrations cannot be reviewed as one diff, and Wave 0's hard ordering constraint (harness before adapter fix) needs separate merges to be enforceable at all. The epic branch plus per-child branches is the shape already in use, with a single epic PR (#2627) as the integration point.

---

## 8. Validation and Risks

### Architecture compliance

- **Hexagonal layering**: respected. No new port. Adapters keep platform vocabulary; the four CORE children are platform-independent defects.
- **CORE versus Integration boundary**: respected. The pack concept stays adapter-side by explicit decision (#2598). No PrestaShop string enters `libs/core`.
- **Cross-context seam**: #2615 must consume sibling contexts through `I*Service` only. Injecting a `*RepositoryPort` from another context fails `scripts/check-cross-context-imports.mjs`.
- **Pure-rule exception**: #2610's additions to `stock-safety-buffer.types.ts` and `pricing-rule.types.ts` must stay pure. A function that grows a dependency has outgrown the exception and belongs elsewhere.
- **Naming**: existing files only, with the two migrations following the documented convention.

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Mass staling from an empty bulk stock page.** A multistore scope bug returns HTTP 200 with zero rows, the unconditional prune stales every row, and #1689 zeroes every mapped offer on Allegro and Erli. | Highest in the epic | #2593's two safety criteria are gating, not optional: no prune on an empty response, plus a bulk zero-quantity threshold that halts and waits for a human. Coordinate with #2598, which touches the same guard. |
| **The baseline becomes unreproducible.** #2592 merging before #2595 destroys the "before" half of acceptance criterion 10 permanently. | High | Wave 0 is ordered. #2592 carries an explicit do-not-merge-first criterion. The `2489-etap0` branch has to be split before either child lands. |
| **A raised lane cap starves a buyer's order.** The realtime scope cap bounds every realtime job for every connection, and per-process accounting multiplies by replica count. | High | #2594 decides with starvation cost as the stated justification, amends ADR-050, and re-measures. Not a config tweak. |
| **Two migrations collide.** Both #2599 and #2611 need a synthetic prefix above `1841000000006`. | Medium | Allocate both up front (Q4). `scripts/check-migration-timestamps.mjs` catches a collision at lint time, but late. |
| **PHP children conflict on four shared files.** `openlinker.php`, `OutboxRepository.php`, `configure.tpl`, `upgrade/`. | Medium | Wave 3 is serialized in the stated order. #2602 goes first and establishes the `schemaVersion` and upgrade-script protocol. |
| **#2607 silently remaps live order statuses.** Existing operator mappings may be keyed by state id. | Medium | Answer Q5 before the child starts. A wrong-but-silent remap is worse than the hardcoded map. |
| **#2609 multiplies out-of-order quantity writes** from a handful per hour to several per sale. | Medium | #2617 lands first. Stated in both issues. |
| **A measurement run is silently invalidated.** The campaign hit every trap in #2625's list: a retry that re-attached instead of creating, hardcoded worker debug logging inflating timings, first-`syncAll` taking a different code path, retries polluting request counts, MySQL OOM answering 500. | Medium | Every throughput child re-reads that traps list before recording a figure. After each run, compare the sum of `attempts` in `sync_jobs` against the job count; if higher, the run is contaminated and must be repeated. |
| **Nine of ten acceptance criteria is read as failure.** | Low, reputational | Stated in the epic body and in section 2 here. Criterion 1 closes as not done by decision unless #2597 is taken. |
| **ADR number collision on 065.** | Low | ADR-066 drafted. Q3 records the situation. |

### Edge cases the plan expects the children to cover

- A shop with exactly 100 order lines or exactly 100 combinations. #2608's "a full page means there may be more" rule is what makes this safe.
- Three orders sharing one `date_upd` second, one of them ending a page. #2605's keyset cursor.
- A base64 or ISO cursor. #2606 must not report a regression for a shape it does not understand.
- A pack with no stock rows of its own. #2598 plus the #2593 guard.
- A COD order and a prepaid order through the same code path. #2600's distinction is data, not a payment-method string.
- An order with a company name but no VAT number. #2599's absent versus empty.
- A byte-identical replay of an order import. #2619's nonce, consumed by insert-and-catch-unique.
- A module version that does not support the line-prices field. #2597's fallback.
- A one-minute cron with a five-minute dedup window. #2603 verified at one minute with no systematic loss.
- Two concurrent quantity writes arriving in reverse order. #2617's explicit test.

### Backward compatibility

No breaking change ships. Both migrations add nullable columns. #2599 and #2611 add response fields additively. #2615 adds a new read. #2597 is negotiated: the adapter falls back when the module reports the field unsupported. #2602 and #2604 need upgrade scripts, which is the module's existing mechanism.

Two behaviour changes are operator-visible and intentional: #2607 changes which PrestaShop state maps to which neutral status on a shop with custom states (see Q5), and #2603 removes an operator-facing setting.

---

## 9. Testing Strategy and Acceptance Criteria

### Unit tests

Every child whose issue says "tests added or updated for non-trivial logic" means it. The ones worth naming because the test is the point:

- **#2606**: base64, ISO and numeric cursors, plus the assertion that an unrecognised shape is not a regression.
- **#2617**: the reversed-arrival case, explicitly.
- **#2605**: three orders in one second, an empty page not freezing the cursor, and a container timezone change not changing which orders are returned.
- **#2608**: an order with more than 100 lines, a product with more than 100 combinations.
- **#2616**: no call site sends a nested `filter[filter[...]]`, and a malformed filter fails loudly.
- **#2613**: a twenty-minute maintenance window moves no job to `dead`.
- **#2619**: a negative-test set per endpoint, four in total.
- **#2599**: absent stays distinguishable from empty, all the way to `toSalesDocumentOrderFacts`.

### Integration tests

The PrestaShop Testcontainer harness already exists (`apps/api/test/integration/helpers/prestashop-container.helper.ts`, shared container, OL module installed). It is the right gate for anything where PrestaShop is the source of truth rather than the request shape:

- #2601's HTML-200 paths and the inactive payment module.
- #2597's line-price pin and same-request cleanup.
- #2607's flag-derived state mapping against a shop with custom states.

Nothing resets PrestaShop between specs, so assert only over OpenLinker-side results or filter by ids the spec itself created.

### PHP tests

`pnpm test:php` runs in CI (`test-php` job, PHP 8.1). The eight module children extend `apps/prestashop-module/openlinker/tests/Unit`.

### Measurement, which is a test here

Four children carry a measured acceptance criterion: #2592, #2593, #2594, #2609. Each figure is a median of three runs with the first discarded, counted in PrestaShop's own Apache access log, over localhost only. The traps list in #2625 is the operating manual.

### Epic-level acceptance criteria

- [ ] All 28 children merged into `epic/2590-prestashop-no-module`, every commit GPG-signed
- [ ] `pnpm lint`, `pnpm type-check` and CI green on the epic PR (#2627), including `test-php`
- [ ] Both migrations present with strictly increasing synthetic timestamps, `migration:show` clean
- [ ] ADR-050 amended or explicitly confirmed by #2594, with starvation cost as the stated justification
- [ ] ADR-066 (no module) accepted or explicitly rejected, not left Proposed indefinitely
- [ ] `docs/architecture-overview.md` updated for the lane change and the sync-status read model
- [ ] #2612 delivers a written recommendation with a cost and a kill condition, and merges no implementation
- [ ] The prune no longer fires on an empty stock response, and a bulk zero-quantity threshold halts propagation
- [ ] Measured drain rate exceeds measured arrival rate on the demo catalogue
- [ ] Acceptance criterion 1 of #2489 has an explicit disposition: closed by #2597, or closed as not done by decision
- [ ] #2625 runs last, on separate hardware, and its comparison table records anything that contradicts a claim in this epic as a contradiction rather than smoothing it over

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture. No new port, adapters keep platform vocabulary, the four CORE children are platform-independent.
- [x] Respects CORE versus Integration boundaries. The pack concept stays adapter-side by explicit decision.
- [x] Uses existing patterns. `runBoundedSweep` for the sweep retune, the `claimWaybillRelay` conditional-update shape for #2617, the `analytics-trust` composition shape for #2615, the existing module upgrade mechanism for #2602 and #2604.
- [x] Idempotency considered. #2606 is explicitly biased toward a repeated idempotent read over a permanent halt; #2597's cleanup is same-request and cart-scoped; #2619's nonce is insert-and-catch-unique.
- [x] Event-driven patterns respected. The outbox children preserve the module's existing delivery model, and #2603 is what unblocks the sibling latency epic's flush child.
- [x] Rate limits and retries addressed. #2613 splits 429 from 503 without double-counting the client's own retry; #2614 adds reset, jitter and a wall-clock budget below the tightest hosting limit.
- [x] Error handling comprehensive. Every Wave 1 child converts a silent failure into a loud one.
- [x] Testing strategy complete, including the measurement discipline and the traps that invalidate a run.
- [x] Naming conventions followed. Existing files plus two migrations on the documented synthetic-prefix convention.
- [x] File structure matches standards.
- [x] Plan is execution-ready, with six open questions surfaced rather than guessed.
- [x] Plan saved as a markdown file.

---

## Related Documentation

- [ADR-066: PrestaShop stays Webservice-first](../architecture/adrs/066-prestashop-webservice-first-integration.md) (drafted with this plan)
- [ADR-050: Workload isolation and concurrency lanes](../architecture/adrs/050-workload-isolation-concurrency-lanes.md)
- [ADR-048: Incremental catalog replication](../architecture/adrs/048-incremental-catalog-replication.md)
- [ADR-007: SyncJob status versus outcome](../architecture/adrs/007-syncjob-status-vs-outcome-split.md)
- Implementation plan `implementation-plan-prestashop-adapter-baseline-and-etap0.md`, currently only on `origin/2489-prestashop-baseline`, which covers the measurement method in detail
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Database Migrations](../migrations.md)
