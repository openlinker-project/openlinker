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
| Product-field change visible incrementally | `filter[date_upd]` exists — two maintainer-closed-without-fix reliability reports ([#12385](https://github.com/PrestaShop/PrestaShop/issues/12385), [#14606](https://github.com/PrestaShop/PrestaShop/issues/14606)), shop-local DST-shifting timestamps | Yes — `modified_after` + `dates_are_gmt=true` (WC ≥ 5.8) |
| **Stock** change visible incrementally | **No** — a `stock_availables` write does not stamp `date_upd` ([PS #20465](https://github.com/PrestaShop/PrestaShop/issues/20465), verified, open), and `stock_availables` carries no date column at all | **No** for order-driven writes — `update_product_stock()` uses raw SQL that bypasses `wp_update_post()`; a REST `PUT` *does* bump it |
| Variant change bumps parent | Unverified; assume no | **No** ([WC #19562](https://github.com/woocommerce/woocommerce/issues/19562), open since 3.4), and there is no store-wide variations collection |
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

**Requires empirical verification before the PrestaShop adapter declares the modified-since rung** (all three unconfirmed in vendor documentation): whether a combination write propagates to the parent product's `date_upd`; the storage timezone of `date_upd`; and whether `filter[date_upd]` behaves on the 1.7/8 builds OL targets. Declaring the rung on an unverified filter would produce exactly the failure mode this ADR is written to avoid — a delta path that looks healthy and quietly skips records.

## References

- Related issues: #2166 (this decision), #2162 (epic), #1979 / #2061 (the taxonomy precedent), #1599 / #1689 (the staleness machinery that depends on deletion detection), #2169 (gate enforcement)
- Related ADRs: [ADR-037](./037-destination-taxonomy-read-model.md) (resumable paged sync + watermark sweep), [ADR-007](./007-syncjob-status-vs-outcome-split.md) (status vs outcome), [ADR-038](./038-per-connection-outbound-rate-limiting.md) (priority context), [ADR-002](./002-capability-ports-with-sub-capabilities.md) (sub-capability convention); ADR-049 (#2165) and ADR-050 (#2167) are siblings in the same epic and not yet written
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Core Bounded Contexts — Products / Inventory
- External: [PS #20465](https://github.com/PrestaShop/PrestaShop/issues/20465) (stock write does not stamp `date_upd`), [WC #19562](https://github.com/woocommerce/woocommerce/issues/19562) (variation change does not bump parent), [Airbyte #9668](https://github.com/airbytehq/airbyte/issues/9668) (why `last_run_time` loses rows committed during the read)
