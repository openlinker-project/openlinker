# Subiekt GT Integration — Production Readiness Audit (2026-09-21)

Methodology: 5 independent domain agents (orders/fulfillment, invoicing/fiscalization/routing,
catalog/inventory, analytics/currency/cross-cutting, UI/frontend/docs) audited the Subiekt GT
integration end to end against the live `ol-demo-fresh` stack, followed by 5 independent
confirming agents re-deriving every claim from first principles (fresh code reads + fresh live
queries, not rubber-stamping). **Zero disagreements across all 10 agents.** Two claims were
sharpened during confirmation (found to be worse than first reported); one was nuanced with an
additional mitigating fact.

Status legend: ❌ Bug found · ⚠️ Implemented, not fully live-tested · ✅ Verified working ·
➖ N/A by design · 🚫 Not implemented (known gap).

## 🔴 Blockers — must fix before production

| # | Path | Status | Issue |
|---|---|---|---|
| B1 | ZK creation — shipping cost | ❌ | `resolveLines()` never reads `order.totals.shipping`. Confirmed on both sides of the wire (OL adapter + bridge C#). Every Subiekt ZK silently under-records order value by the shipping amount. |
| B2 | Inventory sync — retry classifier | ❌ | `SubiektInventoryBridgeClient` has zero retryability logic — every transient network blip kills the job on attempt 1 (`attempts=0`), bypassing the 10-attempt ladder. Live-reproduced: 41/43 jobs died in a 2-min window during a bridge restart. ProductMaster is unaffected (different client) — but its own private transport has the identical defect, unexercised only by luck. |
| B3 | Order status write-back | ❌ | `OrderFulfillmentUpdater` implemented but structurally unreachable — the only production caller (`OrderLifecycleRelayService`) resolves exclusively via `OrderStatusWriteback`, which Subiekt doesn't implement. |
| B4 | New-connection capability default | ❌ | **Regression from this session's own work.** Adding `Fiscalization` to the manifest made a pre-existing capability-stripping rule (built for eparagony) fire for Subiekt too. Live-reproduced: a wizard-created connection comes out with `Invoicing` silently absent. |
| B5 | KSeF regulatory status | ❌ | Bridge hardcodes GT status 1/2/8 → `"pending"` → TS maps to `submitted`, even though core already ships a `pending-submission` status built for exactly this. Live-confirmed: OL says `submitted`, KSeF/GT says "not sent". |
| B6 | `clearanceReference` | ❌ | Bridge SQL for both issue and status-read never selects `dok_NumerKSeF`. Every Subiekt invoice has `clearanceReference: null` forever, though the KSeF number exists in GT one query away. |
| B7 | EAN/barcode sync | ❌ | Bridge's barcode read queries an empty collection table (`tw_KodKreskowy`, 0 rows) instead of the real default-barcode column (`tw__Towar.tw_PodstKodKresk`, real EAN-13s). Barcode category auto-match can never fire for Subiekt products. |
| B8 | Doc set | ❌ | All 5 doc files describe **Subiekt nexo + .NET Sfera SDK** — a different, incompatible product. Zero mentions of GT/InsERT.GT/COM automation anywhere. |
| B9 | FE branding | ❌ | 4 FE surfaces say "Subiekt nexo" (2 hardcoded, 2 derived from the same plugin-registry entry) — only `/adapters` reads live and shows the corrected name. |
| B10 | `upsertProductVariant` | ❌ | Silent no-op — ignores the write, returns stale data as if it succeeded. Currently unreachable (no production callers for any adapter), latent not active. |

## 🟡 Known gaps

| # | Path | Status | Notes |
|---|---|---|---|
| G1 | Correction (KSeF) | 🚫 | Real Polish fiscal rule — can't correct an un-transmitted invoice. Root cause is B5; fixing B5 doesn't unblock this (still needs a real transmission). No code fix — this is correct platform behaviour. |
| G2 | Net Sales / VAT-exclusive analytics | ❌ | 100% of Subiekt revenue excluded. Root cause: no `ProductTaxRateReader` on Subiekt's ProductMaster adapter. A channel-level fallback (`taxSource:'channel'`) exists independently and is live elsewhere in this DB, but is orthogonal to this fix. |
| G3 | Alerting / bridge-outage visibility | 🚫 | No alerting infrastructure exists anywhere in the product, not Subiekt-specific. `/v1/health/dev-stack` correctly detects an outage but nothing polls it on schedule. Subiekt additionally has no `AuthFailureClassifier`. |
| G4 | Shipment dispatch → marketplace notify | ⚠️→ reclassified | Real InPost label bought end-to-end. Dispatch step simply never clicked during the earlier test — **not a bug**. Auto-triggering dispatch is a documented, deliberate architectural deferral (#2729: no data to derive parcel weight/dimensions from). Becomes a verification step (click Dispatch) in the E2E retest, not an implementation task. |
| G5 | `createProduct` | 🚫 | Confirmed dead code repo-wide (no orchestrated caller for any adapter). Honest stub, zero risk. No action needed. |
| G6 | Subiekt's own `OrderSource` (native order ingestion) | ❌ | 19/19 jobs dead — `Missing mapping for order item productRef`. Poisons `analytics-trust` (`stalled` forever). Root-cause fix requested by user. |
| G7 | `reporting_currency_setting` duplicate row | ❌ (cosmetic) | Orphaned `id='default'` row, dead data, code only reads `id='singleton'`. Cleanup only. |
| G8 | PL sales-document routing (Subiekt as country-wide default) | ⚠️ | Current demo-stack config only — confirmed no seed/migration path lets this reach a fresh prod deploy. No code change; just don't treat this stack's config as a reference example. |

## 🟢 Fully verified working

- Product sync (`ProductMaster` read, list, pagination) — ✅ live
- Inventory sync (`InventoryMaster` read, per-warehouse sum) — ✅ live
- Order creation → ZK (happy path, minus shipping — B1) — ✅ live
- Auto-invoicing → FS + PA documents — ✅ live
- ADR-041 one-document-per-order guard — ✅ code-traced, connection-agnostic
- Connection test button — ✅ live
- Catalog-trust panel — ✅ live
- Sync-status panel (queue/drain telemetry) — ✅ live
- FX/currency stamping (PLN identity path) — ✅ live, all 4 test orders
- `OL_TAX_RATE_STRICT_ENABLED` correctly OFF — ✅ verified both containers
- Order-detail sync-status + invoice panel rendering — ✅ live
- Deprecated `reserveInventory`/`releaseInventory` (correctly stubbed per ADR-061) — ✅ code review
- Rate limiting (falls back to manifest default) — ✅ code review
- Webhooks — ➖ correctly absent, bridge is polling-only by design

## Fix log (filled in during implementation)

Updated per item as each phase lands — see the linked epic + child issues for PR references.

| Item | Status | PR / commit | Verified how |
|---|---|---|---|
| B1 | fixed | 006ed156d (TS) + bridge Sfera.cs/OrdersEndpoints.cs | type-check+unit tests green; E2E retest pending |
| B2 | fixed | 0a55ad8c2 | type-check+unit tests green; E2E bridge-restart retest pending |
| B3 | fixed | 006ed156d | type-check+unit tests green; E2E retest pending |
| B4 | fixed | 3cb820b0d | live-reproduced bug, fix type-checks; new-connection E2E retest pending |
| B5 | fixed | b51cdd186 (bridge Invoicing.cs/Program.cs + TS mapper) | GT's 9-value StatusKSeF now correctly splits not-yet-sent (1,2)/comms-error (8) into `'pending-submission'` instead of a premature `'submitted'`; type-check+unit tests green; E2E retest pending |
| B6 | fixed | b51cdd186 | `KsefNumer` now extracted+threaded through issue/status bridge responses into `clearanceReference`; type-check+unit tests green; E2E retest pending |
| B7 | fixed | bridge ProductsEndpoints.cs | code fix only; E2E barcode-read retest pending |
| B8 | pending | | |
| B9 | fixed | 3cb820b0d | all "Subiekt nexo" strings + test assertion updated, web tests green |
| B10 | fixed | 006ed156d | unit test added and green |
| G2 | fixed | 6f2332fbd (bridge ProductsEndpoints.cs + TS `ProductTaxRateReader`) | live-confirmed VAT column `tw_IdVatSp`→`sl_StawkaVAT`; type-check+unit tests green; Net Sales retest pending |
| G3 | fixed | this commit — `SubiektAuthFailureClassifierAdapter` + `subiekt.bridge.reachabilitySweep` job/handler/scheduler task | no external alert channel exists in the product (none built, by design — see epic body); reachability now produces a structured `subiekt_bridge_reachability_sweep_failed` log line every 5 min + flips the connection via the auth-failure classifier on a 401/403; type-check+unit tests green (worker: 58 suites/765 tests; subiekt: 21 suites/278 tests); deliberate-outage E2E retest pending |
| G6 | fixed | c4b7a622e | root-caused: native `SubiektOrderSourceAdapter` reported `productRef.type:'sku'` but `ProductMaster` sync only ever creates `CORE_ENTITY_TYPE.Product` mappings keyed by symbol — corrected to `'product'`; type-check+unit tests green; E2E retest pending |
| G7 | fixed | DB cleanup (raw SQL) | orphaned reporting_currency_setting row + throwaway audit connection deleted |
