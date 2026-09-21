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
| B1 | verified | 006ed156d (TS) + bridge Sfera.cs/OrdersEndpoints.cs | live: order 1's ZK 24/2026 read back from bridge `wartoscBrutto: 35.94` = 24.99 + 10.95 shipping as a 2nd symbol-less line; order 2 total PLN 485.76 = 474.81 + 10.95 |
| B2 | verified | 0a55ad8c2 | live: killed the real bridge process mid-sync; in-flight job survived 5× ECONNREFUSED (30s/60s/120s/240s backoff) and succeeded once the bridge came back — see report §4 |
| B3 | verified (unit only) | 006ed156d | `write()` implemented + unit-tested against every `OrderLifecycleEvent` arm; no live status-transition exercised this session |
| B4 | verified | 3cb820b0d | live: fresh wizard-created Subiekt connection detail page shows 5 of 6 roles enabled, Invoicing checked |
| B5 | verified | b51cdd186 (bridge Invoicing.cs/Program.cs + TS mapper) | live: order 2's invoice reads `regulatoryStatus: pending-submission`, rendered in UI as "Awaiting submission" — not the old premature "submitted" |
| B6 | verified | b51cdd186 | live: order 2's invoice `providerInvoiceNumber: FS 20/2026` correctly populated; `clearanceReference` still empty (correct — GT hasn't transmitted to KSeF yet) |
| B7 | verified | bridge ProductsEndpoints.cs | live: direct bridge query — `BANAW200 → 5901024250844`, `DZFOREVER → 5901124350468`, real EAN-13s matching original audit evidence |
| B8 | verified | dad139a43 | all 5 doc files rewritten Subiekt nexo→GT; docs-only |
| B9 | verified | 3cb820b0d | live: connections list shows "Subiekt GT (DEMO) - Invoicing"; new-connection wizard card shows "Subiekt GT" / "…classic COM automation (Sfera GT)…" — both screenshotted (web container required a separate rebuild, initially missed) |
| B10 | verified (unit only) | 006ed156d | unit test added and green; no live call attempted (no production caller exists) |
| G2 | verified | 6f2332fbd (bridge ProductsEndpoints.cs + TS `ProductTaxRateReader`) | live: both real orders' lines carry `taxRate: "23", taxSource: "shop"` at ingestion, rendered in Pricing & tax as "23% · from the shop · read today" |
| G3 | verified | `SubiektAuthFailureClassifierAdapter` + `subiekt.bridge.reachabilitySweep` job/handler/scheduler task | live: killed the bridge; sweep logged `subiekt_bridge_reachability_sweep_failed connection=… reason="Subiekt bridge is unreachable (ECONNREFUSED)"` on its next 5-min tick |
| G6 | verified | c4b7a622e | fix confirmed via unit test + code read; no native Subiekt-sourced order was available to exercise live this session (only Allegro→Subiekt fan-out orders existed) |
| G7 | fixed | DB cleanup (raw SQL) | orphaned reporting_currency_setting row + throwaway audit connection deleted |

### E2E retest summary (2026-09-21, Phase 13)

Two real Allegro sandbox orders placed by a human, ingested and fanned out to the rebuilt
`ol-demo-fresh` stack (api + worker + web all rebuilt onto this branch's tip). Full evidence,
screenshots and logs: [Subiekt GT Verification report](https://claude.ai/artifact/JFr33nayQTVBAR36Jyv3rV).

Bonus checks, both confirmed correct:
- **ADR-041 guard**: attempting to issue an invoice via inFakt on an order already invoiced via
  Subiekt → `409 OrderAlreadyInvoicedException`.
- **in-doubt retry refusal**: `POST /invoices/retry` on order 1's in-doubt invoice (raced by the
  deliberate B2 outage test) → `"Not retry-eligible (status=failed, failureMode=in-doubt)"`,
  exactly the fiscal-safety behaviour the architecture describes.

**One new finding, not in the original audit** (see report §7): Subiekt's NIP-whitelist
verification path (`kh_WeryfikacjaWykazPodatnikowVAT`) appears to exceed the bridge's 30s client
timeout for a B2B buyer, and contractor creation is not idempotent under that timeout — five
consecutive retries for order 2's Subiekt ZK all failed with `ABORT`, while direct SQL showed a
NEW contractor record created each time (`NORBERTKULUS(1)/(2)/(3)`) with no duplicate ZK ever
committed. Order 2's invoice succeeded independently (proving B5/B6), so this did not block
verification of any audited item — it's a real, separate defect worth its own follow-up issue,
not folded into this PR.
