# Implementation Plan — `OfferLinkingService` cleanup

**Issue:** #665 — [TECH-DEBT] `OfferLinkingService` — extract types, add service interface
**Branch:** `665-offer-linking-cleanup`
**Layer:** CORE / Application (`libs/core/src/listings/application/`)
**Owner:** Piotr Swierzy

---

## 1. Goal

Bring `OfferLinkingService` into line with the two engineering-standards rules it currently drifts from:

- **Inline types** (lines 12, 14-19, 21-26 of `offer-linking.service.ts`) violate `docs/engineering-standards.md` § _Type Definitions in Separate Files_.
- **No service interface** (no `implements I*Service`) violates § _Service Interface Implementation_.

The issue body confirms this is the **only** instance of either pattern remaining in the repo; the other 37 application services already follow the convention. Cheap to fix, high consistency signal before going public.

### Non-goals

- No public API change. `linkOffer(item, lookups)` signature is preserved exactly.
- No caller refactoring beyond rerouting the now-relocated type imports — `OfferMappingSyncService` keeps injecting the concrete `OfferLinkingService` class (matching every other service-to-service composition in this context).
- Not touching the misplaced `offer-mapping-sync.service.interface.ts` (it lives in `services/` instead of `interfaces/` — separate cleanup, out of scope for #665).
- No new tests; existing unit spec already covers the surface and continues to pass unchanged.

---

## 2. Canonical pattern (verified from in-context precedent)

`CategoryResolutionService` is the textbook example in the same package. The pattern it follows:

1. **Types** at `application/types/<name>.types.ts` — runtime arrays (`*Values as const`) + derived union types + input/result interfaces.
2. **Interface** at `application/interfaces/<name>.service.interface.ts` — `I<Name>Service` with method signatures, imports types from sibling `../types/`.
3. **Service** at `application/services/<name>.service.ts` — `class XService implements IXService`, imports both.
4. **Main barrel** `libs/core/src/listings/index.ts` re-exports the interface + types (type-only) and the `*Values` arrays (value). The service class itself is excluded from the main barrel and lives only on the `services/` sub-barrel (#359 purity rule, enforced by `__tests__/barrel-purity.spec.ts`).

Five other services in this context (`category-resolution`, `offer-builder`, `offer-creation-enqueue`, `offer-creation-execution`, `offer-status-poll`, `seller-policies`) already conform. `OfferLinkingService` is the lone exception.

---

## 3. Step-by-step

### Step 3.1 — Create `application/types/offer-linking.types.ts`

Move the three inline declarations out of the service file. Convert `OfferLinkMethod` from a bare inline union to the canonical `as const` + union pair so it carries a runtime array (per engineering-standards.md § _Union Types: `as const` Pattern_).

```ts
/**
 * Offer Linking Types
 *
 * Public types for the offer-linking application service: link methods,
 * the per-batch lookup tables, and the per-offer linking result.
 *
 * @module libs/core/src/listings/application/types
 */

/**
 * Offer-link method values
 *
 * Ordered as the linking fallback chain in `OfferLinkingService.linkOffer`:
 * externalRef → sku → ean → gtin.
 */
export const OfferLinkMethodValues = ['externalRef', 'sku', 'ean', 'gtin'] as const;

/**
 * Offer-link method type
 *
 * Derived union from `OfferLinkMethodValues`.
 */
export type OfferLinkMethod = (typeof OfferLinkMethodValues)[number];

/**
 * Pre-built per-batch lookup tables passed to `OfferLinkingService.linkOffer`.
 *
 * Map values: variant id when uniquely matched, `null` when ambiguous (multiple
 * candidates), `undefined` (absent key) when no candidate exists.
 */
export interface OfferLinkingLookups {
  externalRefToVariantId: Map<string, string | null>;
  skuToVariantId: Map<string, string | null>;
  eanToVariantId: Map<string, string | null>;
  gtinToVariantId: Map<string, string | null>;
}

/**
 * Per-offer linking outcome.
 */
export interface OfferLinkingResult {
  status: 'linked' | 'skipped';
  internalVariantId?: string;
  linkMethod?: OfferLinkMethod;
  reason?: string;
}
```

### Step 3.2 — Create `application/interfaces/offer-linking.service.interface.ts`

Mirror the `ICategoryResolutionService` shape exactly. Import `OfferFeedItem` via the relative path to its declaration site (`../../domain/types/offer-feed.types`) — depth = `../..`, within engineering-standards.md § _Import Aliases_ rule 1, and matches the canonical in-context precedent (`ICategoryResolutionService` uses only relative imports to sibling `../types/` files; it does not self-reference the package barrel).

```ts
/**
 * Offer Linking Service Interface
 *
 * Contract for deterministic linking of marketplace offers to internal
 * sellable items (product variants) via a fallback chain: externalRef →
 * sku → ean → gtin.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import { OfferFeedItem } from '../../domain/types/offer-feed.types';
import { OfferLinkingLookups, OfferLinkingResult } from '../types/offer-linking.types';

export interface IOfferLinkingService {
  /**
   * Resolve a single offer to an internal variant using the pre-built lookup
   * tables. Returns `'linked'` with the variant id and the matching method,
   * or `'skipped'` with a reason (ambiguous lookup or no deterministic match).
   */
  linkOffer(item: OfferFeedItem, lookups: OfferLinkingLookups): OfferLinkingResult;
}
```

### Step 3.3 — Update `application/services/offer-linking.service.ts`

Delete the inline declarations (lines 12-26), import from the new files, declare `implements IOfferLinkingService`. Body unchanged.

```ts
/**
 * Offer Linking Service
 *
 * Deterministically links marketplace offers to internal sellable items (variants).
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferLinkingService}
 */
import { Injectable } from '@nestjs/common';
import { OfferFeedItem } from '@openlinker/core/listings';
import { normalizeBarcode as normalizeBarcodeValue, normalizeToEan13 } from '@openlinker/core/products';
import { IOfferLinkingService } from '../interfaces/offer-linking.service.interface';
import { OfferLinkingLookups, OfferLinkingResult } from '../types/offer-linking.types';

@Injectable()
export class OfferLinkingService implements IOfferLinkingService {
  linkOffer(item: OfferFeedItem, lookups: OfferLinkingLookups): OfferLinkingResult {
    // … (existing body unchanged)
  }

  // private helpers unchanged
}
```

### Step 3.4 — Update import paths in callers

Two callers value/type-import `OfferLinkingLookups` from the service file. Reroute to the new types module.

- `application/services/offer-mapping-sync.service.ts:29-30`:
  ```diff
  -import {
  -  OfferLinkingService,
  -  OfferLinkingLookups,
  -} from './offer-linking.service';
  +import { OfferLinkingService } from './offer-linking.service';
  +import { OfferLinkingLookups } from '../types/offer-linking.types';
  ```

- `application/services/__tests__/offer-linking.service.spec.ts:6`:
  ```diff
  -import { OfferLinkingService, OfferLinkingLookups } from '../offer-linking.service';
  +import { OfferLinkingService } from '../offer-linking.service';
  +import { OfferLinkingLookups } from '../../types/offer-linking.types';
  ```

`offer-mapping-sync.service.spec.ts` only imports `OfferLinkingService` (the class) — no change needed.

### Step 3.5 — Re-export the new interface + types from the main barrel

`libs/core/src/listings/index.ts` already re-exports interface + types for `ICategoryResolutionService`, `IOfferMappingSyncService`, and others. Add equivalent re-exports for the offer-linking surface so cross-context consumers can type against it without reaching into internals.

```ts
export type { IOfferLinkingService } from './application/interfaces/offer-linking.service.interface';
export type {
  OfferLinkMethod,
  OfferLinkingLookups,
  OfferLinkingResult,
} from './application/types/offer-linking.types';
export { OfferLinkMethodValues } from './application/types/offer-linking.types';
```

The service class itself stays off the main barrel (already exported via `services/index.ts` per #359 purity rule).

### Step 3.6 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

Plus the barrel-purity spec (`libs/core/src/listings/__tests__/barrel-purity.spec.ts`) — should continue to pass; we're not adding the service class to the main barrel.

---

## 4. Validation

### 4.1 Architecture

- ✅ No layer boundary touched. Types stay in `application/types/`; interface stays in `application/interfaces/`; service stays in `application/services/`.
- ✅ Dependency direction preserved: service → interface → types. Interface depends on `@openlinker/core/listings` (for `OfferFeedItem`) — same pattern as other in-context interfaces.
- ✅ #359 purity rule preserved (service class not added to main barrel).

### 4.2 Naming

- ✅ `OfferLinkMethodValues` + `OfferLinkMethod` follow the engineering-standards `*Values` / `*` convention verbatim.
- ✅ `IOfferLinkingService` matches the `I<Purpose>Service` naming standard.
- ✅ File names match the `*.types.ts` / `*.service.interface.ts` / `*.service.ts` patterns.

### 4.3 Testing

- Existing unit spec at `offer-linking.service.spec.ts` covers all five branches (externalRef hit/ambiguous, sku hit, ean hit, no-match skip). After the import-path swap in step 3.4, the spec passes unchanged.
- No new tests needed — this is a relocate-and-extract refactor, not a behavior change.

### 4.4 Public-API surface

- Service constructor unchanged (no args).
- `linkOffer(item, lookups)` signature unchanged.
- Type names (`OfferLinkMethod`, `OfferLinkingLookups`, `OfferLinkingResult`) preserved.
- New surface added: `OfferLinkMethodValues` runtime array, `IOfferLinkingService` interface — both pure additions.

### 4.5 DI / Module binding

No module change needed. `listings.module.ts:83-86` already binds `OFFER_LINKING_SERVICE_TOKEN` via `useExisting: OfferLinkingService`. The `useExisting` provider resolves structurally — after the migration the concrete class implements `IOfferLinkingService`, and any consumer injecting via the token (today none; the token is declared and bound but no `@Inject(OFFER_LINKING_SERVICE_TOKEN)` call sites exist) gets something assignable to the interface. The token's binding contract is unchanged.

### 4.5 Open questions

None. The pattern is unambiguous and the canonical precedent (`CategoryResolutionService`) is in the same directory.

---

## 5. Acceptance checklist (from issue #665)

- [ ] No inline `export type` / `export interface` declarations remain in `offer-linking.service.ts`.
- [ ] `IOfferLinkingService` exists in `application/interfaces/offer-linking.service.interface.ts`; `OfferLinkingService implements IOfferLinkingService`.
- [ ] Existing callers and tests work without signature changes (`OfferMappingSyncService` and both spec files compile + pass).
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass.
- [ ] **Scope addition**: `OfferLinkMethod` inline union converted to `as const` + union (issue body's action 1 calls for "Convert the method union to `as const` + union if not already").
- [ ] **Scope addition**: Main barrel re-exports the new interface + types + runtime array, matching the in-context precedent for other application services.
