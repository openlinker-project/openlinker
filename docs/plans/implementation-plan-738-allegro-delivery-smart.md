# Implementation Plan — #738 (`feat(allegro): propagate delivery.smart boolean from order payload to OrderRecord`)

**Status**: Draft
**Issue**: [#738](https://github.com/openlinker-project/openlinker/issues/738)
**Parent epic**: #726 (Allegro Smart! + Bulk offer creation)
**Branch**: `738-allegro-delivery-smart`

---

## 1. Goal

Allegro's `GET /order/checkout-forms/{id}` returns `delivery.smart: boolean` indicating whether the order qualified for Allegro Smart!. Carry that signal through the order ingestion path into the persisted `OrderRecord` so future features (Smart-vs-non-Smart filtering, analytics, badges) can read it.

**Layer classification**: Integration (Allegro adapter mapping) + CORE (one optional field on the neutral `IncomingOrder` DTO).

**Non-goals**:
- FE display (Smart badge on orders) — separate impl issue.
- Smart-based order filtering — future feature.
- Smart top-up fee tracking — settlement-level, separate concern.
- Non-Allegro sources — PrestaShop / future shops will leave the field undefined.

## 2. Verified surface (research findings)

| Element | Path | Status |
|---|---|---|
| `AllegroCheckoutForm.delivery.smart?: boolean` | `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:100` | Already typed; needs to be **consumed** |
| `AllegroOrderSourceAdapter.getOrder` | `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:146–220` | Maps response → `IncomingOrder`; new field added at the construction site |
| `IncomingOrder` type | `libs/core/src/orders/domain/types/incoming-order.types.ts:15–77` | Add `deliverySmart?: boolean` as a new optional |
| `OrderRecord` entity + ORM + repo | `libs/core/src/orders/...` | **No flat column** — order data persisted as `orderSnapshot: jsonb`. **Correction (post-tech-review)**: the snapshot is built field-by-field in `OrderRecordService.persistOrder` and `persistIncomingSnapshot` — adding a field to `IncomingOrder` is NOT sufficient; the new field must be threaded through `Order` → `buildUnifiedOrder` → both snapshot projections. |
| Allegro adapter spec | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts` | Extend with `delivery.smart=true / =false / missing-delivery / present-but-no-smart-key` fixtures |
| `OrderRecordService` snapshot builders | `libs/core/src/orders/application/services/order-record.service.ts` | Add `deliverySmart` via conditional spread to both `persistOrder` and `persistIncomingSnapshot` (match the existing absent-vs-`undefined` precedent on `OrderItem.name` / `imageUrl`) |
| `Order` domain type | `libs/core/src/orders/domain/types/order.types.ts` | Add `deliverySmart?: boolean` next to `shipping` / `pickupPoint` |
| `OrderIngestionService.buildUnifiedOrder` | `libs/core/src/orders/application/services/order-ingestion.service.ts` | Forward `incoming.deliverySmart` into the constructed `Order` |

## 3. Spec deviations (call out)

The issue body asks for two things the persistence model doesn't actually require:

- **"Persist via a small migration (add `delivery_smart` column, nullable)"** — `OrderRecord` stores `orderSnapshot: jsonb` (not flat columns per field). The field rides inside the JSONB snapshot — no DDL migration needed. The snapshot itself is built field-by-field in two `OrderRecordService` methods, so the field still needs to be added to both projections (it does NOT "ride free" — that was an earlier mistake in this plan, caught by tech-review). **Skip the migration, expand the in-code propagation.**
- **"Surface in OrderRecord domain entity"** — `OrderRecord`'s constructor takes `orderSnapshot` as an opaque blob. Callers already access nested fields via `record.orderSnapshot.x`. Adding a flat `deliverySmart` getter would be redundant with `record.orderSnapshot.deliverySmart`. **Skip the entity change.**

Net effect: this issue ships as a **5-file change + 2 spec extensions** (vs the issue body's 4-file change + migration). The acceptance criteria from the issue body re-map cleanly:

| Issue AC | How this plan satisfies it |
|---|---|
| Allegro orders carry `deliverySmart` value | New field on `IncomingOrder` populated by `AllegroOrderSourceAdapter.getOrder` from `checkoutForm.delivery?.smart` |
| Pre-existing orders default to `null` | JSONB column tolerates missing keys; readers `record.orderSnapshot.deliverySmart` returns `undefined`. **Note**: the issue says "null" but the natural JS shape is `undefined` for an absent optional field. Documenting this — if downstream code needs strict `null`, the adapter coalesces with `?? null`. |
| PrestaShop & other non-Allegro orders ingest with `null` | `PrestashopOrderSourceAdapter.getOrder` (`libs/integrations/prestashop/...`) is untouched; it never sets `deliverySmart`, so the field is `undefined` on its `IncomingOrder` outputs. Same JSONB tolerance. |
| Migration up + down round-trips | **N/A** — no migration. |
| Unit spec for `getOrder` with both `delivery.smart=true` and `=false` fixtures | Step 3 below. |

## 4. Files to change

| File | Change |
|---|---|
| `libs/core/src/orders/domain/types/incoming-order.types.ts` | Add `deliverySmart?: boolean` to the `IncomingOrder` interface (placed adjacent to `shipping` / `pickupPoint`) |
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts` | Map `checkoutForm.delivery?.smart` into the returned `IncomingOrder` |
| `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts` | Three fixture variants: `delivery.smart=true`, `=false`, missing/undefined |

If the orders barrel re-exports `IncomingOrder`, no edit needed — type already exported.

## 5. Step-by-step

1. **Add `deliverySmart?: boolean` to `IncomingOrder`**. Pure type-level change; placed near `shipping?` / `pickupPoint?` to keep the delivery-related fields visually grouped. JSDoc one-liner: "Allegro Smart! eligibility flag; informational only, undefined for non-Allegro sources."
   ✅ acceptance: `pnpm --filter @openlinker/core type-check` green.
2. **Map in `AllegroOrderSourceAdapter.getOrder`**. At the existing `IncomingOrder` construction site (~line 212), spread-in `deliverySmart: checkoutForm.delivery?.smart` so a missing value stays `undefined` (not coerced to `false`).
   ✅ acceptance: type-check green for the Allegro plugin.
3. **Extend the adapter spec** with three variants:
   - `delivery.smart = true` → asserted `incomingOrder.deliverySmart === true`.
   - `delivery.smart = false` → asserted `=== false`.
   - `delivery` block missing the `smart` key (or `delivery` undefined entirely) → asserted `=== undefined`.
   Re-use the spec's existing checkout-form fixture builder; add a tiny override pattern if not present.
   ✅ acceptance: `pnpm --filter @openlinker/integrations-allegro test` green; 3 new cases.
4. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`. All green.

## 6. Risk / open questions

- **`undefined` vs `null`** — issue text says "default to `null`". The JSONB shape natively encodes the field's absence as `undefined` on read. If a future caller does `JSON.stringify(record.orderSnapshot)` for outbound API responses, missing-key + present-and-null both render identically; the runtime difference is only TypeScript narrowing. **Decision**: leave as `undefined` (the natural shape); document in the type's JSDoc. If a future caller needs strict `null`, normalisation belongs at the read boundary, not at the write.
- **No DB / schema impact** — confirmed against `OrderRecordOrmEntity` (only `orderSnapshot: jsonb` carries the order data); no migration needed.
- **PrestaShop parity** — untouched. The acceptance criterion "non-Allegro orders ingest with null" is satisfied by leaving `deliverySmart` unset; no plumbing required in the PS adapter.

## 7. Validation

- `pnpm lint` — green
- `pnpm type-check` — green
- `pnpm test` — Allegro plugin spec green (3 new cases); core orders spec unaffected
- `pnpm --filter @openlinker/api migration:show` — no pending migrations (confirms no schema impact)
