# Implementation Plan — Fix `pinLinePrices` synthetic-variant id (#923)

## 1. Understand the task

**Goal.** Allegro→PrestaShop order creation fails at the source-authoritative price-pinning
step (#895 / ADR-014) for any **simple (combination-less) product**. `pinLinePrices` forwards
the OL synthetic-variant marker string `product:<n>` straight into the `specific_prices`
POST as `id_product_attribute`; PrestaShop validates that field as an unsigned int and
rejects the non-numeric value with a 400 (`Validation error: "Property
SpecificPrice->id_product_attribute is not valid"`). The order lands in `FAILED`.

Two defects:
1. **Functional** — `pinLinePrices` does not coerce the external variant id the way the
   order/cart mapper already does (`parseInt` → `NaN → 0`). Affects every simple product.
2. **Diagnosability** — the thrown `PrestashopApiException` interpolates only `error.message`,
   dropping the upstream `responseBody` that carries the real PrestaShop reason. That is why
   the order's sync-error surface was uninformative.

**Layer.** Integration (PrestaShop) · Infrastructure (adapter + mapper). **No CORE change** —
`OrderProcessorManagerPort.createOrder(OrderCreate)` is untouched; no port / DTO / entity /
migration change.

**Non-goals.**
- No change to the master inventory / synthetic-variant *mapping* itself (`product:<n>` stays
  the simple-product variant external id — it is correct for the variant-keyed inventory read;
  PrestaShop just needs `0` for "no combination" at the `id_product_attribute` site).
- No change to multi-variant behaviour (real numeric combination ids must still pass through).
- No change to the `specific_prices` payload shape, tax conversion, or allocation logic.
- No ADR (local bug fix, no architectural decision or cross-context impact).

## 2. Research (existing patterns)

- `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts`
  - `mapOrderCreate` lines **194–211**: `typeof variantId === 'string' ? Number.parseInt(variantId, 10) : variantId`, then `Number.isNaN → 0`, else `0`.
  - `mapCartCreate` lines **~357–377**: the same block, duplicated.
  - This is the **already-correct** coercion. The two copies are themselves a drift risk.
- `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts`
  - `pinLinePrices` lines **604–606**: `const externalVariantId = item.variantId ? (externalVariantIds.get(item.variantId) ?? 0) : 0;` — no numeric coercion. Bug 1.
  - line **625**: `id_product_attribute: externalVariantId` — the rejected field.
  - throw lines **653–658**: drops `responseBody`. Bug 2. `formatBodyForLog` is already imported and used elsewhere in this file (~line 503). `PrestashopApiException` exposes `responseBody?: string` (per its docblock, intentionally unbounded; cap log surfaces via `formatBodyForLog`).
- Live repro (prior session, dev stack, rows cleaned up): POST with `id_product_attribute=0` → 201; `=product:25` → 400 matching the reported error.

## 3. Design

**Single shared helper** so the coercion can't drift again (it currently lives in three places
after the fix would otherwise add a fourth). Pure synchronous function, no I/O — fits the
infrastructure-util shape.

New file: `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-variant-id.ts`

> **Naming (tech-review #923).** No `*.util.ts`/`*.utils.ts` file exists anywhere in `libs/`,
> and `*.util.ts` is not in `engineering-standards.md`'s file-type catalog. The established
> precedent for a pure helper is a plainly-named kebab `.ts` with a co-located `__tests__/`
> spec — e.g. `libs/shared/src/money/allocate-by-largest-remainder.ts`, which `pinLinePrices`
> already imports. The helper drops the `.util` suffix to match that precedent.

```ts
/**
 * PrestaShop variant-id coercion
 *
 * Resolves an OpenLinker external variant id (as stored in identifier_mappings,
 * looked up per connection) to a PrestaShop `id_product_attribute`. Simple
 * products carry a synthetic-variant marker (`product:<n>`) rather than a numeric
 * combination id; PrestaShop validates `id_product_attribute` as an unsigned int,
 * so any non-numeric / missing value must collapse to 0 ("no combination").
 * Shared by the order/cart mapper and the price-pinning path so the coercion
 * cannot drift (#923).
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @see {@link allocate-by-largest-remainder} for the pure-helper file precedent
 */
export function toPrestashopProductAttributeId(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  return Number.isNaN(parsed) ? 0 : parsed;
}
```

Behaviour table (locks the contract for the unit test):

| input | output | why |
|---|---|---|
| `undefined` | `0` | no variant mapping |
| `'product:25'` | `0` | synthetic marker → NaN → 0 (**the bug**) |
| `'460'` | `460` | numeric string combination id |
| `460` | `460` | numeric combination id |
| `'0'` / `0` | `0` | explicit no-combination |
| `'abc'` | `0` | defensive: any non-numeric → 0 |

Note `Number.parseInt('460abc', 10) === 460` — matches the mapper's existing behaviour exactly
(no stricter validation introduced; this is a pure extract-and-reuse).

**Consumers:**
- `pinLinePrices` 604–606 → `const externalVariantId = toPrestashopProductAttributeId(item.variantId ? externalVariantIds.get(item.variantId) : undefined);`
- `mapOrderCreate` 194–211 → replace the inline block with the helper.
- `mapCartCreate` ~357–377 → replace the inline block with the helper.

Import path: adapter is in `infrastructure/adapters/`, helper in `infrastructure/mappers/` →
relative `../mappers/prestashop-variant-id` (depth `../..`-compliant, same context). Mapper
imports it as `./prestashop-variant-id`.

**Diagnosability fix** — in the `pinLinePrices` catch, when the caught error is a
`PrestashopApiException` with a `responseBody`, append it via `formatBodyForLog`:

```ts
} catch (error) {
  const detail =
    error instanceof PrestashopApiException && error.responseBody
      ? `${error.message} — ${formatBodyForLog(error.responseBody)}`
      : error instanceof Error
        ? error.message
        : String(error);
  throw new PrestashopApiException(
    `Failed to pin source-authoritative price for product ${externalProductId}: ${detail}`,
    undefined,
    undefined,
  );
}
```

## 4. Step-by-step

1. **Create helper** `prestashop-variant-id.ts` with `toPrestashopProductAttributeId`.
   *AC:* exported pure fn; file header present; no `any`.
2. **Use helper in `pinLinePrices`** (adapter 604–606); keep the `id_product_attribute` field
   referencing the coerced value. *AC:* `product:<n>` → `0` in the POST body.
3. **Append `responseBody` to the pin failure** (adapter catch 649–659) via `formatBodyForLog`.
   *AC:* a 400 with a body surfaces the PS validation message in the thrown error.
4. **Refactor mapper** `mapOrderCreate` + `mapCartCreate` to call the helper (delete the two
   inline blocks). *AC:* behaviour unchanged; both call the one helper.
5. **Unit test** `__tests__/prestashop-variant-id.spec.ts` — the full behaviour table above
   (co-located `__tests__/` dir, matching the `allocate-by-largest-remainder` precedent).
   *AC:* every row asserted.
6. **Unit test** `pinLinePrices` in the adapter spec:
   - simple-product case — variant maps to `product:25`, assert the
     `createResource('specific_prices', …)` call receives `id_product_attribute: 0` (the #923
     regression). Add/confirm a multi-variant case asserts a numeric id passes through.
   - diagnostics — mock `createResource` to reject with
     `PrestashopApiException(msg, 400, '<errors>…</errors>')`; assert the thrown
     "Failed to pin…" message contains the `responseBody` text (locks in the step-3 fix that
     made the original failure undiagnosable). Promoted from "if feasible" to required per
     tech-review.
   *AC:* red before fix, green after.
7. **Quality gate** (scoped to the package + repo gate): `pnpm lint`, `pnpm type-check`,
   `pnpm test`. *AC:* zero errors; full prestashop unit suite green.

## 5. Validate

- **Architecture.** Confined to `libs/integrations/prestashop/infrastructure`. No CORE/port/DTO
  change. Helper is a pure infra util (allowed). No new cross-context imports; no `orm-entities`
  or deep-barrel access. ✓
- **Naming.** `*.util.ts` for a pure helper, `*.spec.ts` for unit tests, camelCase fn,
  PascalCase nothing-new. File header included. ✓
- **Types/quality.** No `any`; explicit return type on the helper; no `console.log`; no secrets. ✓
- **Testing.** Pure-fn table test + adapter regression covering the exact #923 path; multi-variant
  guard prevents over-correction. Unit-only (no Docker) suffices to prove the coercion; an
  int-spec is **out of scope** for this fix (the bug is a pure value transform — the existing
  carrier int-spec already exercises the live pin path, and a simple-product int-spec is logged
  as a follow-up in the issue AC rather than blocking this PR). Flag this scope call at review.
- **Risk.** Very low. Behaviour-preserving extract for the mapper; the only behaviour *change* is
  `pinLinePrices` now coercing — which is strictly the mapper's already-shipped behaviour applied
  to a second site.

## Open questions for review
- Helper location: `infrastructure/mappers/` (chosen, both consumers reach it cleanly) vs a new
  `infrastructure/util/` folder. Mappers is the lighter-touch choice; no new folder.
- Int-spec: defer (unit coverage proves the transform) vs add a simple-product carrier int-spec
  now. Plan defers; open to adding if you want belt-and-suspenders.
