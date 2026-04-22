# Implementation Plan: Create Offer Wizard (Issue #261)

**Date**: 2026-04-22
**Status**: Ready for implementation (v2 — tech-review applied)
**Estimated Effort**: ~1.5 days

---

## 1. Task Summary

**Objective**: Add a frontend wizard that lets an operator publish an OpenLinker
variant as a new marketplace offer via the just-merged `POST /listings/connections/:connectionId/offers`
endpoint, with async polling of the returned `offerCreationRecordId` until it
reaches a terminal status (`active` or `failed`).

**Context**: Backend work landed in PR #299 (commit `703bccc`). The vertical
slice "OL variant → marketplace offer" has an API but no operator surface.
Depends on #259 (create-offer endpoint) and #260 (seller-policies endpoint).
Parent epic: #5 (Offer & Category Management).

**Classification**: Interface — frontend feature only. No backend changes.

---

## 2. Scope & Non-Goals

### In Scope
- `CreateOfferWizard` — 4-step drawer wizard (Variant → Details → Policies → Review) with an **in-wizard connection picker** (Step 1) so the wizard is self-sufficient and does not require pre-filtering the list page
- `listings` API module extensions: `createOffer`, `getOfferCreationStatus`, `getSellerPolicies` (with an **optional `idempotencyKey` arg forwarded as `x-idempotency-key`** so retries do not duplicate records)
- TanStack Query hooks: `useCreateOfferMutation`, `useOfferCreationStatusQuery`, `useSellerPoliciesQuery`
- `OfferCreationStatusBadge` + `OfferCreationErrorList` primitives in the listings feature
- "Create offer" CTA on `listings-list-page` that opens the wizard in a drawer (no connection pre-filter required)
- Post-submit inline tracker on listings list page that polls until terminal status, then invalidates the listings query so a new `active` offer surfaces automatically
- Responsive behavior per `docs/frontend-ui-style-guide.md` (mobile + tablet + desktop) using the existing `.drawer` + `SetupStepper` mobile collapse, **verified manually at 360 / 768 / 1440 px via `pnpm start:dev:web` before the PR opens**
- Unit tests for all new components and hooks

### Out of Scope
- Showing creation-record status on `listing-detail-page.tsx` for **existing**
  offer mappings. The backend does not yet expose a lookup by
  `externalOfferId → OfferCreationRecord`, so the issue's bullet "Show
  `offerCreation.status` badge... in listing-detail-page.tsx for OL-created
  offers" is deferred. The inline tracker on the list page fully covers the
  post-submit status-update acceptance criterion. **Follow-up issue to be
  filed before merge** once the shape of the backend lookup is agreed.
- Category picker for Allegro — Allegro requires `overrides.categoryId` for
  offer creation (see `allegro-marketplace.adapter.ts:879`). We surface this
  as a **required free-text input** in Step 2 with a help note. **Follow-up
  issue to be filed before merge** tracking a proper category picker; the
  free-text approach is acknowledged as operator-unfriendly for first-time
  use but acceptable because structured errors from the adapter surface
  through `OfferCreationErrorList` when the id is invalid.
- Rich description editor — reuse plain `Textarea` for MVP; the existing
  `OfferDescriptionEditor` is shaped for the partial-update PATCH flow and
  sends a `{ sections: [...] }` structure that the `createOffer` endpoint
  does not accept (it takes `overrides.description: string | null`).
- Image URL override UI — the backend accepts `overrides.imageUrls` but the
  wizard does not expose it in MVP; adapter falls back to variant images.
- Server-side cache busting for seller-policies — server already caches 10 min;
  FE uses `staleTime: 5 minutes` so repeated wizard opens do not re-fetch.
- Failed-state "Retry" affordance on the tracker — a `failed` record could
  reopen the wizard pre-filled with the previous request to close the loop
  on common errors (invalid category, missing policy). Deferred as a fast
  follow-up once the MVP is landed and the common failure shapes are known.
- Extracting a shared `shared/ui/drawer.tsx` primitive — this PR is the
  second hand-rolled `.drawer` consumer (first: `EditOfferDrawer`). Style
  guide §MVP Primitives lists `Dialog` / `ConfirmDialog` as the eventual
  canonical wrapper over `@radix-ui/react-dialog`. Deferred as a follow-up
  that refactors both existing callers at once rather than introducing a
  third pattern in this PR.

### Constraints
- No new backend endpoints
- Match existing FE patterns (drawer CSS classes, `SetupStepper`, RHF + Zod,
  shared `FormField`/`Input`/`Button`, `useToast`, dependency rules)
- `pnpm lint` + `pnpm type-check` + `pnpm test` must pass

---

## 3. Architecture Mapping

**Target Layer**: `apps/web` only. Features vertical slice lives in
`apps/web/src/features/listings/`.

**Capabilities Involved**: None new — consumes the existing
`ListingsApi` via `useApiClient()`.

**Existing Services Reused**:
- Shared primitives: `FormField`, `Input`, `Select`, `Textarea`, `Button`, `Alert`, `FormErrorSummary`, `SetupStepper`, `StatusBadge`, toast via `useToast()`
- Drawer CSS classes from `index.css` (`.drawer`, `.drawer__header`, `.drawer__body`, `.drawer__footer`, `.drawer-backdrop`) and wizard classes (`.wizard-card`, `.wizard-actions`, `.wizard-review-list`)
- `useApiClient()` DI hook (`app/api/api-client-provider`)
- Products feature: `useProductsQuery` for list + `useProductQuery` (or equivalent) for variants; confirm names during implementation and add a matching hook if missing
- Connections feature: `useConnectionsQuery` for the in-wizard connection picker
- `listingsQueryKeys` + `listingsQueryKeys.all` for cache invalidation

**New Components Required**:
- API: `createOffer`, `getOfferCreationStatus`, `getSellerPolicies` in `listings.api.ts`
- Types: offer-creation / seller-policies wire types in `listings.types.ts`
- Query keys: add `offerCreationStatus(connectionId, id)` and `sellerPolicies(connectionId)` to `listings.query-keys.ts`
- Hooks: `use-create-offer-mutation.ts`, `use-offer-creation-status-query.ts`, `use-seller-policies-query.ts`
- Components:
  - `CreateOfferWizard.tsx` — the drawer + 4 steps
  - `create-offer-fields.schema.ts` — Zod schema
  - `OfferCreationStatusBadge.tsx` — maps status → `StatusBadge` tone
  - `OfferCreationErrorList.tsx` — renders `OfferCreationError[]`
  - `OfferCreationTracker.tsx` — inline polling card on the listings list page
- Page wiring: "Create offer" button on `listings-list-page.tsx`, tracker slot below toolbar

**Core vs Integration Justification**: Pure FE surface over existing API. No
CORE or integration code is touched.

---

## 4. External / Domain Research

### Backend contracts (authoritative)

| Endpoint | Method | DTO |
|---|---|---|
| `/listings/connections/:connectionId/offers` | `POST` 202 | req `CreateOfferDto`, res `CreateOfferResponseDto` |
| `/listings/connections/:connectionId/offers/creation/:offerCreationRecordId` | `GET` 200 | res `OfferCreationStatusResponseDto` |
| `/listings/connections/:connectionId/seller-policies` | `GET` 200 | res `SellerPoliciesResponseDto` |

### CreateOfferDto fields (backend validation)

- `internalVariantId: string` (required, regex `/^ol_variant_[a-f0-9]+$/`)
- `stock: number` (required integer ≥ 0)
- `publishImmediately: boolean` (required)
- `price?: { amount: number (>0); currency: string }` — *effectively required* for Allegro; see adapter analysis below
- `overrides?`:
  - `title?: string` (≤75 chars) — **effectively required** for Allegro
  - `description?: string | null`
  - `categoryId?: string` — **effectively required** for Allegro
  - `imageUrls?: string[] | null` — skipped in MVP UI
  - `platformParams?: Record<string, unknown>` (≤4 KB JSON) — carries seller-policy ids

### Allegro adapter `platformParams` keys (from `allegro-marketplace.adapter.ts:756-770`)

- `deliveryPolicyId` → `delivery.shippingRates.id`
- `returnPolicyId` → `afterSalesServices.returnPolicy.id`
- `warrantyId` → `afterSalesServices.warranty.id`
- `impliedWarrantyId` → `afterSalesServices.impliedWarranty.id`
- `handlingTime`, `invoice`, `parameters` — not exposed in wizard MVP

### OfferCreationStatus values (wire + type)

`'pending' | 'draft' | 'validating' | 'active' | 'failed'`.
Terminal statuses: `active`, `failed`. Non-terminal → keep polling.

### FE patterns we follow

- Drawer: same structure as `EditOfferDrawer.tsx` (backdrop + `role="dialog"`, `.drawer` classes)
- Wizard: same structure as `prestashop-setup-form.tsx` (`SetupStepper`, `useState(stepIndex)`, per-step `form.trigger()`, `goNext` / `goBack`)
- API/hooks: thin `create*Api()` factory + `useMutation` / `useQuery` wrapper per feature
- Status badge: map status → existing `StatusBadge` tone via a lookup table
- Tests: `renderWithProviders` + `createMockApiClient` with per-test overrides

---

## 5. Questions & Assumptions

### Open Questions

1. **Category picker UX** — Allegro requires `categoryId` but there is no
   FE category-mapping endpoint yet. MVP: required free-text input with a
   description hint "Allegro category ID (e.g. `12345`)". Flag as
   follow-up issue.
2. **Stock source of truth for pre-fill** — `ProductVariant` has no stock
   field; inventory lives behind a separate `/inventory` endpoint. MVP:
   do not pre-fill stock; show a plain required integer input. Rationale:
   a variant-level inventory lookup is a second query per variant, and the
   operator is explicitly setting the marketplace stock (which may differ
   from master stock). Keep it explicit for MVP.
3. **Delivery policy required?** — Allegro API treats missing shipping
   policies as a validation error for most categories. We mark delivery
   policy as required in the form, the other three as optional, and let
   the backend return structured errors if additional ones are mandatory
   for a given category.

### Assumptions

- The wizard is **self-sufficient**: Step 1 opens with a connection picker
  (filtered to marketplace connections via `useConnectionsQuery`) so the
  operator can start the wizard from an unfiltered listings list. When the
  list page is already filtered by `connectionId`, that value is passed
  through as the default.
- `publishImmediately = false` (create as draft) is the safer default;
  the operator can flip the toggle explicitly.
- Currency default is `PLN` (matches `EditOfferDrawer` default).
- 5-second polling interval matches the issue spec and is low enough to
  feel responsive without hammering the API.
- The tracker lives only for the session (not persisted). Refresh loses
  in-flight trackers; that is acceptable — the record itself is
  persisted server-side and future tracking can be added via a dedicated
  "Recent creations" view.
- Client generates a stable `crypto.randomUUID()` **per wizard session**
  (on drawer open) and sends it via `x-idempotency-key`. Server retries
  and accidental double-submits de-duplicate to the same
  `OfferCreationRecord`. The key is reset only on successful submit or
  explicit cancel.

### Documentation Gaps

- None material. Plan references only existing docs and endpoints.

---

## 6. Proposed Implementation Plan

### Phase 1 — API + Types

1. **Extend `listings.types.ts`** with wire types mirroring the three DTOs.
   - **File**: `apps/web/src/features/listings/api/listings.types.ts`
   - **Action**: Add
     - `OfferCreationStatusValues` const array + `OfferCreationStatus` type
     - `OfferCreationError` interface
     - `CreateOfferPrice`, `CreateOfferOverrides`, `CreateOfferRequest` (camelCase wire shape)
     - `CreateOfferResponse` (`jobId`, `offerCreationRecordId`)
     - `OfferCreationStatusResponse`
     - `SellerPolicy`, `SellerPoliciesResponse`
   - **Acceptance**: Types match the backend DTOs 1:1; `pnpm type-check` passes.

2. **Extend `createListingsApi`** with the three new methods.
   - **File**: `apps/web/src/features/listings/api/listings.api.ts`
   - **Action**: Add to the `ListingsApi` interface and implementation:
     - `createOffer(connectionId, req, options?: { idempotencyKey?: string }) → Promise<CreateOfferResponse>` — POST JSON; when `idempotencyKey` is provided, send it as the `x-idempotency-key` header. Required for retry-safety — the backend controller reads this header and a missing key means every retry creates a duplicate record.
     - `getOfferCreationStatus(connectionId, recordId) → Promise<OfferCreationStatusResponse>`
     - `getSellerPolicies(connectionId) → Promise<SellerPoliciesResponse>`
   - **Acceptance**: Methods build the correct paths matching controller decorators; `createOffer` passes the idempotency header through.

3. **Update `listings.query-keys.ts`** with query-key factories.
   - **File**: `apps/web/src/features/listings/api/listings.query-keys.ts`
   - **Action**: Add
     - `offerCreationStatus(connectionId, recordId)`
     - `sellerPolicies(connectionId)`
   - **Acceptance**: Keys are stable tuples so `queryClient.invalidateQueries` works.

4. **Update `createMockApiClient`** in `test/test-utils.tsx` with default mock
   implementations for the three new methods (otherwise any test that uses
   the listings API without explicit overrides will break with `undefined is
   not a function`).
   - **File**: `apps/web/src/test/test-utils.tsx`
   - **Action**: Add defaults that either return a fully-shaped response or
     `null`, not a half-object with `/*...*/`:
     ```ts
     createOffer: vi.fn().mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' }),
     getOfferCreationStatus: vi.fn().mockResolvedValue(null), // force tests that care to override with a full-shape response
     getSellerPolicies: vi.fn().mockResolvedValue({ deliveryPolicies: [], returnPolicies: [], warranties: [], impliedWarranties: [] }),
     ```
     The `null` default mirrors the existing pattern for `listings.getById`
     and `inventory.getById`. Tests that exercise the tracker must
     explicitly mock a complete `OfferCreationStatusResponse`.
   - **Acceptance**: Existing listings tests still pass; new tests can override selectively.

### Phase 2 — Hooks

5. **`use-create-offer-mutation.ts`**
   - **File**: `apps/web/src/features/listings/hooks/use-create-offer-mutation.ts`
   - **Action**: `useMutation<CreateOfferResponse, Error, { connectionId; request; idempotencyKey }>`
     that calls `apiClient.listings.createOffer(connectionId, request, { idempotencyKey })`.
     On success, invalidate `listingsQueryKeys.all` so any newly-active
     offer appears in the list. The idempotency key is required on the
     input so callers cannot accidentally skip it.
   - **Acceptance**: Hook exported; dependent components compile; calling
     the mutation without an idempotency key is a TypeScript error.

6. **`use-offer-creation-status-query.ts`**
   - **File**: `apps/web/src/features/listings/hooks/use-offer-creation-status-query.ts`
   - **Action**: `useQuery` with:
     - `enabled: Boolean(connectionId && recordId)`
     - `refetchInterval: (query) => query.state.data && TERMINAL.includes(query.state.data.status) ? false : 5000`
     - `staleTime: 0` so refocus triggers a re-fetch
   - **Acceptance**: Stops polling on terminal status; re-fetches on focus.

7. **`use-seller-policies-query.ts`**
   - **File**: `apps/web/src/features/listings/hooks/use-seller-policies-query.ts`
   - **Action**: `useQuery` with `staleTime: 5 * 60 * 1000` (5 min; mirrors
     server-side 10-min cache but gives us a bit of safety margin). `enabled`
     gated on `connectionId`.
   - **Acceptance**: Re-used across wizard opens without re-fetching.

### Phase 3 — Zod schema

8. **`create-offer-fields.schema.ts`**
   - **File**: `apps/web/src/features/listings/components/create-offer-fields.schema.ts`
   - **Action**: Single schema covering all steps. `connectionId` is part
     of the form (set by the in-wizard picker in Step 1) so that
     connection selection is subject to the same validation /
     step-advancement logic as every other field:
     ```ts
     const schema = z.object({
       connectionId: z.string().min(1, 'Choose a connection'),
       internalVariantId: z.string().regex(/^ol_variant_[a-f0-9]+$/, 'Pick a variant'),
       variantLabel: z.string().optional(), // display only
       title: z.string().min(1, 'Title is required').max(75, 'Max 75 characters'),
       categoryId: z.string().min(1, 'Category ID is required'),
       priceAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid price'),
       priceCurrency: z.string().min(1),
       stock: z.coerce.number().int('Must be an integer').min(0, 'Must be 0 or greater'),
       description: z.string().optional(),
       publishImmediately: z.boolean(),
       deliveryPolicyId: z.string().min(1, 'Delivery policy is required'),
       returnPolicyId: z.string().optional(),
       warrantyId: z.string().optional(),
       impliedWarrantyId: z.string().optional(),
     });
     ```
   - **Acceptance**: `z.input` / `z.output` types exported.

### Phase 4 — Components

9. **`OfferCreationStatusBadge.tsx`**
   - **File**: `apps/web/src/features/listings/components/OfferCreationStatusBadge.tsx`
   - **Action**: Thin wrapper over `StatusBadge`. Mapping:
     - `pending` → `info` (dot)
     - `draft` → `review` (dot)
     - `validating` → `warning` (dot)
     - `active` → `success`
     - `failed` → `error`
   - **Acceptance**: Renders a labelled `StatusBadge`; unit test covers all 5 values.

10. **`OfferCreationErrorList.tsx`**
    - **File**: `apps/web/src/features/listings/components/OfferCreationErrorList.tsx`
    - **Action**: Renders `OfferCreationError[]` as a `dl` with `field` → `message`
      pairs, using `.mono-text` for field paths. If `field` missing, renders
      only code + message.
    - **Acceptance**: Unit test: renders all entries; renders nothing for
      empty array (returns `null`).

11. **`CreateOfferWizard.tsx`** — the main component
    - **File**: `apps/web/src/features/listings/components/CreateOfferWizard.tsx`
    - **Structure**:
      - Props: `{ isOpen, onClose, defaultConnectionId?, onSubmitted(recordId, connectionId) }`
        — `defaultConnectionId` is a hint from the list-page filter; the
        picker in Step 1 is always present so the wizard works from an
        unfiltered list too. `onSubmitted` returns both ids so the parent
        page can set the tracker URL params correctly.
      - Uses `.drawer` CSS (same as `EditOfferDrawer`)
      - `SetupStepper` at top with labels `['Connection & Variant', 'Offer details', 'Policies', 'Review']`
      - Single `useForm<CreateOfferFieldsValues>` with `zodResolver(createOfferFieldsSchema)`
      - Per-step field arrays + `goNext()` using `form.trigger(stepFields)`
      - Close/submit guard via `beforeunload` when `form.formState.isDirty`
      - **Idempotency key**: `const idempotencyKeyRef = useRef<string>()`.
        On drawer open (first `useEffect` firing with `isOpen=true`) set
        `idempotencyKeyRef.current = crypto.randomUUID()`. The same key is
        passed to the mutation on every submit attempt. Reset on
        successful submit (drawer will close anyway) or explicit cancel
        so the next session gets a new key.
    - **Step 1 — Connection & Variant**:
      - `useConnectionsQuery()` filtered to marketplace connections (initial
        client-side filter on `supportedCapabilities.includes('Marketplace')`
        or `platformType === 'allegro'`; when a broader backend filter
        lands this becomes a query param).
      - Render a native `<select>` / shared `Select` primitive of
        connections. Default to `defaultConnectionId` if provided.
      - `useProductsQuery({ search: debouncedSearch })` for product list
      - On product select, `useProductQuery(productId)` to fetch variants
      - Render a searchable list grouped by product; each row shows
        `product.name` / variant SKU / variant EAN / product.price
      - Clicking a variant sets `internalVariantId` and `variantLabel` in the form
      - Step-advance validation requires both `connectionId` and
        `internalVariantId`.
    - **Step 2 — Offer details**:
      - `title` (prefilled with `variantLabel` on step entry, editable, 75-char cap)
      - `categoryId` (required text input; help note about Allegro)
      - `priceAmount` + `priceCurrency` (defaults `PLN`, read-only currency per `EditOfferDrawer` precedent)
      - `stock` (required integer input, `type="number"`, `min=0`)
      - `publishImmediately` (checkbox, default false)
      - `description` (optional textarea)
    - **Step 3 — Policies**:
      - `useSellerPoliciesQuery(connectionId)`
      - Four `<select>` controls (via shared `Select` primitive) populated from the four grouped lists:
        - Delivery (required)
        - Return (optional, empty option "No return policy")
        - Warranty (optional)
        - Implied warranty (optional)
      - If all four lists are empty, show an `Alert tone="info"` "No seller policies available on this connection — the offer may fail validation" and allow skip
    - **Step 4 — Review**:
      - `dl.wizard-review-list` summary of all fields (reuse `.wizard-review-list` class)
    - **Submit**: maps form values → `CreateOfferRequest` and calls the
      mutation with `connectionId` + the ref-held `idempotencyKey`:
      ```ts
      mutation.mutateAsync({
        connectionId: values.connectionId,
        idempotencyKey: idempotencyKeyRef.current!,
        request: {
          internalVariantId: values.internalVariantId,
          stock: values.stock,
          publishImmediately: values.publishImmediately,
          price: { amount: Number(values.priceAmount), currency: values.priceCurrency },
          overrides: {
            title: values.title,
            categoryId: values.categoryId,
            description: values.description ?? null,
            platformParams: {
              deliveryPolicyId: values.deliveryPolicyId,
              ...(values.returnPolicyId && { returnPolicyId: values.returnPolicyId }),
              ...(values.warrantyId && { warrantyId: values.warrantyId }),
              ...(values.impliedWarrantyId && { impliedWarrantyId: values.impliedWarrantyId }),
            },
          },
        },
      });
      ```
      - On success: `showToast({ tone: 'success', title: 'Offer creation dispatched', description: 'Tracking status below.' })`, invoke `onSubmitted(offerCreationRecordId, values.connectionId)`, reset form + idempotency ref, call `onClose()`
      - On error: inline `Alert tone="error"` with server message; wizard stays open and **keeps the same idempotency key** so a retry resolves to the same record instead of creating a duplicate
    - **Acceptance**: Each step validates before advancing; review step renders chosen values; submit calls the mutation with a stable idempotency key within one wizard session; double-clicking Submit does not create a second record (mutation is debounced via `mutation.isPending` disabling the button).

12. **`OfferCreationTracker.tsx`** — post-submit inline card
    - **File**: `apps/web/src/features/listings/components/OfferCreationTracker.tsx`
    - **Props**: `{ connectionId, offerCreationRecordId, onDismiss }`
    - **Behaviour**:
      - Uses `useOfferCreationStatusQuery` with 5s polling
      - Renders `<OfferCreationStatusBadge>` + human label
      - On `failed`: renders `<OfferCreationErrorList>` + a "Dismiss" button
      - On `active`: renders a "View listing" link if `externalOfferId` is populated and auto-invalidates `listingsQueryKeys.all`; shows auto-dismiss after 10 s or explicit "Dismiss"
      - On non-terminal: shows a spinner icon and "Still processing…"
    - **Acceptance**: Status transitions reflected; invalidation on terminal success.

### Phase 5 — Page integration

13. **`listings-list-page.tsx`** — add CTA + tracker slot
    - **File**: `apps/web/src/pages/listings/listings-list-page.tsx`
    - **Action**:
      - Use URL search params `offerCreationRecordId` + `connectionId` to drive the tracker
      - Add `actions={<Button onClick={openWizard}>Create offer</Button>}` prop on `PageLayout`
      - On CTA click: open the drawer. Pass `filters.connectionId` as
        `defaultConnectionId` — the wizard's Step 1 connection picker
        will respect it when present and otherwise let the operator
        choose. **No pre-filter is required on the list page**; the
        wizard is self-sufficient.
      - On wizard submit (`onSubmitted(recordId, connectionId)`), set URL
        search params (`setSearchParams`) with both ids so the tracker
        survives across client-side navigation / accidental drawer close
      - Render `<OfferCreationTracker>` between toolbar and table when params present
    - **Acceptance**: CTA visible and always enabled; clicking opens the drawer regardless of current list filters; after submit, tracker renders with polling.

### Phase 6 — Tests

14. **Unit tests** (all new files get a `*.test.tsx` / `*.test.ts` sibling):
    - `OfferCreationStatusBadge.test.tsx` — 5 status mappings
    - `OfferCreationErrorList.test.tsx` — with field, without field, empty
    - `CreateOfferWizard.test.tsx` — at least:
      - renders closed → nothing
      - Step 1: cannot advance without both `connectionId` and `internalVariantId`
      - Step 1: `defaultConnectionId` prop pre-selects the picker
      - Step 2 validates title ≤75 chars
      - Step 2 validates price regex
      - Step 3 requires delivery policy (when policies are present)
      - Step 3 renders informational Alert when all four policy lists are empty and allows skip
      - submit calls `createOffer` with the correct mapped payload **and** forwards a stable `x-idempotency-key` that matches across repeated attempts within the same wizard session
      - submit success: toast shown, `onSubmitted(recordId, connectionId)` called, `onClose` called, idempotency ref reset
      - submit error: inline Alert, drawer stays open, same idempotency key used on retry (assert `createOffer` called twice with identical `idempotencyKey`)
      - Submit button disabled while `mutation.isPending` — double-click does not produce a second call
    - `OfferCreationTracker.test.tsx`:
      - polling continues for non-terminal (advance fake timers, assert second call)
      - polling stops on `active`, `listingsQueryKeys.all` invalidation fired
      - renders error list on `failed`
    - `use-offer-creation-status-query.test.ts` — focused test of the
      `refetchInterval` stop logic with fake timers
    - `listings-list-page.test.tsx` (augment existing) — three new cases:
      1. **CTA renders and is enabled** on the default (unfiltered) list view — no pre-filter is required
      2. **Tracker renders** when URL contains both `offerCreationRecordId` and `connectionId`
      3. **Tracker does not render** when only one of the two params is present (partial URL state)

### Phase 7 — Styling + manual verification

15. **CSS rules** — any new component-specific rules (variant-picker list
    rows, tracker card, policy-empty Alert) go into
    `apps/web/src/index.css` alongside the existing `.drawer`, `.wizard-*`
    blocks per `docs/frontend-ui-style-guide.md` §CSS Implementation
    Standard. No CSS modules, no styled-components. All colors route
    through the existing `--bg-*`, `--text-*`, `--border-*`, `--status-*`
    tokens.

16. **Manual responsive check** — before opening the PR, run
    `pnpm start:dev:web` and exercise the wizard at three viewport
    widths: 360 × 812, 768 × 1024, 1440 × 900. Verify:
    - Drawer slides cleanly at every width (no horizontal scroll)
    - `SetupStepper` collapses to "Step N of M" at ≤ 767 px
    - Step 1's connection/product pickers remain usable at 360 px
      (tap targets ≥ 44 px per style guide §Responsive)
    - Review step `dl.wizard-review-list` does not overflow
    Attach after-shots to the PR body.

### Implementation Details

**New files** (13 production + 6 test files plus augmentations):
- `features/listings/api/listings.types.ts` (augment)
- `features/listings/api/listings.api.ts` (augment)
- `features/listings/api/listings.query-keys.ts` (augment)
- `features/listings/hooks/use-create-offer-mutation.ts`
- `features/listings/hooks/use-offer-creation-status-query.ts` (+ `.test.ts`)
- `features/listings/hooks/use-seller-policies-query.ts`
- `features/listings/components/create-offer-fields.schema.ts`
- `features/listings/components/OfferCreationStatusBadge.tsx` (+ `.test.tsx`)
- `features/listings/components/OfferCreationErrorList.tsx` (+ `.test.tsx`)
- `features/listings/components/CreateOfferWizard.tsx` (+ `.test.tsx`)
- `features/listings/components/OfferCreationTracker.tsx` (+ `.test.tsx`)
- `pages/listings/listings-list-page.tsx` (augment)
- `pages/listings/listings-list-page.test.tsx` (augment — 3 new cases)
- `test/test-utils.tsx` (augment mock defaults)
- `index.css` (augment — new component-specific rules only, tokens only)

**Database Migrations**: None.

**Events**: None — consumes existing HTTP surface.

**Configuration Changes**: None.

**Error Handling**:
- API errors surface via `ApiError` → wizard shows inline `Alert`
- `failed` status renders errors via `OfferCreationErrorList`
- Retry-after-error is idempotency-safe: same `x-idempotency-key` is
  reused within a wizard session so the server returns the existing
  record instead of creating a duplicate
- No new domain exceptions introduced on the FE

**Follow-up issues to file before opening the PR** (tracked so MVP-scope
deferrals do not get lost):
1. Category picker to replace the free-text `categoryId` field
2. Backend lookup `externalOfferId → OfferCreationRecord` so
   `listing-detail-page.tsx` can surface creation status + errors
3. Shared `shared/ui/drawer.tsx` primitive that refactors both
   `EditOfferDrawer` and `CreateOfferWizard` onto it
4. Failed-state "Retry" affordance on `OfferCreationTracker`

**Reference**: [Engineering Standards — Project Structure](../engineering-standards.md#project-structure), [Frontend Architecture — Dependency Rules](../frontend-architecture.md#dependency-rules)

---

## 7. Alternatives Considered

### Alternative 1: Full-page route instead of drawer wizard
- **Description**: A dedicated `/listings/connections/:connectionId/offers/new` page
- **Why Rejected**: The issue explicitly asks for a side panel consistent with
  existing edit patterns. A full-page route also breaks the operator's listing
  context (filters, pagination). The drawer pattern reuses existing CSS and
  matches user expectations.
- **Trade-offs**: Full-page would give more room for a category picker and a
  richer description editor. Acceptable loss for MVP.

### Alternative 2: Server-driven form schema via an `adapters.getOfferSchema()` endpoint
- **Description**: The API returns the exact shape needed for a given adapter,
  including category picker data
- **Why Rejected**: No backend endpoint exists; out of scope. The adapter's
  `platformParams` shape is stable enough to hand-code for now.
- **Trade-offs**: Schema drift between FE and adapter. Mitigated by type-safe
  wire types and the adapter's structured validation errors.

### Alternative 3: Persist active trackers in `localStorage` across refresh
- **Description**: Survive refreshes so the tracker is resilient
- **Why Rejected**: Out of scope for MVP per issue; the URL-based approach
  already survives client-side nav. Adds complexity around stale records that
  were never actually enqueued.
- **Trade-offs**: Small UX regression on refresh; recoverable by a future
  "Recent creations" view.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Dependency direction (`pages → features → shared`) respected — nothing
  in `shared/` imports feature modules
- ✅ Transport types live in the feature (`features/listings/api/listings.types.ts`), not in `shared`
- ✅ No raw `fetch()` in components; all HTTP goes through the API client

### Naming Conventions
- ✅ Components `PascalCase.tsx`, hooks `use-*.ts`, schema colocated with component
- ✅ Tests `*.test.tsx`
- ✅ File headers on each new module (project convention)

### Existing Patterns
- ✅ Drawer structure matches `EditOfferDrawer.tsx`
- ✅ Wizard structure matches `prestashop-setup-form.tsx`
- ✅ Mutation + invalidation pattern matches `use-update-offer-fields.ts`
- ✅ Query-key factories match `listings.query-keys.ts` style

### Risks
- **Polling cost** — 5-second interval × many concurrent tracked records could hit the API. Mitigation: the tracker lives only while a record is non-terminal; terminal statuses stop polling; refreshing a page clears trackers. For MVP this is acceptable.
- **Allegro category requirement** — if the operator enters an invalid `categoryId`, the backend returns structured errors that already surface via `OfferCreationErrorList`. Risk is contained.
- **Seller-policies empty** — some connections return empty lists (no policies configured). The wizard shows an informational Alert and allows the operator to continue. The `failed` status path covers the resulting validation errors cleanly.
- **Mocking drift in tests** — adding three new methods to the mock without defaults would cascade into many failing tests. Mitigated by adding safe defaults in `createMockApiClient` (and using `null` for `getOfferCreationStatus` so tests that rely on a specific shape must override).
- **Duplicate records on retry** — without a client-side idempotency key, a double-submit or a retry after transient network failure would create two `OfferCreationRecord` rows (the server falls back to `randomUUID()` when no header is present). Mitigated by generating a stable `crypto.randomUUID()` on drawer open and reusing it until success or explicit cancel. Covered by unit tests.

### Edge Cases
- **Drawer closed mid-submit** — the mutation is awaited; the drawer stays open until the 202 returns, then resets and closes
- **Navigation away during polling** — the tracker unmounts; TanStack Query cancels the active request; polling stops
- **Variant has no SKU or EAN** — display falls back to `id` in the variant label
- **Product list empty for the current search** — show "No variants match" empty state inside Step 1

### Backward Compatibility
- ✅ Additive only; no changes to existing public APIs or routes

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `OfferCreationStatusBadge.test.tsx` — all 5 tones render
- `OfferCreationErrorList.test.tsx` — with/without field path, empty
- `CreateOfferWizard.test.tsx` — step gating, validation, submit mapping, success/error flows
- `OfferCreationTracker.test.tsx` — polling, terminal stop, failure render, success invalidation
- `use-offer-creation-status-query.test.ts` — refetchInterval stop condition
- Augmented `listings-list-page.test.tsx` — tracker renders when URL params present

### Integration Tests
- None in this slice. Integration coverage for the endpoint chain already exists in `apps/api` integration tests (offer-creation-enqueue service).

### Mocking Strategy
- Use `createMockApiClient({ listings: { createOffer, getOfferCreationStatus, getSellerPolicies, ... } })` pattern from existing tests
- Use `renderWithProviders` so TanStack Query + ToastProvider + ApiClientProvider are wired
- For polling tests, use Vitest's `vi.useFakeTimers()` + `vi.advanceTimersByTime(5000)` to deterministically advance the poll interval

### Acceptance Criteria (from issue #261)
- [ ] Operator can submit the wizard → tracker appears with `pending`/`draft`/`validating` badge
- [ ] Status auto-updates to `active` or `failed` without page refresh
- [ ] `failed` state shows Allegro field-level errors in human-readable form
- [ ] Wizard validates required fields (connection + variant + price + title + categoryId + delivery policy + stock) before enabling final submit
- [ ] Wizard is reachable from an unfiltered listings list — no pre-filter required
- [ ] Retrying submit after a transient failure reuses the same idempotency key (no duplicate records)
- [ ] Manually verified at 360 / 768 / 1440 px; after-shots attached to the PR
- [ ] `pnpm type-check` passes, `pnpm lint` passes, `pnpm test` passes
- [ ] Four follow-up issues filed (category picker, detail-page lookup, shared drawer primitive, tracker retry affordance)

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (FE-only; respects `pages → features → shared`)
- [x] Respects CORE vs Integration boundaries (no CORE/backend changes)
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered — client generates a stable `x-idempotency-key` per wizard session and reuses it across retries so duplicate records cannot be created
- [x] Event-driven patterns used where applicable (polling is the chosen mechanism per issue spec; SSE/WebSocket is a future enhancement)
- [x] Rate limits & retries addressed (TanStack Query retry disabled; 5s polling; terminal stop)
- [x] Error handling comprehensive (inline Alert + OfferCreationErrorList + toast)
- [x] Testing strategy complete (including idempotency, polling, and list-page CTA cases)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Testing Guide](../testing-guide.md)
