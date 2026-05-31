# Implementation Plan — Order payment status + label-generation gate (#928)

Part of epic #925. **P0, independent.** "You don't ship an unpaid order" — capture payment
status from the source, thread it end-to-end, surface it as a chip, and gate the
Generate-label CTA on it.

## 1. Understand the task

**Goal.** Capture a neutral **payment status** from the order source (Allegro checkout-form),
thread it `IncomingOrder → snapshot → OrderRecordResponseDto → FE`, render a payment chip on
the order, and **disable Generate-label when payment status doesn't permit dispatch**
(awaiting/refunded block; paid/COD allow).

**Layers.** CORE (new union type + contract field + snapshot threading) · Integration (Allegro
adapter mapping; PrestaShop degrades gracefully) · Interface (DTO is `Record<string,unknown>`
passthrough — no change needed) · Frontend (snapshot parse + chip + CTA gate).

**Non-goals.**
- No new DB column / migration — `orderSnapshot` is `jsonb` (`Record<string, unknown>`); payment
  status rides inside it. (#928 says "thread through snapshot", not "new column".)
- No PrestaShop payment capture — PS order-source doesn't expose it; the field stays `undefined`
  and the FE/gate degrade gracefully. (Out of scope; logged.)
- No refund detection from a separate Allegro endpoint — checkout-form doesn't carry a refund
  signal; `refunded` is in the union for completeness but Allegro won't emit it in v1.
- No change to order `status` semantics (`pending`/`processing`/…) — payment status is a
  **separate, orthogonal** axis, mirroring how fulfillment status is separate.

## 2. Research (verified findings)

**Allegro checkout-form payment shape** (verified in-code + against developer.allegro.pl):
- `AllegroCheckoutForm.payment: { type: string; provider?: string; finishedAt?: string; paidAmount?: { amount; currency } }`
  — `libs/integrations/allegro/src/domain/types/allegro-api.types.ts`.
- `payment.type` value set: `ONLINE | CASH_ON_DELIVERY | BANK_TRANSFER | INSTALLMENTS | WALLET | SPLIT_PAYMENT` (`allegro-payment-type.types.ts`).
- **Critical subtlety (verified on developer.allegro.pl news):** `payment.finishedAt` is now set
  for **COD orders too** (it marks form submission, not payment receipt); for COD `paidAmount`
  is `null`. So `finishedAt`-alone (the adapter's current `status` logic, line 240) does **not**
  distinguish COD from prepaid. The payment-status discriminator must key off `payment.type`.
- Adapter today: `allegro-order-source.adapter.ts:240` `status = payment.finishedAt ? 'processing' : 'pending'` — order status only; no payment field on `IncomingOrder`.

**Contract pipeline** (verified):
- `IncomingOrder` — `libs/core/src/orders/domain/types/incoming-order.types.ts` (no payment field).
- Snapshot built twice in `order-record.service.ts`: `persistIncomingSnapshot` (raw, ~106-154)
  and `persistOrder` (unified, ~44-104). The **unified** `Order` type
  (`order.types.ts:81-116`) is what the FE reads via `orderSnapshot`. `buildUnifiedOrder`
  (`order-ingestion.service.ts:339-360`) maps `IncomingOrder → Order`.
- `OrderRecordResponseDto.orderSnapshot: Record<string, unknown>` — opaque passthrough, **no DTO
  change required**.
- Union-type precedent: `FulfillmentStatusValues` (`as const` + derived union + `FULFILLMENT_STATUS` const map) — `fulfillment-status-snapshot.types.ts:36-43`. Mirror this exactly.

**Frontend** (verified):
- Snapshot parsed by `parseOrderSnapshot` → `ParsedOrderSnapshot` (`features/orders/api/order-snapshot.schema.ts:87-251`).
- Generate-label gating lives in `features/orders/components/shipment-action-buttons.tsx` (`CAN_GENERATE` set keyed on shipment status, ~33-115). **Today it does NOT gate on payment** — #928 adds that.
- `StatusBadge` tones: `error | info | neutral | review | success | warning` (`shared/ui/status-badge.tsx`). Order chips precedent: `order-detail-header.tsx:31-60`.

## 3. Design

### Neutral payment-status union (CORE)
New file `libs/core/src/orders/domain/types/payment-status.types.ts` (mirrors fulfillment-status precedent):
```ts
export const PaymentStatusValues = ['paid', 'cod', 'awaiting', 'refunded'] as const;
export type PaymentStatus = (typeof PaymentStatusValues)[number];
export const PAYMENT_STATUS = {
  Paid: 'paid', Cod: 'cod', Awaiting: 'awaiting', Refunded: 'refunded',
} as const satisfies Record<'Paid' | 'Cod' | 'Awaiting' | 'Refunded', PaymentStatus>;
```
Exported from the orders barrel.

### Contract field
- `IncomingOrder.paymentStatus?: PaymentStatus` (optional — PS leaves it `undefined`).
- `Order.paymentStatus?: PaymentStatus` (unified type → lands in the snapshot the FE reads).
- `buildUnifiedOrder` passes `incoming.paymentStatus` straight through.
- **`persistOrder` builds the FE-facing snapshot by EXPLICIT key enumeration (not a spread)** —
  `paymentStatus` MUST be added to that snapshot literal or it silently never reaches the FE
  (tech-review IMPORTANT). Add it to `persistIncomingSnapshot`'s snapshot literal too (the early
  awaiting_mapping record). Unit assertion names `persistOrder` specifically.

### Allegro derivation (tech-review)
The COD/paid/awaiting derivation is the highest-risk logic — extract it as a **named exported
pure function in the Allegro package**, co-located with the adapter and unit-tested in isolation
(mirrors the #923 `toPrestashopProductAttributeId` precedent):
`deriveAllegroPaymentStatus(payment): PaymentStatus`. The neutral `PaymentStatus` union stays in
CORE; the `CASH_ON_DELIVERY` string and `finishedAt` logic stay in the Allegro package — no
Allegro-specific value leaks into CORE.

### DTO (tech-review — deliberate gap)
`OrderRecordResponseDto.orderSnapshot` stays `Record<string, unknown>` passthrough — **no DTO
change**. This is a deliberate, documented gap: every other snapshot sub-field (status, totals,
items) is already untyped passthrough, so threading a typed `paymentStatus` Swagger enum into the
DTO would be an inconsistent one-off. The `@ApiProperty({ enum: PaymentStatusValues })`
discoverability is deferred with the broader snapshot-typing effort.

### Allegro mapping (Integration)
Add a pure helper in the adapter (or a small co-located mapper fn) deriving payment status from
`payment`:
```
type === 'CASH_ON_DELIVERY'            → 'cod'
finishedAt present (non-COD)           → 'paid'
otherwise                              → 'awaiting'
```
(`refunded` not derivable from checkout-form → never emitted by Allegro v1.) Set
`paymentStatus` on the returned `IncomingOrder`. Leave the existing `status` line untouched
(orthogonal axis).

### PrestaShop
No change — `paymentStatus` stays `undefined`; contract is optional so it degrades.

### Frontend
- `ParsedOrderSnapshot.paymentStatus?: PaymentStatus` + parse it in `parseOrderSnapshot`
  (validate against the value set; unknown → undefined + parseWarning, matching existing parse style).
- **Payment chip** on the order detail header/summary: tone map
  `paid→success, cod→info, awaiting→warning, refunded→neutral`; always render text (never color-only).
  Omit the chip when `undefined` (graceful).
- **Gate**: extend `shipment-action-buttons.tsx` so `canGenerate` also requires payment to permit
  dispatch. **Polarity = block-list, not allow-list** (tech-review): block iff
  `paymentStatus === 'awaiting' || paymentStatus === 'refunded'`; everything else (`paid`, `cod`,
  `undefined`, and any future union member) does NOT block until the FE consciously handles it.
  When blocked, disable with an explanatory `aria-label`/caption ("Awaiting payment — can't
  dispatch yet").
- **Prop threading** (tech-review): payment status flows page query → `OrderShipmentPanel` →
  `ShipmentActionButtons` as a prop. The presentational button never reaches for server state
  itself (frontend-architecture state-ownership — server state stays in the page/feature query).

## 4. Step-by-step

1. **CORE union** — `payment-status.types.ts` + barrel export. *AC:* `as const` + derived union + const map; file header; exported from `@openlinker/core/orders`.
2. **CORE contract** — add `paymentStatus?: PaymentStatus` to `IncomingOrder` and `Order`. *AC:* type-checks; optional; documented.
3. **CORE threading** — `buildUnifiedOrder` passes it through; **`persistOrder` snapshot literal** + `persistIncomingSnapshot` snapshot literal both add the `paymentStatus` key (explicit enumeration). *AC:* unit test asserts `persistOrder`'s output snapshot contains `paymentStatus` (FE-facing path named specifically).
4. **Allegro derivation** — named exported pure fn `deriveAllegroPaymentStatus(payment)` co-located with the adapter; adapter sets `paymentStatus` on `IncomingOrder`. *AC:* COD→cod, ONLINE+finishedAt→paid, ONLINE+no-finishedAt→awaiting. Existing `status` logic unchanged.
5. **Allegro specs** — dedicated spec for `deriveAllegroPaymentStatus` (the three cases) + extend adapter spec asserts. *AC:* green.
6. **FE parse** — `ParsedOrderSnapshot.paymentStatus` + parse + value-set validation. *AC:* parse unit test (valid, absent, unknown→warning).
7. **FE chip** — payment `StatusBadge` on the order surface, tone map, omit-when-absent. *AC:* renders for each status; absent → no chip.
8. **FE gate** — `shipment-action-buttons.tsx`: **block-list polarity** (block iff `awaiting`/`refunded`; `paid`/`cod`/`undefined`/unknown allow), payment status passed in as a prop from `OrderShipmentPanel`, disabled-with-reason. *AC:* component test per branch incl. `undefined`-allows.
9. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`; then **full** `pnpm test:integration` (epic mandate). *AC:* all green.

## 5. Validate

- **Architecture.** Union in CORE domain types (no framework dep). Adapter maps source→neutral
  (Integration owns translation). DTO unchanged (passthrough). FE reads snapshot only. No CORE→
  integration leak. ✓
- **No migration.** Rides in existing `jsonb` snapshot. ✓ (will still run `migration:show` to confirm none pending.)
- **Naming/quality.** `*.types.ts`, `as const` union (no enum), no `any`, file headers, StatusBadge `tone` + text (color never sole signal — style-guide §Color Usage). ✓
- **Graceful degradation.** Optional field; PS + legacy orders → `undefined` → no chip, no gate block. ✓
- **Testing.** Unit: union/helper/parse/gate. Integration: full suite per epic. The Allegro COD-vs-paid discriminator is the key correctness risk — covered by step-4 unit cases. ✓

## Open questions for review
- **Refund handling**: `refunded` is in the union but Allegro checkout-form can't source it in v1
  (no refund signal on that endpoint). Keep it in the union (forward-compat, and a future
  refund-event path can set it) vs. drop to `paid|cod|awaiting` now? Plan keeps it; flag for call.
- **Chip placement**: order-detail header (next to status/health badges) — consistent with
  existing order chips. Confirm that's the desired surface vs. the pricing panel.
- **Snapshot-only vs. column**: plan stores payment status in the `jsonb` snapshot (no migration).
  If list-level filtering by payment status is wanted later (like #927's SLA sort), a promoted
  column would be needed — out of scope for #928, notable for #929/#932's queue.
