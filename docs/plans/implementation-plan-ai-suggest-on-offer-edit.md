# Implementation plan — AI suggest on offer-edit drawer (#485)

## 1. Goal

Wire the existing `SuggestionDialog` into `EditOfferDrawer` so operators on `/listings/{offerId}` can generate an AI description for the per-offer Description textarea without round-tripping through the product editor. The suggestion writes to the offer-local `descriptionText` form field; the existing Save flow pushes only that offer (no `ProductContentField` mutation, no fan-out to other channels).

**Layers**: Frontend (FE feature module) + small Interface-layer additive change (BE controller enriches the existing detail response with `linkedProductId`).

**Non-goals**
- Per-offer prompt templates. The existing `offer.description.suggest` template already supports per-channel rendering.
- AI suggestions for fields other than description (title, parameters).
- Mobile / tablet layout tuning for the drawer.
- New BE port / capability changes — capability ports unchanged.

## 2. Codebase research

### BE
- `OfferMapping` is an `IdentifierMapping` row where `entityType = 'Offer'`, `internalId = ol_variant_*` (the linked variant), `externalId = the marketplace offer id`. Confirmed by the DTO's own description (`apps/api/src/listings/http/dto/offer-mapping-response.dto.ts:19`: "Internal ID (linked variant ID)").
- Variant→product resolution: `ProductVariantRepositoryPort.findById(id)` returns a `ProductVariant` with a `productId` field. Used in `OfferBuilderService.ts:80` (`productMaster.getProduct(variant.productId)`) — well-established pattern.
- The detail endpoint `GET /listings/:id` (`listings.controller.ts:117-145`) already does one enrichment round-trip (offer-creation status). Adding a second variant-lookup round-trip is consistent with the existing shape.
- `PRODUCT_VARIANT_REPOSITORY_TOKEN` exported from `@openlinker/core/products`. To inject it, the listings controller needs `ProductsModule` imported in `apps/api/src/listings/listings.module.ts`.

### FE
- `SuggestionDialog` (`apps/web/src/features/content/components/suggestion-dialog.tsx`) is already generic: `{ productId, channel, disabled?, onApply }`. Renders its own trigger button + modal; calls `useSuggestContentMutation`. **Reusable as-is** — no extraction needed.
- `PromptTemplateChannel` is `'prestashop' | 'allegro'` (closed union, `apps/web/src/features/content/api/content.types.ts:14-15`). `OfferMapping.platformType` is a free string. Need a runtime narrow.
- `EditOfferDrawer` (`apps/web/src/features/listings/components/EditOfferDrawer.tsx`) uses React Hook Form. To set the description field after applying a suggestion: `form.setValue('descriptionText', suggestion, { shouldDirty: true })`.
- Existing test file exists (`EditOfferDrawer.test.tsx`) with 8 cases — the established `renderWithProviders` + `createMockApiClient` pattern.

### Open questions (resolved)
- **Where to render the warning copy?** The dialog already renders inside a Dialog with its own Description slot. Adding a `scopeWarning?: ReactNode` prop to `SuggestionDialog` is the cleanest seam — it puts the warning where the operator actually sees it (inside the dialog), and keeps EditOfferDrawer free of dialog-internal copy. Alternative (inline above the trigger button) was considered but loses visibility once the dialog opens. **Going with prop.**
- **Product link target.** When a `productId` is available, the warning ends with a deep link to `/products/{productId}` so operators who realise they wanted master-level can jump there.

## 3. Design

### BE — add `linkedProductId` to the offer-mapping detail response

```ts
// apps/api/src/listings/http/dto/offer-mapping-response.dto.ts
@ApiPropertyOptional({
  nullable: true,
  description:
    'Internal product ID linked to this offer, resolved from the variant ' +
    '(internalId → variant → product). Populated only by `GET /listings/:id` ' +
    'for `entityType=Offer` mappings whose linked variant is still findable. ' +
    'Absent on list responses (no per-row variant lookup) and on synced-in ' +
    'offers whose variant has been deleted.',
})
linkedProductId?: string | null;
```

```ts
// apps/api/src/listings/http/listings.controller.ts (getOfferMapping enrichment)
if (mapping.entityType === ('Offer' satisfies EntityType)) {
  // existing OfferCreationRecord enrichment...

  // #485: surface the linked product so the FE can drive the AI-suggest
  // affordance without a second round-trip. The variant lookup is on the
  // hot path of the offer-detail page (always one fetch); the per-page
  // cost is one extra DB read scoped to a single primary-key lookup.
  const variant = await this.productVariantRepository.findById(mapping.internalId);
  if (variant) {
    dto.linkedProductId = variant.productId;
  }
}
```

```ts
// apps/api/src/listings/listings.module.ts
imports: [CoreListingsModule, CoreSyncModule, CoreIntegrationsModule, CoreProductsModule],
```

### FE — wire `SuggestionDialog` into `EditOfferDrawer`

Add `linkedProductId?: string | null` to the FE `OfferMapping` interface (mirror the BE change).

Add an optional `scopeWarning?: ReactNode` prop to `SuggestionDialog` so EditOfferDrawer can inject the per-offer scope copy without coupling the dialog to listing-domain knowledge:

```ts
// apps/web/src/features/content/components/suggestion-dialog.tsx
interface SuggestionDialogProps {
  productId: string;
  channel: PromptTemplateChannel | null;
  disabled?: boolean;
  onApply: (suggestion: string) => void;
  /**
   * Optional inline copy shown inside the dialog body, below the description.
   * Used by the offer-edit drawer (#485) to clarify the per-offer write scope.
   */
  scopeWarning?: ReactNode;
}
```

Renders inside the dialog body, above the Tone/Extra fields:

```tsx
{scopeWarning ? <div className="content-suggestion__scope-warning">{scopeWarning}</div> : null}
```

Inside `EditOfferDrawer`:

```tsx
const allegroChannel: PromptTemplateChannel | null =
  mapping.platformType === 'allegro' || mapping.platformType === 'prestashop'
    ? mapping.platformType
    : null;

const canSuggest = mapping.linkedProductId != null && allegroChannel !== null;
const suggestDisabledReason = !mapping.linkedProductId
  ? 'Link this offer to a product first to use AI suggestions'
  : allegroChannel === null
    ? `AI suggestions are not available for the ${mapping.platformType} platform yet`
    : null;

const handleApplySuggestion = useCallback(
  (suggestion: string) => {
    form.setValue('descriptionText', suggestion, { shouldDirty: true, shouldValidate: true });
  },
  [form],
);
```

Render next to the Description label inside `FormField`'s `description` slot — the dialog renders its own trigger button, so consumers just place `<SuggestionDialog>` where they want the trigger to appear:

```tsx
<FormField
  label="Description"
  name="descriptionText"
  description={
    canSuggest ? (
      <SuggestionDialog
        productId={mapping.linkedProductId!}
        channel={allegroChannel!}
        onApply={handleApplySuggestion}
        scopeWarning={
          <>
            Writes directly to this {mapping.platformType} offer.{' '}
            <Link to={`/products/${mapping.linkedProductId}`}>Open the product editor</Link>{' '}
            to update the master and fan out to all channels.
          </>
        }
      />
    ) : suggestDisabledReason ? (
      <span className="form-field__hint" title={suggestDisabledReason}>
        AI suggest unavailable — {suggestDisabledReason}.
      </span>
    ) : null
  }
  error={form.formState.errors.descriptionText?.message}
>
  ...
</FormField>
```

Note: `FormField`'s `description` slot today takes `string | undefined`. Need to confirm it accepts `ReactNode`; if not, render the dialog/hint outside the FormField as a sibling element above the textarea. (Will verify during implementation.)

### Architecture validation
- BE: variant lookup uses the existing `ProductVariantRepositoryPort` via Symbol token — no port-contract change. Only the controller and DTO grow a field.
- FE: `EditOfferDrawer` (in `features/listings/`) imports `SuggestionDialog` (from `features/content/`). That's a cross-feature import. Frontend-architecture.md "Dependency Rules" requires `features → shared`, but doesn't explicitly forbid `features → features`. **Risk to flag** — see §6.

## 4. Step-by-step plan

### Step 1 — BE: extend DTO with `linkedProductId`
**File**: `apps/api/src/listings/http/dto/offer-mapping-response.dto.ts`
- Add `@ApiPropertyOptional` field `linkedProductId?: string | null` with the docstring documenting the variant-lookup origin.

**Acceptance**: type-check green.

### Step 2 — BE: import `CoreProductsModule` in the listings API module
**File**: `apps/api/src/listings/listings.module.ts`
- Add `CoreProductsModule` to imports so `PRODUCT_VARIANT_REPOSITORY_TOKEN` is resolvable.

**Acceptance**: API boots without DI errors.

### Step 3 — BE: enrich `getOfferMapping` with `linkedProductId`
**File**: `apps/api/src/listings/http/listings.controller.ts`
- Inject `ProductVariantRepositoryPort` via `@Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)`.
- Inside the existing `entityType === 'Offer'` branch, after the `offerCreation` enrichment, look up the variant and set `dto.linkedProductId = variant.productId` when found.

**Acceptance**: existing controller spec passes; new test case asserts `linkedProductId` present when variant exists, `null`/absent when missing.

### Step 4 — BE: extend controller spec
**File**: `apps/api/src/listings/http/listings.controller.spec.ts`
- Two new cases inside the existing `getOfferMapping` describe block:
  - `should populate linkedProductId from the linked variant for Offer mappings`
  - `should leave linkedProductId absent when the linked variant is missing`
- Mock `ProductVariantRepositoryPort.findById`.

**Acceptance**: 2 new cases green; existing 4 cases still pass.

### Step 5 — FE: extend `OfferMapping` type
**File**: `apps/web/src/features/listings/api/listings.types.ts`
- Add `linkedProductId?: string | null` to `OfferMapping` with a docstring matching the BE DTO.

**Acceptance**: type-check green.

### Step 6 — FE: extend `SuggestionDialog` with `scopeWarning` prop
**File**: `apps/web/src/features/content/components/suggestion-dialog.tsx`
- Add optional `scopeWarning?: ReactNode` prop.
- Render inside dialog body above the Tone field (inside the `.content-suggestion__body` div).

**File**: `apps/web/src/index.css`
- Add `.content-suggestion__scope-warning` — small note styling (token-driven, mirrors `--text-secondary` font-size 0.8125rem with `--bg-surface-muted` background and `0.75rem` padding).

**Acceptance**: existing `suggestion-dialog.test.tsx` passes unchanged; new prop is purely additive.

### Step 7 — FE: render `SuggestionDialog` inside `EditOfferDrawer`
**File**: `apps/web/src/features/listings/components/EditOfferDrawer.tsx`
- Import `SuggestionDialog`, `PromptTemplateChannel`, `Link` from `react-router-dom`.
- Compute `allegroChannel` (typed channel narrow), `canSuggest`, and `suggestDisabledReason`.
- Define `handleApplySuggestion` callback that calls `form.setValue('descriptionText', suggestion, { shouldDirty: true, shouldValidate: true })`.
- Render the dialog (or disabled-hint span) above the description textarea — likely between the FormField label and the textarea, or as a sibling div before the FormField.

**Acceptance**: lint + type-check green; visual verification in dev that the trigger appears next to the Description label.

### Step 8 — FE: tests for the suggest path
**File**: `apps/web/src/features/listings/components/EditOfferDrawer.test.tsx`
- 4 new cases:
  - `should render the AI suggest button when the offer has a linked product`
  - `should render the disabled-hint instead when linkedProductId is null`
  - `should populate descriptionText and dirty the form when a suggestion is applied`
  - `should render the per-offer scope warning copy with a link to the product editor`
- Use the existing `createMockApiClient` to mock `content.suggest`.

**Acceptance**: 4 new cases green; existing 8 pass unchanged.

### Step 9 — quality gate

```
pnpm --filter @openlinker/api lint && type-check && test
pnpm --filter @openlinker/web lint && type-check && test
pnpm --filter @openlinker/api migration:show   # confirm no migrations needed
```

All green. No new migration (no schema change).

## 5. Validation

- **Architecture (BE)**: New field on the existing detail DTO; new variant lookup uses the existing port via the Symbol token. No new ports / capabilities. Hexagonal boundary preserved.
- **Architecture (FE)**: `EditOfferDrawer` (features/listings) imports `SuggestionDialog` (features/content). See §6 risk note.
- **Naming (BE)**: `linkedProductId` (camelCase) matches existing field naming in the DTO.
- **Naming (FE)**: same field name on the `OfferMapping` interface — wire-shape parity.
- **Tests**: BE +2, FE +4 — covers the happy path, the disabled-when-no-product branch, the apply-populates-and-dirties branch, and the scope-warning copy.
- **Security**: No secrets, no auth duplication, no XSS (the `scopeWarning` is React-rendered from typed props, not from user input). Same-origin route link.
- **No backend port changes.** No new dependencies.

## 6. Risks & open questions

- **Cross-feature import on FE.** `features/listings/EditOfferDrawer.tsx` imports `features/content/components/suggestion-dialog.tsx`. Frontend-architecture.md "Dependency Rules" only documents `app → pages → features → shared`, not `features → features`. Looking at the existing codebase, cross-feature imports are common where a primitive belongs to one feature but is consumed by another (e.g., the EntityLabel resolver consumes connections/customers feature queries). I'll proceed with the direct import; if lint flags it, we'll relocate `SuggestionDialog` to `shared/ui/` as a follow-up. Flagging now to set expectations.
- **`FormField.description` may not accept `ReactNode`.** If it's `string`-only, the SuggestionDialog renders as a sibling above the textarea (inside the FormField wrapper, above the control). This is a verify-during-implementation detail, not a blocker.
- **Scope warning visibility.** The plan puts the warning inside the dialog body. Operators who never click Suggest never see the warning — but they also don't trigger the per-offer write, so the warning has no audience there. If feedback says we want a permanent inline note next to the trigger as well, that's a follow-up.
- **`platformType` narrowing.** Today only `'allegro'` is a real offer-source platform; `'prestashop'` is a shop, not an offer publisher. The narrow accepts both for forward-compat with the typed `PromptTemplateChannel`, but in practice only `'allegro'` will trigger the suggest button on this surface.
