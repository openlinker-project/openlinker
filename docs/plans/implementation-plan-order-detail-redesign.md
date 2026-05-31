# Implementation Plan — Order-detail redesign (#924)

> Display-only redesign of `/orders/:internalOrderId`. Renders data **already on**
> the `OrderRecord` DTO + parsed `orderSnapshot` + shipments query. **No backend
> fields added** (those are the separate epics #925–#928). The approved visual
> spec is `docs/plans/order-detail-redesign-mockup.html` — its layout, token
> usage, and primitive vocabulary are the North Star.

## 1. Goal & layer

- **Layer:** Frontend only (`apps/web`). No CORE / Integration / API changes.
- **Goal:** turn the order-detail page from an "ingestion record" into an
  operator cockpit: derived health header, plain-language failure banner with a
  scoped Retry, pricing/tax breakdown, a shipping/delivery panel (pre- and
  post-dispatch), and a real audit-trail activity timeline — with clickable
  product/identity links.
- **Non-goals:** new backend fields, a reconciliation-timestamp, a real human
  actor on the audit trail, an external-marketplace listing URL, a "Re-check"
  reconcile action. All of these are out of scope and **degraded gracefully**
  (the line is hidden, not faked) per the issue's own implementation notes.

## 2. Data availability (confirmed by reading the source)

| Mockup element | Field | Source | Verdict |
|---|---|---|---|
| Order number, internal id | `orderNumber`, `internalOrderId` | snapshot / record | ✅ render |
| Source → destination route | `sourceConnectionId`, `syncStatus[].destinationConnectionId` | record | ✅ render (`ConnectionEntityLabel`) |
| Lifecycle badge ("Processing") | `snapshot.status` | snapshot | ✅ render |
| Derived health badge ("Needs attention") | derived from `syncStatus` | record | ✅ derive |
| Received + relative | `createdAt` | record | ✅ render (`TimeDisplay relative`) |
| Order-contents one-liner | `items[]`, `totals` | snapshot | ✅ render; product → `/products/{productId}` when present |
| Health row: Sync / Fulfillment / Total | `syncStatus`, shipments query, `totals` | record + query | ✅ derive |
| Failure banner cause | `syncStatus[].error` (raw string) | record | ✅ render raw; **no fabricated remedy prose** |
| Scoped Retry | `useRetryOrderDestinationMutation` | existing | ✅ reuse |
| Pricing & tax table | `items[]`, `totals.{subtotal,shipping,tax,total,currency}` | snapshot | ✅ render |
| Tax treatment badge | `totals.taxTreatment` (`'inclusive'\|'exclusive'`) | snapshot | ✅ surface via schema extension (existing BE data) |
| Ship-to / method / pickup | `shippingAddress`, `shipping.methodName`, `pickupPoint` | snapshot | ✅ render |
| Dispatch lifecycle / label / tracking | shipments query | existing `OrderShipmentPanel` | ✅ reuse (capability-gated) |
| Activity audit trail | `createdAt`, `syncAttempts[]` | record | ✅ reuse `OrderActivityTimeline` (restyled) |
| External listing ↗ | — | — | ❌ no data → **omit** |
| Reconciliation freshness + Re-check | — | — | ❌ no data + backend action → **omit** |
| Audit-trail human actor | — | — | ❌ not tracked → **"system"-derived eyebrow only** |

## 3. Design — composition

Page IA (top → bottom), matching the mockup:

1. **Header** (in-page markup): `h1` order title + derived-health `StatusBadge` +
   lifecycle `StatusBadge`; sub-row = internal-id copy chip (`CopyableId`) +
   role-labelled route + "Received … · Nm ago"; order-contents one-liner
   (thumbnail + item/unit count + product link + total).
2. **`OrderHealthSummary`** (NEW) — 3 derived cells (Sync / Fulfillment / Total),
   alarm rule on the failed cell.
3. **Failure banner** — `Alert tone="error"`, per failed destination: raw error
   as cause + scoped `Retry` + "view raw ▸" anchor to the raw snapshot.
4. **`OrderPricingPanel`** (NEW) — card composing `OrderLineItemsPanel` +
   `OrderTotalsPanel` (both reused) + tax-treatment badge + static pricing note.
5. **Detail grid** — left `stack`: Summary `KeyValueList` (Received **before**
   Updated) + Sync-status rows; right `stack`: **`OrderDeliveryPanel`** (NEW,
   snapshot-driven ship-to/method/pickup) + `OrderShipmentPanel` (reused) +
   `OrderCustomerCard` (reused).
6. **Activity** — `OrderActivityTimeline` (reused, restyled per mockup).
7. **Raw snapshot** — `RawPayloadPanel` (unchanged).

### New components (`features/orders/components/`)
- `order-health-summary.tsx` (+ `.test.tsx`) — pure; props: `syncStatus`,
  `shipmentSummary` (`'none'|'awaiting'|'dispatched'|'delivered'|'unavailable'`),
  `totals`.
- `order-pricing-panel.tsx` (+ `.test.tsx`) — props: `items`, `totals`.
- `order-delivery-panel.tsx` (+ `.test.tsx`) — props: `shippingAddress?`,
  `shipping?`, `pickupPoint?`, `shippingPlatformType?` (for the pickup caption).

### Touched files
- `pages/orders/order-detail-page.tsx` — layout rework + header markup.
- `pages/orders/order-detail-page.test.tsx` — extend for the new sections;
  update the failure-banner assertions to the redesigned banner (keep a
  failed-destination signal + a Retry affordance).
- `features/orders/components/order-activity-timeline.tsx` — restyle + "system"
  eyebrow + "Showing N of N · capped at 20" caption.
- `features/orders/api/order-snapshot.schema.ts` — add optional `taxTreatment`
  to `orderTotalsSchema` (+ extend `order-snapshot.schema.test.ts`).
- `index.css` — new bounded section `/* ── Order detail redesign (#924) ── */`
  (tokens already match the mockup verbatim). Then mirror any new var into
  `shared/theme/tokens.ts` (none expected — mockup reuses existing tokens).

## 4. Standards & risks

- Vanilla CSS + existing OKLCH tokens only; BEM-flat class names; `tone` props;
  mono+tabular on ids/numerics; `aria-hidden` on dots; color never the only signal.
- No raw API calls in the page; server state via existing query hooks.
- Reuse-before-create honoured: 3 new components are genuinely novel
  (health/pricing/delivery); everything else is reused.
- Risk: existing failure-banner test couples to old copy — updated deliberately.
- Risk: apps/web full-suite flakiness — retry, never `--no-verify`.

## 5. Quality gate
`pnpm lint && pnpm type-check && pnpm test` green (light + dark visually spot-checked).

## 6. Tech-review refinements applied

- **View-model derivations → `features/orders/lib/order-health.ts`** (pure, unit-tested):
  `rollupSyncStatus`, `deriveHealthLevel` / `healthLabel`, `syncCellLabel`,
  `deriveFulfillment` / `fulfillmentLabel`. The page stays composition-only; the
  header derivations move into `order-detail-header.tsx`.
- **Pickup caption keys on the SOURCE platform** (`usePlatform(sourcePlatformType)`,
  called unconditionally) per #893 — the buyer-selects the locker on the source
  marketplace, not the destination/shipping connection.
- **Tax wording is treatment-aware**: `inclusive → gross`, `exclusive → net`;
  the badge + note never hardcode "gross". Schema enum mirrors core
  `PriceTaxTreatmentValues` with a keep-in-sync comment (FE-001 contract strategy).
- **Mobile-first breakpoints** (768 / 1024 `min-width`), not the mockup's
  desktop-first `max-width: 860`. Detail grid: single-column → 65/35 at ≥1024;
  health strip: 1-col → 3-col at ≥768.
- **Query degradation**: the Fulfillment cell consumes `useOrderShipmentsQuery` +
  `useConnectionsQuery` via their barrels and degrades to `unavailable` on
  loading/error; existing page tests pass against the mock client's default
  shipments/connections namespaces.
- Scoped **Retry lives only in the failure banner** (single source of truth) —
  the sync-status rows are status-only, so there's no double Retry button.
- File-header comments on every new file; neutral source/destination route
  labels (no `platformType` literal-equality); activity caption derived from
  real `events.length`.
