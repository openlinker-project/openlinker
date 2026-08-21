# ADR-048: Incremental catalog replication — a master capability ladder, two cadences, budget-bounded runs

- **Status**: Proposed
- **Date**: 2026-08-20
- **Authors**: @piotrswierzy

> Filed as ADR-047 in #2166. Renumbered to **048** because 046 and 047 were claimed
> outside the #2162 epic (by #2203 and #2213) while the epic sat open. See the
> reserved-numbers note in [`README.md`](./README.md).

## Context

`ProductMasterPort.listExternalIds(filters?: { limit?, offset? })` can express exactly one request: *enumerate everything*. There is no `since`, no change filter, and the two `syncAll` handlers hold no watermark. So every 20 minutes `master-product-sync-all.handler.ts` pages the whole catalog and does `externalIds.map(...)` over `Promise.allSettled` — one child job per product, uncapped — into a runner whose execution concurrency is 1. The inventory sweep runs the same shape every 15 minutes, except that it does not even read the platform: it calls `listExternalIdsByConnection`, a bare `find({ entityType, connectionId })` with no `take`, no ordering and no filter, and fans out over the entire result.

Three further facts frame the decision:

**The existing bound is a truncation guard that reports success.** `MAX_PAGES = 1000` stops paging at `MAX_PAGES × pageSize` ids — 100k at the default page size of 100, which `OL_PRODUCT_SYNC_PAGE_SIZE` can change — logs `pagination may be truncated`, and then returns `{ outcome: 'ok' }`. A large catalog is silently half-replicated while the job reports as healthy.

**A thrown error is extraordinarily expensive on a scheduled path.** `maxAttempts` defaults to 10 with backoff from 30 s doubling to a 6 h cap, and the runner logs at `error` on every attempt. There is no dead-letter stream and no alerting — `dead` is a row status an operator has to go looking for. And because the scheduler mints a per-minute idempotency key (`master:{cid}:product:syncAll:{YYYY-MM-DD-HH-mm}`), a failing run is never *superseded* by the next tick; it is joined by a sibling, so repeated failure accumulates dead rows rather than converging.

**The shape we want already exists.** `destination.taxonomy.sync` ([ADR-037](./037-destination-taxonomy-read-model.md), #1979/#2061) is resumable across runs, paged, watermark-swept via `syncedAt`, serialised by a per-scope `SyncLockPort` lock, and refuses its destructive sweep unless the run *observed at least one row*. Master sync is the un-migrated legacy beside it.

What the platforms can actually support was verified against vendor documentation and issue trackers rather than assumed, and it is weaker than the framing in #2162:

| | PrestaShop | WooCommerce |
|---|---|---|
| Product-field change visible incrementally | `filter[date_upd]` exists — two maintainer-closed-without-fix reliability reports ([#12385](https://github.com/PrestaShop/PrestaShop/issues/12385), [#14606](https://github.com/PrestaShop/PrestaShop/issues/14606)), shop-local DST-shifting timestamps (confirmed in #2221: `date_upd` is written in `PS_TIMEZONE`, not UTC, on a UTC database server) | Yes — `modified_after` + `dates_are_gmt=true` (WC ≥ 5.8) |
| **Stock** change visible incrementally | **No** — a `stock_availables` write does not stamp `date_upd` ([PS #20465](https://github.com/PrestaShop/PrestaShop/issues/20465), open — reproduced on 9.0.2 in #2221), and `stock_availables` carries no date column at all | **No** for order-driven writes — `update_product_stock()` uses raw SQL that bypasses `wp_update_post()`; a REST `PUT` *does* bump it |
| Variant change bumps parent | **No** — measured on 9.0.2 (#2221): a combination write leaves the parent `date_upd` untouched, while a product-level write moves it | **No** ([WC #19562](https://github.com/woocommerce/woocommerce/issues/19562), open since 3.4), and there is no store-wide variations collection |
| Deletion feed | None — hard delete, 403/404 on read | Partial (`include_status=trash`, undocumented enum); hard delete invisible |

## Decision

**1. The ladder is adapter-declared sub-capabilities, and only rungs with an implementer are written as code.** New `products/domain/ports/capabilities/` and `inventory/domain/ports/capabilities/` directories follow the established sub-capability + `is*` guard convention already used in five other contexts. Two rungs are declared now: **modified-since** — enumerate only the ids whose record changed after a caller-supplied watermark — and the base port's **enumerate-only**. The exact signature is #2220's to settle; naming one here would freeze a contract this ADR has not reviewed. The monotonic-change-cursor and cheap-digest rungs are described here and **not written** — no in-tree master offers either, and an interface with no implementer is speculation that call sites must then defend against forever. Push is not a new rung: `inventory` and `product` are already members of `InboundEventDomainValues`, routed by `InboundRoutingPolicy` to the by-id jobs under their own capability gates.

**2. Two cadences, and only the reconciliation pass may decide a product DISAPPEARED.** A modified-since query cannot observe a deletion — the record simply stops appearing. Catalog-level staleness is therefore reserved to the full pass, under the taxonomy rule that a sweep requires the run to have observed something; without it the delta path would stale the entire catalog on its first quiet tick.

    This governs **catalog-level** disappearance only. It is NOT a change to the existing **within-product** variant prune (`markVariantsStaleExcept`, `pruneStaleVariants`), which runs inside `syncByExternalId` against the variants of one product the master just returned, and is reached from a stock/product webhook as well as from a catalog pass. That prune is sound on a delta path — the master answered for that product, so its variant set is authoritative — and must keep running, or the #1599/#1689 machinery this decision exists to protect loses its per-product half. Two prunes, two authorities: a product vanishing from the catalog is a fact only a full enumeration can establish; a variant vanishing from a product is a fact the product's own response establishes.

**3. Never `modified_since = last_run_time`.** A watermark is captured *before* the read, and the window is overlapped by a configurable lookback so that rows whose timestamp precedes their commit are re-read rather than skipped. Re-reading is free because every downstream write is idempotent. Where a master supplies its own monotonic cursor, that is preferred over any clock. WooCommerce's `dates_are_gmt` default of `false` — comparing against site-local time — is a concrete instance of the rule that a boundary you do not control must not be trusted.

**4. Budget and resumability copied from taxonomy, not reinvented.** A run enqueues within a page budget, records where it stopped in a connection cursor, and the next cron tick resumes. Runs are serialised per connection by a `SyncLockPort` lock, which on contention logs and returns incomplete rather than throwing. Explicitly rejected: enumerate-everything-then-enqueue-everything, in any form.

**5. A ceiling throws for an operator submit and budgets for a scheduled run.** #2166 asks for the `EXPANDED_OFFER_CEILING` pattern at every unbounded enqueue site. That pattern throws, which is right where a human holds the response and can act on *"split the selection into smaller batches"* — it maps to a 422. On a cron tick the same throw buys a multi-day retry burn, an error log every attempt, no alert, and one accumulating dead row per tick, while the catalog stays unreplicated. Both are ceilings; the difference is whether anyone is listening. A budgeted run additionally makes forward progress on the very catalog that tripped the bound, which a throw does not.

**6. Back-pressure shrinks the next run's budget.** A run that hits `RateLimitTimeoutError` records that observation and the next run starts smaller, with a floor. Today the opposite happens: rate-limited jobs requeue after 30 s into the same undifferentiated FIFO and re-occupy batch slots. Note the limiter has only two priorities (`background` / `interactive`) and its sole anti-starvation device is jitter — genuine lane separation is ADR-050's subject (#2167), not this one's.

**7. Inventory declares its own rungs, separately from the catalog.** Not a symmetry for its own sake: on PrestaShop stock is *structurally* invisible to a catalog watermark and has no dated resource of its own, while it *is* available as a push event; on WooCommerce simple-product stock rides `/products` but variation stock lives on a sub-resource with its own timestamp, and the WooCommerce translator handles only `order`, so no push exists there. The two platforms are weak on opposite rungs. An `InventoryMaster` that declares nothing stays reconcile-only, which is correct rather than degraded.

**Sequencing consequence for Wave 2.** The budget and cursor (decisions 4–6) help every connection on every rung today. The delta rung helps WooCommerce catalog only — not its stock, not its variations. Wave 2 should therefore land bounding-and-resuming **first** and the ladder second, which inverts the reading of #2166 that treats the ladder as the headline.

## Alternatives considered

- **Add `updatedSince` to `ProductFilters` and be done.** Rejected: it declares a capability the port cannot honour. `PrestashopProductMasterAdapter` would silently ignore it or emit `filter[date_upd]` against a resource lacking the column, and every caller would have to treat the result as untrusted anyway. The ladder exists so that "I cannot do this" is expressible.
- **Delta only, no reconciliation pass.** Rejected on evidence: deletions are invisible to modified-since by construction, so the `isStale` and offer-pause machinery (#1599/#1689) would never fire again. Every comparable system that documents its design runs delta-plus-reconcile — Shopify pairs `updated_at_min` with a delete webhook and ships an explicit full-sync-finished signal, BigCommerce connectors pair a delta feed with a deletion webhook, ChannelEngine owns a server-side cursor over a *full* feed precisely so deletes fall out of it, and BaseLinker pulls whole catalogues on a tiered cadence.
- **Throw at the fan-out ceiling, per #2166's decision 6.** Rejected — see decision 5. Retained for the operator-submit half, where it is already the right answer.
- **One ladder covering catalog and stock.** Rejected — see decision 7; the platform evidence contradicts it in both directions.
- **A durable-execution engine or a broker to own resumability.** Out of scope by the epic and rejected there; the cursor-plus-lock pattern already carries a shipped implementation in this repository.

## Consequences

**Pros:**
- A 20k-SKU connection stops enqueueing 20k jobs every 15 minutes; the buyer-facing work behind it stops waiting on a catalog sweep.
- Deletion detection becomes an explicit, named responsibility instead of an accident of full enumeration.
- A truncated run stops reporting `outcome: 'ok'`.
- Masters become honestly differentiated: an operator can be told their master supports only full enumeration, instead of the system silently grinding.

**Cons / trade-offs:**
- Two cadences are two code paths and two failure modes; the delta path is the one that will look healthy while being wrong.
- The overlap window guarantees repeated re-reads. This is only safe because the downstream writes are idempotent — a future non-idempotent write on this path breaks it silently.
- Full reconciliation still costs a whole-catalog enumeration; this ADR bounds and paces it, it does not remove it.
- Rungs left undeclared mean the strongest masters are served no better than the weakest until someone declares one.

**Reversal gates** (marked for #2169):
- *Countable*: an enqueue site fanning out without a declared budget or ceiling — structurally detectable, and at minimum an allow-list that must be edited deliberately.
- *Countable*: the number of declared ladder rungs per adapter — a third rung appearing is the signal to revisit whether the ladder should be a single negotiated capability instead.
- *Prose-only*: a master genuinely needing the digest rung; an operator's measured pain on the bottom rung.

**Amendment (#2221) — the PrestaShop verification came back negative; PrestaShop declares neither rung.** The three questions this ADR blocked the rung on were measured against a live PrestaShop 9.0.2 (the build `docker-compose.yml` pins) over the webservice, each write made through the same PHP path an operator's would take.

- **Does a combination write bump the parent's `date_upd`? No.** A `PUT /api/combinations/{id}` that demonstrably changed the combination left the parent product's `date_upd` untouched, while a `PUT /api/products/{id}` on the same product moved it — the positive control without which the negative would only have shown that the webservice never stamps `date_upd` at all.
- **What timezone is `date_upd`? The shop's `PS_TIMEZONE`, not UTC.** Rows written by PHP read `UTC+2` against a `UTC` MySQL server under `PS_TIMEZONE=Europe/Paris` in August, so the offset is applied by PHP and shifts with DST. Note this is a *three*-way mismatch, not two: `PrestashopQueryBuilder.formatDate` builds its `filter[date_upd]` bound from the **OL worker process's** local-time getters, which is a third zone again.
- **Does `filter[date_upd]` behave? Yes** on 9.0.2, and `date=1` is not required for it to apply — the builder's existing `date=1` guard is harmless but not load-bearing on this build.

The first answer alone settles it. `date_upd` covers product-level fields only, and since #822/#823 a PrestaShop combination carries first-class OL data — per-variant price, EAN, reference, weight — so a `products` delta rung would look healthy while silently skipping every variant-level change. There is no second watermark to union against: `ps_product_attribute` and `ps_stock_available` carry **no mutation timestamp of any kind** (`available_date` is a business availability date), which makes this a structural limit rather than a workaround waiting to be found. The stock finding was reproduced in the same session: a `stock_availables` write changed the quantity and left the parent's `date_upd` unmoved.

`PrestashopProductMasterAdapter` and `PrestashopInventoryMasterAdapter` therefore stay on the base enumerate-only rung, which decision 1 exists to let them say. The delta rung ships WooCommerce-catalog-only, exactly the scope decision 7 and the sequencing note predicted — and the bounding-and-resuming work (#2218/#2219, merged) is what carries PrestaShop, which is the reading of #2166 the sequencing consequence argued for.


**Amendment (#2220) — offset paging over a live modified-set drops rows, and the full pass is what covers it.** The WooCommerce delta rung enumerates with `orderby=modified&order=asc` and pages by offset. `asc` is correct for *appends* — a newly modified row lands past the cursor — but it does not survive *re-modification*: a row already read at offset *k* that is edited mid-cycle moves to the tail, shifting every later row left by one, so the row that now occupies the current offset is never read. Its `modified` precedes the run's captured watermark, so neither the next cycle's `since` nor the lookback window reaches it, and it stays unsynced.

Keyset paging (carry each row's `modified` rather than an offset) would fix it properly, but it requires the rung to return timestamps alongside ids — a different contract, premature for a rung with one implementer. The window is therefore **accepted and documented**, on one condition that is load-bearing rather than incidental: it is survivable only because #2220 leaves the full `master.product.syncAll` pass running unchanged, which re-reads the whole catalog on its own cadence.

One half of that window is closed cheaply and already is: the watermark advances to the instant the **cycle opened**, not to the clock of whichever tick completes it. A multi-tick cycle queries one fixed `since`, so stamping the completing tick would push the watermark past rows the cycle never had the chance to observe - turning a row skipped for one cycle into a row skipped permanently. Cycle-start capture therefore leaves such a row inside the next cycle's window, where the ordering usually recovers it. It is a narrowing, not a fix: a row re-modified mid-cycle still moves in the ordered set.

**That makes it a hard dependency for #2222**, the issue that may relax the full cadence once it owns the reconciliation pass. Relaxing that cadence without first moving the delta rung to keyset paging converts a bounded staleness window into unbounded, silent row loss — the failure this ADR exists to prevent, arriving through the one path that reports healthy.

**Amendment (#2222) — what "deletion authority" means, and why absence is not it.** Decision 2 reserved catalog-level deletion to the reconciliation pass. Implementing it exposed that the premise underneath was wrong in a way worth recording, because the wrong version is the one a reader will reinvent.

**Deletion was already being detected — the pause was not firing.** `master.inventory.syncAll` enumerates OL's own `identifier_mappings` (#2219) rather than the master, so a deleted product is still enumerated; its child's 404 becomes `MasterProductNotFoundError` and reaches the inventory context's deletion handler within one cadence. That path staled `inventory_items.isStale` and stopped. `StaleOfferPauseService` re-verifies `product_variants.isStale` before pausing anything, so every variant failed the check, no offer was paused, and the emitted `master.product.stale` accomplished nothing — the two halves of #1689 were reading different tables. The fix is a delegation, not a mechanism: the inventory path now routes its confirmed deletion through the products context, which owns that flag and already had the correct implementation including the #1904 rival guard.

**A catalog enumeration cannot be the deletion authority, and must never be made one.** `master.product.syncAll` reads ids *from* the master, so a deleted product simply stops appearing — it is structurally blind. The tempting fix is to diff the enumerated set against OL's mappings and stale the difference. That is unsafe here for a reason specific to the shipped adapters: neither paginates stably. `PrestashopProductMasterAdapter.listExternalIds` sends no `sort`, and `WooCommerceProductMasterAdapter.listExternalIds` sends no `orderby` (WooCommerce defaults to `date DESC`). A cycle spans many ticks at the #2218 budget, so a single mid-cycle delete shifts every later row left and one **live** product is never read. Staling on that inference zeroes a live product's offers on every marketplace through #1689 — a single-row false positive with a blast radius no "did the run observe anything?" guard catches, because the run observed plenty.

Two consequences are stated rather than left to be discovered. The pass **defaults ON** (unlike the opt-in delta rung) because it closes a live defect, so every existing `ProductMaster` install takes on new recurring platform load at deploy - roughly +14% per-product child jobs on a connection carrying both master capabilities. And **the cron is the tick, not the cycle**: a cycle spans `ceil(N / budget)` ticks, so worst-case deletion-detection latency at the defaults is about `ceil(N/100)` hours - ~40 h on a 4,000-SKU connection and over a week on a 20k-SKU one. "Deletion authority" here means *eventual and honest*, not *prompt*; a connection that also has `InventoryMaster` gets the same detection at 4x the rate from the inventory sweep.

`master.product.reconcile` therefore asks the opposite question in the opposite direction: it enumerates OL's own product mappings and re-checks each id, letting the adapter's 404 be the authority exactly as the webhook path already does. It is the inventory sweep's shape, one context over — which is why an `InventoryMaster` connection already had this coverage and a `ProductMaster`-only one did not. Because the child is the authority, the pass needs no guards of its own: an empty enumeration enqueues nothing, and a missed mapping is re-checked next cycle rather than presumed dead.

**The cadence relaxation this issue was expected to make is declined.** #2222 was to own the two-cadence policy — delta by default, full pass slowed. The #2220 amendment above makes the delta rung's offset-paging row-skip survivable *only* because the full pass runs unchanged, and that is still true: relaxing it before the rung moves to keyset paging trades a bounded staleness window for unbounded silent row loss. The full sweep keeps its cadence and the delta pass stays opt-in.

**The products/inventory prune asymmetry (this issue's AC item 5) was verified, not changed.** `MasterInventorySyncService` prunes unconditionally on an empty response while `MasterProductSyncService` declines to; the inventory service already documents this in place as intentional rather than drifted, and warns when an empty response stales rows. It stands.

## References

- Related issues: #2166 (this decision), #2162 (epic), #1979 / #2061 (the taxonomy precedent), #1599 / #1689 (the staleness machinery that depends on deletion detection), #2169 (gate enforcement)
- Related ADRs: [ADR-037](./037-destination-taxonomy-read-model.md) (resumable paged sync + watermark sweep), [ADR-007](./007-syncjob-status-vs-outcome-split.md) (status vs outcome), [ADR-038](./038-per-connection-outbound-rate-limiting.md) (priority context), [ADR-002](./002-capability-ports-with-sub-capabilities.md) (sub-capability convention); ADR-049 (#2165) and ADR-050 (#2167) are siblings in the same epic and not yet written
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Core Bounded Contexts — Products / Inventory
- External: [PS #20465](https://github.com/PrestaShop/PrestaShop/issues/20465) (stock write does not stamp `date_upd`), [WC #19562](https://github.com/woocommerce/woocommerce/issues/19562) (variation change does not bump parent), [Airbyte #9668](https://github.com/airbytehq/airbyte/issues/9668) (why `last_run_time` loses rows committed during the read)
