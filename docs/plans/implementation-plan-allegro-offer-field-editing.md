# Implementation Plan — Allegro Offer Field Editing (Issues #140 + #141)

## 1. Goal

Enable merchants to edit Allegro offer fields (price, title, description) from OpenLinker without logging into Allegro directly. Updates are async and dispatched as sync jobs.

**Layer classification:** Integration + CORE/Application + Interface (BE) · Frontend (FE)

**Non-goals:**
- Polling for Allegro PATCH command result (tracked separately in #102)
- Batch field editing
- Image editing
- Quantity field consolidation into this endpoint (keep existing `offerQuantity.update` job intact)

---

## 2. Architecture Overview

```
FE: EditOfferDrawer
  → POST /connections/:connectionId/offers/:offerId/fields
    → enqueues marketplace.offer.updateFields job
      → worker handler resolves externalId via IdentifierMappingService
        → AllegroMarketplaceAdapter.updateOfferFields()
          → PATCH /sale/product-offers/{externalOfferId}
```

---

## 3. Step-by-Step Implementation Plan

### BE Step 1 — Domain types
**File:** `libs/core/src/listings/domain/types/offer-update.types.ts`

Define:
```typescript
export interface AllegroDescriptionSection {
  items: Array<{ type: 'TEXT'; content: string }>;
}

export interface OfferFieldUpdate {
  price?: { amount: string; currency: string };
  title?: string;
  description?: { sections: AllegroDescriptionSection[] };
}
```

**Acceptance:** Types are in a `*.types.ts` file, no `any`, exported from listings barrel.

---

### BE Step 2 — Extend `MarketplacePort`
**File:** `libs/core/src/integrations/domain/ports/marketplace.port.ts`

Add optional method:
```typescript
updateOfferFields?(cmd: UpdateOfferFieldsCommand): Promise<void>;
```

**File:** `libs/core/src/integrations/domain/types/marketplace-quantity-update.types.ts` (or new `marketplace-offer-update.types.ts`)

Define:
```typescript
export interface UpdateOfferFieldsCommand {
  externalOfferId: string;
  fields: OfferFieldUpdate;
  idempotencyKey?: string;
}
```

**Acceptance:** Port compiles; all existing implementations unaffected (method is optional).

---

### BE Step 3 — Implement `updateOfferFields` in `AllegroMarketplaceAdapter`
**File:** `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts`

- Add `updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void>`
- Build Allegro PATCH payload from `cmd.fields` — only include keys present in input (partial update)
- Call `PATCH /sale/product-offers/{cmd.externalOfferId}` via `this.httpClient`
- Allegro PATCH payload shape:
  ```json
  {
    "sellingMode": { "price": { "amount": "...", "currency": "..." } },
    "name": "...",
    "description": { "sections": [...] }
  }
  ```
- Only include `sellingMode`, `name`, `description` keys when the corresponding field is present in `cmd.fields`
- No `any` types — define inline Allegro payload type or add to `allegro-api.types.ts`

**Unit tests:** `allegro-marketplace.adapter.spec.ts`
- `should send only price when only price field provided`
- `should send only title when only title field provided`
- `should send only description when only description field provided`
- `should send all fields when all fields provided`
- `should not call HTTP when fields object is empty` (guard)

---

### BE Step 4 — Job payload type
**File:** `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts`

Add:
```typescript
export interface MarketplaceOfferFieldUpdatePayloadV1 {
  schemaVersion: 1;
  offerId: string;          // internal OpenLinker offer ID
  fields: OfferFieldUpdate;
  idempotencyKey?: string;
}
```

Export from sync barrel.

---

### BE Step 5 — Worker handler
**File:** `apps/worker/src/sync/handlers/marketplace-offer-field-update.handler.ts`

Pattern mirrors `marketplace-offer-quantity-update.handler.ts`:
1. Validate payload (offerId required, at least one field present)
2. Resolve external offer ID: `identifierMapping.getExternalIds('Offer', payload.offerId)` — find the Allegro connection's external ID
3. Call `adapter.updateOfferFields({ externalOfferId, fields: payload.fields, idempotencyKey })`
4. Throw `SyncJobExecutionError` on failure

Register in `handler-registration.service.ts` under `'marketplace.offer.updateFields'`.

---

### BE Step 6 — Controller endpoint + DTOs
**File:** `apps/api/src/listings/http/dto/update-offer-fields.dto.ts`

```typescript
export class OfferPriceDto {
  @IsString() @IsNotEmpty() amount: string;
  @IsString() @IsNotEmpty() currency: string;
}

export class AllegroDescriptionSectionItemDto {
  @IsIn(['TEXT']) type: 'TEXT';
  @IsString() @IsNotEmpty() content: string;
}

export class AllegroDescriptionSectionDto {
  @IsArray() @ValidateNested({ each: true }) @Type(...)
  items: AllegroDescriptionSectionItemDto[];
}

export class OfferDescriptionDto {
  @IsArray() @ValidateNested({ each: true }) @Type(...)
  sections: AllegroDescriptionSectionDto[];
}

export class UpdateOfferFieldsDto {
  @IsOptional() @ValidateNested() @Type(...) price?: OfferPriceDto;
  @IsOptional() @IsString() @MaxLength(75) title?: string;
  @IsOptional() @ValidateNested() @Type(...) description?: OfferDescriptionDto;
  // Custom validator: at least one of price/title/description must be present
}
```

**File:** `apps/api/src/listings/http/listings.controller.ts`

Add endpoint:
```
POST /connections/:connectionId/offers/:offerId/fields
```
- `@UseGuards(JwtAuthGuard)` (already via `@Roles('admin')`)
- Validate `UpdateOfferFieldsDto`
- Enqueue `marketplace.offer.updateFields` job via `SyncJobService`
- Return `202 Accepted` with `{ jobId }`

**File:** `apps/api/src/listings/listings.module.ts` — import `SyncModule` if not already present.

---

### FE Step 7 — API client extension
**File:** `apps/web/src/features/listings/api/listings.api.ts`

Add method:
```typescript
updateOfferFields: (connectionId: string, offerId: string, fields: UpdateOfferFieldsPayload) => Promise<{ jobId: string }>
```

**File:** `apps/web/src/features/listings/api/listings.types.ts`

Add:
```typescript
export interface UpdateOfferFieldsPayload {
  price?: { amount: string; currency: string };
  title?: string;
  description?: { sections: Array<{ items: Array<{ type: 'TEXT'; content: string }> }> };
}

export interface UpdateOfferFieldsResult {
  jobId: string;
}
```

---

### FE Step 8 — Mutation hook
**File:** `apps/web/src/features/listings/hooks/use-update-offer-fields.ts`

```typescript
export function useUpdateOfferFields() {
  return useMutation({ ... });
}
```

Uses `apiClient.listings.updateOfferFields(...)`. No optimistic update.

---

### FE Step 9 — `EditOfferDrawer` component
**File:** `apps/web/src/features/listings/components/EditOfferDrawer.tsx`

- Props: `{ isOpen: boolean; onClose: () => void; mapping: OfferMapping }`
- `useForm` with Zod schema validating title (max 75), price.amount (positive, ≤2 decimals), description
- Only dirty fields included in payload (watch form state)
- Save button disabled when pristine or invalid
- On submit: calls mutation, shows loading state
- On `202`: success toast + close drawer
- On error: inline error alert inside drawer (do not close)
- Currency read-only (not in form — display only from existing mapping context if available)
- Description: single `<textarea>` rendered as structured single-text-section; note shown below

**File:** `apps/web/src/features/listings/components/OfferDescriptionEditor.tsx`

- Simple `<textarea>` for the text content of a single section
- Shows note: "Allegro formats description as structured sections. Only text content is supported here."

No existing Drawer shared component — implement as a `<dialog>` element or side-panel `<div>` with `role="dialog"` aria attributes, following the existing modal pattern from `confirm-dialog.tsx`.

---

### FE Step 10 — Wire into `ListingDetailPage`
**File:** `apps/web/src/pages/listings/listing-detail-page.tsx`

- Add `useState` for drawer open/close
- Add "Edit offer" `<Button>` in page actions (only when `mapping.platformType === 'Allegro'`)
- Render `<EditOfferDrawer>` conditionally

---

### FE Step 11 — Tests
**Files:**
- `apps/web/src/features/listings/components/EditOfferDrawer.test.tsx`

Covers:
- Drawer renders with title/price/description fields
- Save button disabled when form is pristine
- Zod validation shows inline errors (title too long, invalid price)
- Submit success: toast shown, drawer closed
- Submit error: inline error shown, drawer stays open
- Only dirty fields included in payload (mock mutation, inspect call args)

---

## 4. Key Files Summary

| Component | File |
|---|---|
| Domain types | `libs/core/src/listings/domain/types/offer-update.types.ts` |
| MarketplacePort extension | `libs/core/src/integrations/domain/ports/marketplace.port.ts` |
| UpdateOfferFieldsCommand | `libs/core/src/integrations/domain/types/marketplace-offer-update.types.ts` |
| Allegro adapter impl | `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts` |
| Job payload type | `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts` |
| Worker handler | `apps/worker/src/sync/handlers/marketplace-offer-field-update.handler.ts` |
| Handler registration | `apps/worker/src/sync/handlers/handler-registration.service.ts` |
| Request DTOs | `apps/api/src/listings/http/dto/update-offer-fields.dto.ts` |
| Listings controller | `apps/api/src/listings/http/listings.controller.ts` |
| FE API client | `apps/web/src/features/listings/api/listings.api.ts` |
| FE types | `apps/web/src/features/listings/api/listings.types.ts` |
| Mutation hook | `apps/web/src/features/listings/hooks/use-update-offer-fields.ts` |
| EditOfferDrawer | `apps/web/src/features/listings/components/EditOfferDrawer.tsx` |
| OfferDescriptionEditor | `apps/web/src/features/listings/components/OfferDescriptionEditor.tsx` |
| Detail page | `apps/web/src/pages/listings/listing-detail-page.tsx` |

## 5. Risks & Open Questions

- **Allegro PATCH shape:** The exact Allegro `PATCH /sale/product-offers/{offerId}` payload needs verification against the Allegro API docs — particularly whether `sellingMode.price` or a top-level `price` key is used. The adapter unit tests mock the HTTP client so this is safe to iterate.
- **Currency source:** The issue specifies currency as read-only in the FE. The `OfferMapping` context may not include current price/currency. For MVP, currency defaults to `PLN` or is left for the user to provide alongside the amount.
- **No migration needed:** No new ORM entities or DB tables are introduced.
- **`at least one field` validation:** Implemented via a custom class-validator decorator on `UpdateOfferFieldsDto`.
