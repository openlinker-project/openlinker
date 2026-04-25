# Implementation Plan — #388: Propagate line-item `name` + `imageUrl` through the order pipeline

## Goal

End-to-end propagation of `name` and `imageUrl` for order line items, so the
order-detail page (FE already accepts these as optional via #386) renders real
product names instead of *"unnamed SKU row"* for Allegro orders.

## Layer classification

CORE + Integration. No interface/UI work, no migration, no env vars, no FE
change.

## Non-goals

- PrestaShop order-source `name` enrichment (separate adapter, different shape — defer).
- Internal-catalog `imageUrl` enrichment for Allegro (Allegro's checkout-form
  endpoint does not expose product images — defer to a follow-up).
- Translation / locale handling for `name` (multi-locale is a separate workstream).
- Any change to the persisted `orderSnapshot` schema contract (it's `Record<string, unknown>`; new keys are additive).

## Discovery — files the issue body did not call out

The issue lists 3 production files. The propagation chain actually crosses 5,
because there are two distinct item types:

| Layer | Type | Where |
|---|---|---|
| Adapter return | `IncomingOrderItem` | `libs/core/src/orders/domain/types/incoming-order.types.ts` |
| Unified order  | `OrderItem`        | `libs/core/src/orders/domain/types/order.types.ts` |

Conversion happens in `OrderIngestionService.buildUnifiedOrder` —
specifically the resolved-items loop at `order-ingestion.service.ts:203-217`,
which today does `{ id, productId, variantId, quantity, price, sku }` and drops
everything else.

Without extending `IncomingOrderItem` and propagating through the conversion,
the adapter mapping `name: lineItem.offer.name` won't typecheck, and even if it
did the field would evaporate in `buildUnifiedOrder` before reaching
`persistOrder`. So the honest minimum diff is **5 production files + 2 specs**,
not the 3+2 the issue body lists.

## Implementation steps

### 1. Extend `IncomingOrderItem` (domain types — incoming side)

**File:** `libs/core/src/orders/domain/types/incoming-order.types.ts`

Add two optional fields to `IncomingOrderItem`:

```ts
name?: string;       // Source-reported display label (no translation)
imageUrl?: string;   // Absolute URL when the source provides one
```

**Acceptance:** type compiles; existing consumers unaffected (fields optional).

### 2. Extend `OrderItem` (domain types — unified side)

**File:** `libs/core/src/orders/domain/types/order.types.ts:94-101`

Same two optional fields on `OrderItem`. Issue spec already shows the exact
shape.

**Acceptance:** type compiles.

### 3. Populate `name` in `AllegroOrderSourceAdapter.getOrder`

**File:** `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:158-164`

Add `name: lineItem.offer.name` to the items mapping. **Do not** set
`imageUrl` — Allegro's checkout-form endpoint does not expose one. Document
the omission inline.

**Acceptance:** type compiles; an existing well-formed checkout-form fixture
produces an `IncomingOrder` whose items carry the offer name.

### 4. Propagate through `OrderIngestionService.buildUnifiedOrder`

**File:** `libs/core/src/orders/application/services/order-ingestion.service.ts:203-217`

In the resolved-items push, pass `name: item.name` and `imageUrl: item.imageUrl`
through alongside the other fields.

**Acceptance:** type compiles. No new test required — this is direct
pass-through plumbing; the end-to-end behavior is exercised by the
`OrderRecordService` spec (step 7) and would be redundant to retest at this
layer with mocked dependencies.

### 5. Propagate through `OrderRecordService.persistOrder`

**File:** `libs/core/src/orders/application/services/order-record.service.ts:52-59`

Add `name: item.name` and `imageUrl: item.imageUrl` to the snapshot items
mapping. Keys are present-only (a missing `name` becomes `name: undefined`,
which `JSON.stringify` drops — no extra conditional needed). Document this
behavior in the existing snapshot-mapping site.

**Acceptance:** type compiles; snapshot items carry `name`/`imageUrl` when the
domain order had them, omit the keys when serialised otherwise.

### 6. Spec — Allegro adapter

**File:** `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts`

The existing `'should hydrate a full IncomingOrder from the checkout-form
endpoint'` test (line 186) already uses a fixture with
`offer: { id: 'offer-1', name: 'Offer 1' }`. Extend its existing
`incoming.items[0]` `toMatchObject` assertion (line 226) with `name: 'Offer 1'`,
and add an explicit `expect(incoming.items[0].imageUrl).toBeUndefined()` to
lock in the documented omission.

**Acceptance:** test passes; if `name` is later dropped or `imageUrl` is set
without justification, the test fails.

### 7. Spec — `OrderRecordService.persistOrder`

**File:** `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts`

Two new assertions (added to the existing PII-enabled `describe` block at
line 133, since neither concerns PII handling):

(a) When a domain `OrderItem` carries `name` and `imageUrl`, the persisted
    `orderSnapshot.items[0]` carries them verbatim.

(b) When neither field is set on the domain `OrderItem`, the persisted
    `orderSnapshot.items[0]` does not have the keys (use
    `expect(snapshotItem).not.toHaveProperty('name')` after a JSON round-trip,
    or assert the items array equals the expected literal without those keys).

The existing `createMockOrder` fixture has one item (`item-1`); extend it
inline in the new tests rather than mutating the helper.

**Acceptance:** both assertions pass; spec covers presence and omission cases.

## Validation

Architecture: domain types stay framework-free; the adapter remains the only
place that knows about Allegro's wire shape; no port contract changes; no
ORM/migration work. Naming: existing `OrderItem` extension follows the file's
own convention; no new types file warranted (per issue body). Testing: extends
two existing specs as the issue instructs — no new spec files. Security: none
of the new fields are PII; `name` is the merchant-facing offer title and
`imageUrl` is a public CDN URL when set.

## Risks

- **Empty-string `offer.name`** — issue body declines to pre-empt this. If
  production data later shows empty strings, add a `.trim() || undefined`
  guard at that point. Not a blocker.
- **PrestaShop order source still omits `name`** — out of scope. PS order
  ingestion will keep showing the SKU/productId fallback until a separate
  follow-up enriches it from the internal catalog. The FE fallback chain
  (#386) handles this gracefully.

## Files expected to change

**Production (5):**
- `libs/core/src/orders/domain/types/order.types.ts`
- `libs/core/src/orders/domain/types/incoming-order.types.ts`
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts`
- `libs/core/src/orders/application/services/order-ingestion.service.ts`
- `libs/core/src/orders/application/services/order-record.service.ts`

**Tests (2):**
- `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts`
- `libs/core/src/orders/application/services/__tests__/order-record.service.spec.ts`

## Quality gate

```
pnpm lint
pnpm type-check
pnpm test
```

All three must pass before commit. No migration check needed (no ORM entity
changes).
