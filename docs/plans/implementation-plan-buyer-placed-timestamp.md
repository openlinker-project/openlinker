# Implementation Plan — Buyer-placed timestamp (#926)

> Part of epic #925 (P1). Thread a **buyer-placed-on-marketplace** timestamp end-to-end
> so the order surfaces lead with *when the buyer placed the order*, not when OpenLinker
> ingested it. Unblocks the dispatch-SLA deadline (#927) and upgrades the "Placed"
> stand-in that #924 (detail) and #929/#932 (list) currently fill with ingestion time.

## 1. Goal & layers

- **Layers:** Integration (Allegro + PrestaShop order-source adapters) → CORE (orders
  domain types + ingestion mapping + snapshot persistence) → Interface (DTO — pass-through,
  no change) → Frontend (snapshot schema + detail header/summary + list column).
- **Goal:** a `placedAt` ISO timestamp present on the order contract end-to-end; FE leads
  with it, demoting OL's `received`/`updated` clocks to a secondary "OpenLinker processing" line.
- **Non-goals:** server-side sort-by-placedAt on the list (stays `createdAt`; noted below);
  payment status / SLA countdown (#927/#928); a DB migration (placedAt rides the existing
  `orderSnapshot` JSONB — no schema change).

## 2. Verified source field (Allegro — confirmed against developer.allegro.pl swagger)

- `CheckoutForm` top-level exposes only `updatedAt` (revision time) + `revision` — **no
  order-placed/created field.** OpenLinker's `AllegroCheckoutForm.createdAt?` is **fictional**
  (Allegro never returns it; the adapter's `checkoutForm.createdAt ?? new Date()` always hits
  the `new Date()` ingestion fallback).
- Buyer-placed time = **`lineItems[].boughtAt`** — `format: date-time`, *"ISO date when offer
  was bought"*. Allegro's own order list sorts by `lineItems.boughtAt`. For a single checkout
  form all line items are bought together; we take the **earliest** present `boughtAt`.
- **PrestaShop:** `date_add` is the real placed time (already mapped to `IncomingOrder.createdAt`
  at `prestashop-order-source.adapter.ts`). Populate `placedAt` from the same value for parity.

## 3. Steps (each with acceptance)

### CORE — domain contract
1. `libs/core/src/orders/domain/types/incoming-order.types.ts` — add `placedAt?: string` (ISO)
   to `IncomingOrder` with a doc comment (buyer-placed-on-source; absent when source omits it).
2. `libs/core/src/orders/domain/types/order.types.ts` — add `placedAt?: Date` to `Order`
   (sibling to `createdAt`/`updatedAt: Date`).
3. `libs/core/src/orders/application/services/order-ingestion.service.ts` (`buildUnifiedOrder`)
   — carry `placedAt: incoming.placedAt ? new Date(incoming.placedAt) : undefined`.
4. `libs/core/src/orders/application/services/order-record.service.ts` — both snapshot builders
   write `placedAt` via the established conditional-spread (absent-not-undefined) pattern:
   `persistOrder` → `...(order.placedAt && { placedAt: order.placedAt.toISOString() })`;
   `persistIncomingSnapshot` → `...(incoming.placedAt && { placedAt: incoming.placedAt })`.
   - *Acceptance:* unit specs assert the snapshot carries `placedAt` when present, omits the key when absent.

### Integration — adapters
5. `libs/integrations/allegro/.../allegro-order-source.adapter.ts` — derive
   `placedAt = earliest(lineItems[].boughtAt)` (present values only) and set it on the returned
   `IncomingOrder`. **Honest cleanup:** drop the fictional top-level `createdAt?` from
   `AllegroCheckoutForm` (allegro-api.types.ts) and set the adapter's ingestion `createdAt`
   directly to `new Date().toISOString()` (its current effective value); keep the real `updatedAt`.
   - *Acceptance:* adapter spec — boughtAt → placedAt; earliest-of-many; absent boughtAt → placedAt undefined.
6. `libs/integrations/prestashop/.../prestashop-order-source.adapter.ts` — set
   `placedAt` from `date_add` (parity), undefined when absent.
   - *Acceptance:* adapter spec — `date_add` → placedAt.

### Interface — no change
7. `apps/api/.../order-record-response.dto.ts` passes `orderSnapshot` verbatim → `placedAt`
   rides the wire automatically (same pattern as `taxTreatment` in #924). DTO's record-level
   `createdAt`/`updatedAt` are OL clocks and stay unchanged.

### Frontend
8. `apps/web/src/features/orders/api/order-snapshot.schema.ts` — add `placedAt?: string`
   to `ParsedOrderSnapshot` + parse it as a tolerated top-level scalar (like `customerEmail`).
   - *Acceptance:* schema test — parses `placedAt`, leaves undefined when absent, no parse warning.
9. `order-detail-header.tsx` + Summary KV (`order-detail-page.tsx`) — **lead with
   "Placed" = `snapshot.placedAt`** (absolute + relative); demote Received(`createdAt`)/Updated
   into a secondary "OpenLinker processing" line. Fall back to `createdAt` when `placedAt` absent.
10. `orders-list-page.tsx` — the existing "Placed" column (added by #929 as an honest
    `createdAt` stand-in) shows `parsedSnapshot.placedAt ?? createdAt`. **Server-side sort stays
    on `createdAt`** (placedAt lives in JSONB; sort-by-placedAt is out of scope — note in code).

### Optional stretch (only if one-liners)
11. Fold buyer note (`messageToSeller`) + source-side status string into the Allegro snapshot
    metadata if trivial; otherwise defer. Not required by AC.

## 4. Tests
- Unit: Allegro adapter (3 cases), PS adapter (1), `order-record.service` snapshot (2),
  ingestion mapping (1), FE schema (1), FE header/list display (2).
- Integration: extend an order-ingestion int-spec under `apps/api/test/integration` to assert
  `orderSnapshot.placedAt` end-to-end. **AC requires full `pnpm test:integration` green** (Docker).
- FE degrades gracefully when `placedAt` absent on older records (covered by fallback + schema test).

## 4a. Tech-review refinements applied

- **Guard external `boughtAt`** — the Allegro earliest-placed helper filters to *parseable*
  dates (`!Number.isNaN(Date.parse(v))`) and emits `placedAt` only when valid. A malformed
  source value degrades to **absent**, never throwing in `order.placedAt.toISOString()` (which
  would fail the whole snapshot build / order ingestion). Unit case covers it.
- **List column honesty — detail-only for #926.** The merged `/orders` list (#932) has a
  sortable "Created" column on the record `createdAt` (honest, consistent). Surfacing `placedAt`
  there would either create a sort-key ≠ display-value mismatch or require a server-side
  `orderSnapshot->>'placedAt'` sort — out of #926's scope. So #926 leaves the list untouched and
  scopes the FE change to the **detail page** (header + Summary lead with `placedAt`, demoting
  Received/Updated to OL-processing clocks). A sortable list "Placed" column is a follow-up.
- **Spec + int-suite ripple** — update existing `allegro-order-source.adapter.spec.ts`
  assertions touched by removing the fictional `createdAt`; run the **full** `pnpm test:integration`
  (conditional-spread keeps the key absent unless `boughtAt` present, so ripple is bounded to
  fixtures carrying it). Confirm `checkoutForm.createdAt` has no reader besides the adapter.
- **PR note** — call out the fictional-`createdAt` removal as a deliberate honesty fix.
- **Fold-ins ride snapshot/metadata only** — buyer-note/source-status (if included) do not widen
  the typed `IncomingOrder`/`Order` contract.
- **FE fallback comment** — `snapshot.placedAt ?? order.createdAt` falls back to the **record**
  `createdAt` (OL ingestion), not `snapshot.createdAt` (vestigial); comment it.

## 5. Quality gate
`pnpm lint && pnpm type-check && pnpm test` green; then `pnpm test:integration` (order-ingestion
+ carrier-mapping + fulfillment) per the issue AC.
