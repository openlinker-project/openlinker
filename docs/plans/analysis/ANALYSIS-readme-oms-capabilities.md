# ANALYSIS - README OMS capability inventory (#3842)

The evidence behind the README rewrite in #3842. Every row was checked against
`origin/main` at `d92782c95` (release 0.17.0), then re-checked by a second,
independent pass that tried to falsify it. "Live" means an operator on a default
install can reach it through the UI or the API, it has a production caller, and it
is not bound to a placeholder.

Status vocabulary: **live** / **partial** (limit named) / **opt-in** (switch named) /
**planned** (issue named) / **design-only** / **not present**.

## 1. Terminology

The README never used the word OMS. Industry definitions of an OMS or a distributed
OMS (order capture, central order record, inventory visibility and ATP, sourcing and
routing, fulfilment orchestration, returns, holds, a customer-service view) assume a
multi-node network. Peers in this market (BaseLinker, Linnworks, ChannelEngine,
Pipe17) lead with "multichannel management" or "order operations", not "OMS".

Decision: describe OpenLinker as a self-hosted **order orchestration platform with
an optional built-in OMS module**. Do not headline "OMS" alone, and do not use
"distributed order management". The wording must not imply a WMS, multi-warehouse
stock, refund execution, a tax engine, an ERP, or that every install owns the order.

## 2. OMS areas on main

| Area | Operator value | Status | Evidence | How enabled / limit |
|---|---|---|---|---|
| OMS module | OpenLinker owns and routes the order instead of only mirroring it | opt-in | `libs/oms/src/oms.plugin.ts`; `libs/oms/src/routing/oms-fulfillment-router.resolver.ts` | `/settings/packing` wizard creates the `openlinker` connection and the sourcing and executor claims. The route is always on but is not a Settings tile: it is reached from the connection detail page and the OMS setup card. No migration seeds the connection (ADR-055). |
| Order of record (#3483) | With the OMS on and OpenLinker executing the work, the order is not created in the product master; the master only gets a stock decrement | opt-in | `libs/core/src/orders/application/services/order-ingestion.service.ts`; `libs/core/src/inventory/application/services/inventory-sale-decrement.service.ts` | Master-sourced, marketplace-shipped and pre-switch orders keep the mirror path. An unroutable order is held in OpenLinker (#3485). An ambiguous claim or a fail-open still mirrors. |
| Routing, sourcing rules, dry run | Decide which location fulfils an order | partial | `apps/api/src/oms/http/oms-sourcing-rules.controller.ts`; `oms-routing-dry-run.controller.ts`; `libs/oms/src/routing/ol-fulfillment-router.ts` (`loadStock` skips pooled rows) | API always on. UI only with build flag `VITE_OL_OMS_ROUTING_UI_ENABLED=true` (default off); the flag also hides the locations page and tile, the routing-readiness panel, the stock-location override and part of the onboarding step. No dry-run UI component exists. Without a located position the router assigns nothing. |
| Fulfilment work and executor | A routed order becomes packing work, offered to its holder | opt-in | `apps/worker/src/sync/handlers/fulfillment-work-dispatch.handler.ts`; `libs/oms/src/execution/ol-fulfillment-executor.adapter.ts` | The OL executor auto-accepts. |
| Sweeps (timeout, relay, reroute) | Stuck dispatches, relays and held orders recovered | live | `apps/worker/src/scheduler/scheduler.service.ts` | Default on; inert without fulfilment work. |
| Who decides what | See and set which system decides each authority | live | `apps/web/src/app/routes/who-decides.route.tsx`; `apps/api/src/fulfillment-authority/http/fulfillment-authority.controller.ts` | Ungated Settings tile; applying a preset is admin-only. |
| Pack bench | Packer scans and closes parcels | live | `apps/web/src/app/routes/bench.route.tsx`; `apps/api/src/bench/http/` | Route always on; the nav entry appears once a connection claims sourcing. Fed only by OMS routing. |
| Assign packing work | Supervisor assigns parcels | live | `apps/web/src/app/routes/fulfillment.route.tsx`; `apps/api/src/fulfillment/http/fulfillment-work.controller.ts` | Same nav gate as the bench. `/fulfillment/assign` is only a redirect. Assignment is advisory (ADR-074). |
| Fulfilment progress | Closing a parcel records it shipped | partial | `apps/api/src/fulfillment/application/services/fulfillment-parcel-closure-notifier.service.ts` | Only `shipped`, only from OpenLinker itself; no external executor progress is ingested. |
| Lifecycle phase | Order detail shows the derived phase | live | `apps/web/src/features/orders/components/order-detail-header.tsx` | Display only. |
| Order holds | Place and release a hold | live | `apps/api/src/orders/http/orders.controller.ts`; `order-hold-panel.tsx` | Admin only. |
| Returns operator flow | Record, authorize, match an orphan, receive, restock or scrap, mark not returned, draft credit note | live | `apps/api/src/returns/http/return-writes.controller.ts`; `apps/web/src/features/returns/` | Every action has a UI. |
| Returns intake | Allegro returns pulled in | opt-in | `libs/integrations/allegro/src/infrastructure/scheduler/allegro-scheduler-tasks.ts` | `OL_ALLEGRO_RETURNS_POLL_SCHEDULER_ENABLED` and `OL_ALLEGRO_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED`, both default off; the Allegro endpoint is beta. Allegro is the only `ReturnSourceReader`. |
| Refunds | Record a refund made on the channel | live (record only) | `return-money-panel.tsx` on the return detail page; `return-writes.controller.ts` | OpenLinker never moves money; no adapter implements `RefundExecutor`. |
| Restock to master | Restocked units written back | partial | `adjustInventory` in the PrestaShop, WooCommerce, Subiekt GT and Shoper inventory adapters | Shoper refuses when the shop has warehouses enabled. Restock is one of three callers (with the sale decrement and its reversal). |
| Reservations and ATP | Promised stock subtracted from published stock | partial | `order-ingestion.service.ts`; `reservation-ledger.reader.ts`; `availability.service.ts` | `OL_RESERVATIONS_ENABLED` default on. Subtracts only for OMS-routed orders or a dispatch rule resolving `ol_managed_carrier` / `source_brokered`; marketplace-shipped orders are always diagnostic (#3636). Expiry releases nothing (`UnavailableOrderHoldReader` is still bound). |
| Multi-location / multi-warehouse | - | design-only | PrestaShop, WooCommerce and Shoper report no location; Subiekt GT reads stock per magazyn but deliberately does not emit `locationId` | One warehouse in practice. A WMS is design-only. |
| Automation rules | "When X, do Y" | partial | `libs/core/src/automation/domain/types/automation-action-availability.types.ts`; `automation-action-executor.registry.ts` | UI at `/automations`. Only `order.packed` and `order.dispatch_deadline_near` are emitted. `relay-status-to-source` runs; `send-email` runs only in the API process; `issue-sales-document`, `dispatch-shipment`, `place-hold` and `release-hold` are unavailable. The hold actions' reason text ("holds are not built yet") is stale: holds exist. |
| Roles | admin, operator, viewer, packer | live | `libs/core/src/users/domain/types/role.types.ts`; `apps/api/src/auth/route-authorization-coverage.spec.ts` | Deny-by-default route authorization; admin user management. |
| Analytics | Sales, channels, top products, coverage | live | `apps/api/src/analytics/http/sales-analytics.controller.ts` | Dashboard is the home page; `/analytics` redirects. |
| Price changes | Per-connection markup or margin rule, price-change review | live | `apps/api/src/listings/http/price-changes.controller.ts` | Price-sync mode defaults to `manual`. No dynamic repricing. |

## 3. README scorecard corrections

Rows that were wrong on main: bulk quantity batch-update (Allegro implements
`OfferQuantityBatchUpdater`), refunds and returns, multi-user roles, workflow
automation, analytics, repricing (a static rule exists). Text that was wrong:
"31 sub-capabilities" (31 is the listings count alone), "28 explicit subpaths"
(`libs/core/package.json` exports 54), PrestaShop "returns" (no return capability),
Subiekt nexo as the first `InvoicingPort` adapter (it was Subiekt GT, #753), and
the capabilities table omitting Subiekt GT (orders, catalogue) and WooCommerce
(offers, stock write-back only). Rows confirmed still true: multi-location stays on
the roadmap, accounting export and payment providers stay out of scope.

## 4. Capability counts

`libs/core` holds 70 non-spec `*.capability.ts` files; `libs/oms` holds one more
(`DraftRuleEvaluator`). `docs/capabilities.md` documented 52; the 18 missing ones are
added by #3842. The README no longer states a number.

## 5. Work in flight that the README describes

The README PR merges only after these, because it describes what they ship.

| PRs | What changes |
|---|---|
| #3817-#3828 | Refund ceiling; buyer checkout note with bench acknowledgement; cancel from OpenLinker (Allegro, PrestaShop, WooCommerce and Subiekt GT are told, Shoper is not, Erli gets stock back only); post-import edit and discount kept inside OpenLinker; bulk actions up to 100 orders. Admin-only, and deliberately not gated on the OMS. |
| #3836, #3837, #3841 | Routing-decision reaper (TTL), re-route on stock change and operator retry, routing-decision panel. OMS-only; the routing build flag is unchanged. |
| #3831-#3834 | KSeF invoice PDF with KOD I (no KOD II); automatic invoice upload to the Allegro order (PDF only, so KSeF and inFakt; bulk-issued and older invoices are not sent). Adds `OrderBillingDocumentUploader`, so the capability counts move again. |
| #3786 | Bench label purchase when automatic labels are off; refusal list and preview API. Automatic labels stay opt-in per connection. |
| #3671 | The #3483 posture wording in the architecture docs. |

In-progress issues with no code (#3586-#3591: per-variant images, cost price and
margin, CSV export) appear in the README only as "Planned".

## 6. Claims the README must not make

- That routing works out of the box, or that its screens are visible without the build flag.
- That OpenLinker refunds or moves money.
- That a cancel or an edit reaches every channel or the shop mirror.
- That stock is split per warehouse, or that OpenLinker is a WMS.
- That automation can issue a document, buy a label, or place or release a hold.
- That marketplace returns flow in by default.
