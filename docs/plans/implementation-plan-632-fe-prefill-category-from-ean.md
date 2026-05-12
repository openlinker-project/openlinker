# Implementation Plan — #632 FE: Pre-fill Allegro category from EAN in CreateOfferWizard

## 1. Goal & Context

Wire the `AllegroCreateOfferWizard` to the BE category-resolution endpoint shipped in #631. When the operator picks a variant in Step 0 and lands on Step 2, the wizard should:

1. Fire `POST /listings/connections/:connectionId/categories/resolve` with the picked variant's EAN.
2. On a non-null `allegroCategoryId` AND the user hasn't already touched the category, pre-select it via `form.setValue('categoryId', …, { shouldDirty: false })`.
3. Show a one-line hint under the picker attributing the source (`auto_detect` → "Matched from EAN {ean}", `category_mapping` → "Matched from configured category mapping", `manual` → no hint).
4. The hint disappears the moment the user changes the picker.

**Layer**: Frontend — `features/listings` API + hook + wizard component. No BE, no `shared/` touches.

**Non-goals**:
- Skipping Step 2 automatically (issue explicit).
- Ambiguous-match alternatives (BE collapses to one ID today).
- Plumbing `sourceCategoryIds` into the request — the wizard doesn't have source-category info at this step. First cut sends `barcode` only.

---

## 2. Diverges from issue text

**Wizard filename**: Issue refers to `apps/web/src/features/listings/components/CreateOfferWizard.tsx:786-813`. That file was renamed to `AllegroCreateOfferWizard.tsx` in #608 (capability-shape refactor). All file paths and line ranges below use the current name. The shape of the wiring (Step 2, `CategoryPicker` inside a `Controller`, `pickedVariantEan` already captured in Step 0) is intact — only the filename moved.

The test file is `AllegroCreateOfferWizard.test.tsx`.

Nothing else diverges from the issue.

---

## 3. Architecture

### Data flow

```
Step 0: operator picks variant
   └─> setPickedVariantEan(variant.ean)        [existing line 448]

Step 2 mount (or pickedVariantEan/connectionId change)
   └─> useResolveCategoryQuery({ connectionId, barcode: pickedVariantEan })
         │  enabled: Boolean(connectionId && pickedVariantEan)
         │  retry: false
         ▼
   apiClient.listings.resolveCategory(connectionId, { barcode })
         │
         ▼  POST /listings/connections/:cid/categories/resolve
   { allegroCategoryId, method }   ← cached by query

   useEffect on data:
     if data.allegroCategoryId !== null
        && !form.formState.dirtyFields.categoryId
        && resolvedKeyRef.current !== `${connectionId}::${pickedVariantEan}`:
          setValue('categoryId', data.allegroCategoryId, { shouldDirty: false })
          resolvedKeyRef.current = `${connectionId}::${pickedVariantEan}`

   Hint render:
     if data?.allegroCategoryId === currentCategoryId
        && data.method !== 'manual':
          render <p className="form-field__description form-field__description--match">{copy}</p>
```

### Why the ref pattern

Mirrors the existing `prefilledKeyRef` (line 337) for category-parameter prefill. The dirty-field guard alone would let the resolved value re-apply itself if React re-runs the effect (e.g., the operator clears their override back to "untouched" by manually re-selecting the resolved value, which clears `dirtyFields.categoryId`). The ref pins the auto-set to once-per-`(connectionId, ean)` pair, which is what the issue's "do not overwrite user choice" rule actually means.

### State ownership (per `frontend.md`)

| Concern | Owner |
|---|---|
| Resolution result | TanStack Query (server state) |
| Category value | React Hook Form (form state) |
| "Have we already auto-set for this (cid, ean) pair?" | `useRef` (local UI state) |

No new global store, no new context.

---

## 4. File-by-file plan

### 4.1 `apps/web/src/features/listings/api/listings.types.ts` — add request/response types

Add at the end of the file, near the other request/response shapes:

```ts
/**
 * Request body for POST /listings/connections/:connectionId/categories/resolve.
 * Mirrors the BE ResolveCategoryRequestDto (#631). Fields stay camelCase.
 */
export interface ResolveCategoryRequest {
  /** EAN/GTIN barcode for auto-detect. Omit to skip step 1. */
  barcode?: string | null;
  /**
   * Source-platform category IDs (deepest-first) for the mapping fallback.
   * Not used by the wizard today — kept on the type so the FE can grow into it
   * without a second migration when source-category info becomes available.
   */
  sourceCategoryIds?: string[];
}

/**
 * Mirrors the BE `CategoryResolutionMethodValues` shipped from
 * `@openlinker/core/listings/application/types/category-resolution.types.ts`.
 * Duplicated FE-side per #591 — apps/web is a browser bundle and the
 * apps/web FE convention is local types under `features/*/api/*.types.ts`
 * (see `CategoryParameter` in this file for the established precedent). If
 * the BE grows a 4th method, TS narrowing on the response will fail-fast at
 * the wizard's `resolvedCategoryHint(...)` and both sides need a one-line
 * edit in lockstep.
 */
export const CategoryResolutionMethodValues = [
  'auto_detect',
  'category_mapping',
  'manual',
] as const;
export type CategoryResolutionMethod = (typeof CategoryResolutionMethodValues)[number];

/** Response from POST /listings/connections/:connectionId/categories/resolve. */
export interface ResolveCategoryResponse {
  /** Resolved marketplace category ID, or null if manual pick is needed. */
  allegroCategoryId: string | null;
  /** Which step of the 3-step fallback produced the result. */
  method: CategoryResolutionMethod;
}
```

**Note**: we duplicate the `CategoryResolutionMethodValues` union on the FE rather than importing from `@openlinker/core` — `apps/web` is a browser bundle and per #591 only consumes from top-level barrels of FE-safe packages. Importing core types into the browser also drags TypeORM/Nest types in transitively. The values are an enum-style union: trivial to keep in sync, and the BE already validates against its own copy.

### 4.2 `apps/web/src/features/listings/api/listings.api.ts` — add `resolveCategory`

Add to the `ListingsApi` interface:

```ts
resolveCategory: (
  connectionId: string,
  body: ResolveCategoryRequest,
) => Promise<ResolveCategoryResponse>;
```

Add to the imports and to `createListingsApi(...)`:

```ts
resolveCategory(connectionId, body): Promise<ResolveCategoryResponse> {
  return request<ResolveCategoryResponse>(
    `/listings/connections/${connectionId}/categories/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
},
```

### 4.3 `apps/web/src/features/listings/api/listings.query-keys.ts` — add key

```ts
resolveCategory: (connectionId: string, barcode: string | null, sourceCategoryIds?: string[]) =>
  [
    'listings',
    'resolveCategory',
    connectionId,
    barcode ?? '',
    sourceCategoryIds ?? [],
  ] as const,
```

The `sourceCategoryIds` slot is included now so a future caller with source-category info doesn't share a cache entry with the wizard's barcode-only call.

### 4.4 `apps/web/src/features/listings/hooks/use-resolve-category-query.ts` — new

```ts
/**
 * use-resolve-category-query
 *
 * Calls the BE category-resolution endpoint (#631) for the create-offer
 * wizard's Step 2 auto-prefill. Returns the resolved Allegro category id and
 * the resolution method (`auto_detect` | `category_mapping` | `manual`).
 *
 * Enabled only when both `connectionId` and `barcode` are set. `retry: false`
 * because Allegro's `/sale/matching-categories` regularly returns "no match"
 * and that's a normal 200 from our BE, not a transient error.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ResolveCategoryResponse } from '../api/listings.types';

// 10-minute window. Resolution is deterministic for a given (connectionId,
// barcode) pair — the only legitimate invalidator is an admin changing
// category mappings, which is rare. 10 min covers a wizard session and the
// usual Step 0 ↔ Step 2 navigation without re-hitting Allegro's rate-limited
// /sale/matching-categories endpoint on every remount.
export const RESOLVE_CATEGORY_STALE_TIME_MS = 10 * 60 * 1000;

export function useResolveCategoryQuery(
  connectionId: string | undefined,
  barcode: string | null | undefined,
  sourceCategoryIds?: string[],
): UseQueryResult<ResolveCategoryResponse> {
  const apiClient = useApiClient();
  return useQuery<ResolveCategoryResponse>({
    queryKey: listingsQueryKeys.resolveCategory(
      connectionId ?? '',
      barcode ?? null,
      sourceCategoryIds,
    ),
    queryFn: () =>
      apiClient.listings.resolveCategory(connectionId as string, {
        barcode: barcode ?? null,
        sourceCategoryIds,
      }),
    enabled: Boolean(connectionId && barcode),
    retry: false,
    staleTime: RESOLVE_CATEGORY_STALE_TIME_MS,
  });
}
```

### 4.5 `apps/web/src/features/listings/components/AllegroCreateOfferWizard.tsx` — wire query + setValue + hint

**New imports** (top of file, with the others from `../hooks`):
```ts
import { useResolveCategoryQuery } from '../hooks/use-resolve-category-query';
```

**New state** (next to `prefilledKeyRef` around line 337, before the existing `useEffect`):
```ts
const resolvedCategoryKeyRef = useRef<string>('');
const resolveCategoryQuery = useResolveCategoryQuery(
  currentConnectionId || undefined,
  pickedVariantEan,
);
```

**New useEffect** (immediately after the existing parameter-prefill effect, so it follows the same "once-per-key" pattern):
```ts
// #632 — once the BE resolves a category for the picked variant's EAN, pre-set
// the picker, but only when the operator has not already chosen one. The
// dirty-field guard preserves operator intent; the ref pins the auto-set to
// once per (connectionId, ean) so re-renders don't stomp a value the operator
// has cleared back to the resolved one.
useEffect(() => {
  const data = resolveCategoryQuery.data;
  if (!data || data.allegroCategoryId === null) return;
  if (!currentConnectionId || !pickedVariantEan) return;
  const key = `${currentConnectionId}::${pickedVariantEan}`;
  if (resolvedCategoryKeyRef.current === key) return;
  if (form.formState.dirtyFields.categoryId) return;
  resolvedCategoryKeyRef.current = key;
  form.setValue('categoryId', data.allegroCategoryId, { shouldDirty: false });
}, [
  resolveCategoryQuery.data,
  currentConnectionId,
  pickedVariantEan,
  form,
]);
```

**Hint copy helper** (top of file, near the other module constants):
```ts
function resolvedCategoryHint(
  method: CategoryResolutionMethod,
  ean: string | null,
): string | null {
  if (method === 'auto_detect' && ean) return `Matched from EAN ${ean}.`;
  if (method === 'category_mapping') return `Matched from configured category mapping.`;
  return null;
}
```

**Computed copy** (in the component body, just after `resolveCategoryQuery` is declared):
```ts
// Hint render gating: only attribute the resolved category when (1) we got a
// resolution back, (2) it currently matches the picker, and (3) the method
// has a copy to attribute (`manual` doesn't). Computed up-front instead of as
// an IIFE inside JSX so the picker block reads cleanly.
const resolveData = resolveCategoryQuery.data;
const resolvedCategoryHintCopy =
  resolveData &&
  resolveData.allegroCategoryId !== null &&
  resolveData.allegroCategoryId === currentCategoryId
    ? resolvedCategoryHint(resolveData.method, pickedVariantEan)
    : null;
```

**Hint render** (immediately after the existing `<p id="categoryId-description">` at lines 771-773, before the error block):
```tsx
{resolvedCategoryHintCopy ? (
  <p
    className="form-field__description form-field__description--match"
    aria-live="polite"
  >
    {resolvedCategoryHintCopy}
  </p>
) : null}
```

The `aria-live="polite"` ensures screen readers announce the match the first time it appears; subsequent re-renders (cached) don't re-trigger the announcement because the text doesn't change.

### 4.6 `apps/web/src/index.css` — add hint modifier

Append next to `.form-field__description` (line 1876):
```css
.form-field__description--match {
  color: var(--status-success-strong);
}
```

Uses `--status-success-strong` per `frontend-ui-style-guide.md:222-225` — `strong` is the documented text variant on neutral surfaces; the base `--status-success` is the icon/dot tone. No new tokens.

### 4.7 `apps/web/src/test/test-utils.tsx` — add default mock

Inside the `listings: { ... }` block (around line 234), add a default that returns "no match" so existing wizard tests don't all need to opt into a mock:

```ts
// #632 — default to method='manual' / null so wizard tests that don't
// opt into category resolution behave as if the BE returned "no match".
resolveCategory: vi.fn().mockResolvedValue({
  allegroCategoryId: null,
  method: 'manual',
}),
```

### 4.8 `apps/web/src/features/listings/components/AllegroCreateOfferWizard.test.tsx` — new tests

Four new tests under a `describe('Step 2 category auto-prefill (#632)')` block, mirroring the issue's acceptance criteria + the two hint copy branches:

1. **`auto_detect` → category pre-selected with EAN hint**: mock `resolveCategory` to return `{ allegroCategoryId: 'cat-42', method: 'auto_detect' }`, pick a variant whose EAN is set, advance to Step 2, assert the picker reflects `'cat-42'` and the hint text reads `Matched from EAN 5901234567890.`.
2. **`category_mapping` → mapping hint copy**: mock returns `{ allegroCategoryId: 'cat-7', method: 'category_mapping' }`; assert the picker reflects `'cat-7'` and the hint text reads `Matched from configured category mapping.` (no EAN in the copy — the wording is method-specific).
3. **No match → no hint, picker empty**: default mock returns `{ allegroCategoryId: null, method: 'manual' }`; assert no hint is rendered, picker stays at its empty value.
4. **User override → hint hidden, no re-prefill**: mock returns `{ allegroCategoryId: 'cat-42', method: 'auto_detect' }`, the user manually picks `'cat-99'` via the picker, then the query data is unchanged on re-render; assert (a) the form value stays `'cat-99'`, (b) no hint is rendered.

Test boilerplate reuses `renderWithProviders` + `createMockApiClient` from `test/test-utils.tsx`. Match copy assertions use `screen.getByText(/Matched from EAN/)` and `screen.getByText(/configured category mapping/)` so future copy tweaks only break if they change the distinctive substring.

---

## 5. Quality Gate

```
pnpm lint        # 0 errors
pnpm type-check  # 0 errors
pnpm test        # AllegroCreateOfferWizard.test (existing + 3 new), listings.query-keys.test
```

No backend changes → no `migration:show`. No `apps/api` files touched.

---

## 6. Acceptance Criteria (mapped from issue)

- [x] `listingsApi.resolveCategory` exists → 4.2
- [x] `useResolveCategoryQuery` is enabled only on connectionId+barcode → 4.4
- [x] Sets `categoryId` via `setValue(..., { shouldDirty: false })` when non-null + not dirty → 4.5
- [x] Does not overwrite operator's choice (dirty-fields + ref guard) → 4.5
- [x] Picker stays visible and operable; no auto-skip → 4.5 (no Step 2 navigation changes)
- [x] Hint reflects `method`; absent for `manual` → 4.5 (hint helper)
- [x] Hint disappears when user changes picker → conditional render on `data.allegroCategoryId === currentCategoryId`
- [x] Loading/error don't block the wizard → query failure leaves `data === undefined`; no error UI
- [x] Vitest tests for the three scenarios → 4.8
- [x] `pnpm lint && pnpm type-check && pnpm test` pass → 5
- [x] No new external UI library → only CSS modifier added
- [x] Dependency direction holds: feature → shared only → no `shared/` imports introduced

---

## 7. Risks & Open Questions

1. **`dirtyFields.categoryId` semantics** — RHF marks a field "dirty" only on user-initiated changes (not on `setValue(..., { shouldDirty: false })`). Verified in RHF docs and matches the wizard's existing `prefilledKeyRef` pattern, so this should work as expected. Edge case: if the operator picks the resolved value manually and then picks a different one, `dirtyFields.categoryId` is `true` and the ref guard already fired, so no stomping.

2. **Race between Step 0 → Step 2 navigation and query in-flight**: the picker can render before the query resolves. The hint conditional renders nothing until `data` arrives; no flicker. The auto-set fires inside `useEffect`, so it lands one tick after the query resolves — the operator sees an empty picker briefly. Acceptable for an MVP cut; if it ever becomes a UX papercut, gate Step 2 access on `!resolveCategoryQuery.isLoading` (out of scope).

3. **Cache lifetime**: default TanStack Query staleness applies. The endpoint is cheap on the BE (one Allegro `/sale/matching-categories` call, then DB lookups), and the cache key includes barcode + connection, so re-opening the wizard for the same variant is free. No special `staleTime` needed.

4. **Source category IDs**: kept on the FE type and query key, but the wizard does not plumb them today. Adding source-category info to the request is a follow-up, not a regression.

5. **`CategoryResolutionMethodValues` duplication** between FE and BE: BE imports from `@openlinker/core/listings`, FE duplicates the union locally. Acceptable per the import-aliases rules (apps/web is a browser bundle, core barrels drag in Nest/TypeORM types). The closed-union shape means TS will fail-fast if either side adds a value without updating the other.

6. **Responsive (mobile + tablet) coverage**: per the team's default-mobile-into-scope rule, the hint must work at 360 / 768 / 1440 px. The hint is a single `<p>` reflowing in the form's existing flex column with no horizontal demands — at 360 px it stays one line for the short EAN copy and wraps for longer categories without overflow. No new breakpoint-specific CSS needed. Step 2 is one-step-per-screen on mobile per the wizard convention, so the hint sits above the price/stock fields naturally.

---

## 8. Out of Scope (explicit)

- BE-side changes (already shipped in #631).
- Plumbing `sourceCategoryIds` into the wizard request.
- Ambiguous-match UX (BE collapses to one id today; see #635 for the catalog-product cousin).
- Auto-skip of Step 2.
- A "loading" skeleton on the picker while the resolve query is in flight.
