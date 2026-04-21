# Implementation Plan — Widen `CreateOfferOverrides` nullability (#293)

**Branch:** `293-widen-create-offer-overrides-null`
**Layer:** Core (integrations domain types + listings application service)
**Driver:** Follow-up to #286/#292 `Product` type reconcile. The unified `Product` uses `T | null` for nullable fields, but `CreateOfferOverrides.description` / `.imageUrls` only accept `T | undefined`, forcing a `?? undefined` coercion at `offer-builder.service.ts:105-106`.

---

## 1. Goal & non-goals

**Goal:** Let `Product.description` (string | null) and `Product.images` (string[] | null) flow straight into a `CreateOfferCommand`'s overrides without coercion, keeping downstream adapters behavior-equivalent.

**Non-goals:**
- Widening other `CreateOfferOverrides` fields (`title`, `categoryId`, `platformParams`) — out of scope per the issue.
- Changing `CreateOfferCommand` itself.
- Changing how marketplace adapters render description/imageUrls beyond what's necessary for consistency.

---

## 2. Layer classification

Pure CORE change touching two modules:
- **`libs/core/src/integrations/domain/types/`** — source of truth for `CreateOfferOverrides`.
- **`libs/core/src/listings/application/services/offer-builder.service.ts`** — the only site that currently coerces `product.description ?? undefined` / `product.images ?? undefined`.

Downstream types that re-reference `CreateOfferOverrides` (`BuildCreateOfferCommandInput`, `ExecuteOfferCreationInput`, `MarketplaceOfferCreatePayloadV1`) auto-widen — no touch needed.

Allegro marketplace adapter already uses truthy checks (`if (cmd.overrides?.description)` at `allegro-marketplace.adapter.ts:863` and `if (cmd.overrides?.imageUrls && cmd.overrides.imageUrls.length > 0)` at `:873`), so `null` is already treated equivalently to `undefined` ("no override"). **No adapter behavior change required.**

---

## 3. Design

### 3.1 Shape — choose Option A (minimal)

Per the issue's recommendation, pick **Option A**: keep the fields optional, add `null` to the type.

```typescript
// libs/core/src/integrations/domain/types/marketplace-offer-create.types.ts
export interface CreateOfferOverrides {
  title?: string;
  description?: string | null;   // widened
  categoryId?: string;
  imageUrls?: string[] | null;   // widened
  platformParams?: Record<string, unknown>;
}
```

Why Option A over Option B (required fields):
- Backwards-compatible — existing callers that omit or assign `string` still type-check.
- Matches the unified `Product` shape (`T | null`) so pass-through works without coercion.
- The Allegro adapter's truthy checks handle `null` identically to omitted — no adapter churn.

### 3.2 Semantics — `null` / `undefined` ≡ "no override"

Add a single line to the JSDoc on both widened fields so readers know what `null` means:

> Fields are stripped when `null` or `undefined` — both mean "no override" (falls back to variant value, if any).

This documents the contract once so every downstream adapter can rely on it, and makes explicit that this is a two-way equivalence (not a three-way present/null/undefined distinction).

### 3.3 `offer-builder.service.ts:101-124` — simplify

**Before:**
```typescript
const title = input.overrides?.title ?? product.name;
// product.description / product.images are `T | null` on the unified Product
// interface, but CreateOfferOverrides expects `T | undefined`. Coerce null
// back to undefined at this boundary. Follow-up: widen CreateOfferOverrides.
const description = input.overrides?.description ?? product.description ?? undefined;
const imageUrls = input.overrides?.imageUrls ?? product.images ?? undefined;

const overrides = {
  title,
  description,
  categoryId: categoryId ?? undefined,
  imageUrls,
  platformParams: input.overrides?.platformParams,
};

// Drop undefined so serialization stays tidy.
const cleanedOverrides: CreateOfferCommand['overrides'] = {};
if (overrides.title !== undefined) cleanedOverrides.title = overrides.title;
if (overrides.description !== undefined) cleanedOverrides.description = overrides.description;
if (overrides.categoryId !== undefined) cleanedOverrides.categoryId = overrides.categoryId;
if (overrides.imageUrls !== undefined) cleanedOverrides.imageUrls = overrides.imageUrls;
if (overrides.platformParams !== undefined) {
  cleanedOverrides.platformParams = overrides.platformParams;
}
```

**After:**
```typescript
const title = input.overrides?.title ?? product.name;
const description = input.overrides?.description ?? product.description;
const imageUrls = input.overrides?.imageUrls ?? product.images;

const overrides = {
  title,
  description,
  categoryId,
  imageUrls,
  platformParams: input.overrides?.platformParams,
};

// Drop null and undefined so serialization stays tidy and adapters see a
// consistent "absent field" shape regardless of whether the source was a
// missing override or a null Product field.
const cleanedOverrides: CreateOfferCommand['overrides'] = {};
if (overrides.title != null) cleanedOverrides.title = overrides.title;
if (overrides.description != null) cleanedOverrides.description = overrides.description;
if (overrides.categoryId != null) cleanedOverrides.categoryId = overrides.categoryId;
if (overrides.imageUrls != null) cleanedOverrides.imageUrls = overrides.imageUrls;
if (overrides.platformParams != null) {
  cleanedOverrides.platformParams = overrides.platformParams;
}
```

**Changes:**
- Drop the two `?? undefined` tails on `description` and `imageUrls` (the #293 core ask).
- Drop the explanatory comment that justified the coercion — obsolete.
- Flip the `cleanedOverrides` filter from `!== undefined` to `!= null` (loose-nullish check) so both `null` and `undefined` are stripped symmetrically.
- **Intentional bonus cleanup:** simplify `categoryId: categoryId ?? undefined` → `categoryId`. The local `categoryId` variable is `string | null` (from `resolveCategory()`); the new `!= null` filter strips null identically to the old `?? undefined` → `!== undefined` pipeline. Not scoped by #293 but the filter flip makes the coercion redundant, and leaving it in would be noise.

**Why strip null?**
- Keeps the resulting `CreateOfferCommand.overrides` shape tidy: `{}` instead of `{ description: null, imageUrls: null }`.
- Adapters see a consistent "absent field" shape — they can rely on `cmd.overrides?.description` being either a non-empty string or `undefined`, not `null`.
- The filter's job is exactly "remove fields that mean nothing" — null means nothing, same as undefined.

### 3.4 Callsite behavior check

| Input combo | Before | After |
|---|---|---|
| `overrides.description = 'X'`, product.description = 'Y' | `'X'` | `'X'` ✓ |
| `overrides.description = undefined`, product.description = 'Y' | `'Y'` | `'Y'` ✓ |
| `overrides.description = undefined`, product.description = null | `undefined` → stripped | `null` → stripped ✓ |
| `overrides.description = null`, product.description = 'Y' | (type error) | `'Y'` ✓ (null triggers `??`) |
| `overrides.description = null`, product.description = null | (type error) | `null` → stripped ✓ |

Behavior on every existing code path is identical; the widening only legalizes the previously illegal `null` input.

---

## 4. Step-by-step

| # | File | Change |
|---|---|---|
| 1.1 | `libs/core/src/integrations/domain/types/marketplace-offer-create.types.ts` | Widen `description?: string | null` and `imageUrls?: string[] | null`; add "null or undefined ≡ no override" note to both JSDocs. |
| 1.2 | `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts` | Add an invariant line to `MarketplaceOfferCreatePayloadV1.overrides` JSDoc: callers constructing the payload directly (e.g. the future #259 REST endpoint) are expected to normalize through the builder; null description/imageUrls get stripped there. |
| 2.1 | `libs/core/src/listings/application/services/offer-builder.service.ts` | Drop `?? undefined` on lines 105-106; remove the stale comment; simplify `categoryId: categoryId ?? undefined` → `categoryId`; flip `cleanedOverrides` filter to `!= null`. |
| 3.1 | `libs/core/src/listings/application/services/__tests__/offer-builder.service.spec.ts` | Add two tests in the `title/description/imageUrls overrides` block: (a) `product.description === null, product.images === null` → overrides omits both keys; (b) caller passes `overrides.description = null, overrides.imageUrls = null` → falls through to product values. |
| 3.2 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-marketplace.adapter.spec.ts` | Add one smoke test in the `createOffer` block: call with `overrides: { description: null, imageUrls: null, ... }` and assert the outgoing Allegro body omits `description` and `images`. Locks the adapter's null-safe truthy checks against regression. |

Steps 1 and 2 are independent at the type-check level (the coercion works either way), but committing them together keeps the unit of change atomic and easy to revert.

---

## 5. Testing strategy

**New unit tests** in `offer-builder.service.spec.ts`:

1. **Null product fields produce tidy command**
   - Mock `product.description = null`, `product.images = null`.
   - Assert `result.overrides?.description` is `undefined` (stripped) and that the returned overrides object does not contain a `description` key.
   - Assert the same for `imageUrls`.

2. **Null overrides fall back to product values**
   - Mock product with populated description / images.
   - Call with `overrides: { description: null, imageUrls: null, categoryId: 'explicit' }`.
   - Assert the result uses the product's description and images (null in overrides triggers the `??` fallback).

**Existing tests** — no assertion changes needed; the happy-path and override-win tests remain green because:
- Populated string values still propagate.
- The filter's shape (`{...}`) is unchanged for the populated case.

**Allegro adapter tests** — add one short smoke test that calls `createOffer` with `overrides: { description: null, imageUrls: null, title: 'x', categoryId: 'cat' }` and asserts the outgoing body omits `description` and `images`. The adapter's truthy checks already handle null correctly, but no test currently asserts that invariant. Locks the null-safe behavior against regression if someone later changes the checks to `!== undefined`.

---

## 6. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| A downstream consumer (outside the surveyed `CreateOfferOverrides` usages) does `overrides.description !== undefined` and now sees `null` instead of a missing key | Low | Grep confirmed the only sites that inspect these fields are (a) offer-builder itself (fixed), (b) Allegro adapter's truthy checks (null-safe). |
| Allegro adapter regression from semantic change | Very low | No adapter change is being made; the null input is stripped before reaching the adapter. Existing tests continue to assert the shape. |
| JSON serialization of a persisted `MarketplaceOfferCreatePayloadV1.overrides` including `null` | Very low | Payloads go through the same `cleanedOverrides` builder, so null never reaches persistence. |
| A future caller constructs `overrides` by hand and passes `description: null`, expecting different semantics from `undefined` | Medium-low | Documented in JSDoc: `null ≡ no override`. |

---

## 7. Architecture compliance

- ✅ Pure CORE change; no CORE → Integration leak, no layer crossings added.
- ✅ Domain layer remains framework-free.
- ✅ No new types, no new services, no DI changes.
- ✅ TypeScript strict mode: no `any`, explicit `| null | undefined` where the signature needs it.
- ✅ Naming unchanged; no new files.
- ✅ Testing: unit tests mock ports (existing setup).

---

## 8. Rollout

Single commit. Reversible via `git revert`. No migration, no config, no env change. Ships behind the same quality gate as every other PR (`pnpm lint && pnpm type-check && pnpm test`).
