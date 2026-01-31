# Developer Task

## Description

`marketplace.order.sync` currently fails with `MissingOrderItemMappingError` because `OrderItemRefResolver` expects an existing `identifier_mappings` row for `entityType='Offer'` where:

* `externalId = <allegroOfferId>` (from `IncomingOrderItem.productRef`)
* `internalId = <internal sellable item id>` (prefer internal **variant** / inventory item id)
* scoped by `connectionId` (+ `platformType`)

In production there is **no flow** that populates `identifier_mappings(entityType='Offer')` (tests seed it), so order sync breaks for real data.

**Goal:** Implement a production-safe pipeline that populates Offer mappings **before** order sync runs, without creating mappings inside the order sync hot path.

> Out of scope for this task: Ops/admin endpoints/UI for manual linking/requeue.

## Tasks

* [ ] **DB hardening (required):** add uniqueness + indexes for `identifier_mappings` to make Offer mapping creation safe and performant:

  * [ ] Add UNIQUE constraint on `(entityType, connectionId, externalId)`
    *(Optionally include `platformType` too, but `connectionId` usually scopes platform already — choose one and apply consistently.)*
  * [ ] Add INDEX on `(entityType, connectionId, internalId)` for reverse lookups (needed for inventory propagation later).
  * [ ] Ensure there is **no uniqueness constraint** on `(entityType, internalId)` (multiple offers can map to same internal item).
* [ ] **Core contract:** extend marketplace capability to support offer discovery (generic design, Allegro implementation first):

  * [ ] Add new types: `MarketplaceOfferFeedInput/Item/Output` under `libs/core/src/integrations/domain/types/`
  * [ ] Extend `MarketplacePort` with optional `listOffers(input)` method.
* [ ] **Core linking logic:** implement deterministic offer linking + mapping upsert:

  * [ ] Add `OfferLinkingService` (core application layer) that resolves an internal target for an offer **only when deterministic**.
  * [ ] Add `OfferMappingSyncService` (core application layer) that:

    * resolves `MarketplacePort` for the connection
    * pages through offers via `listOffers`
    * runs deterministic linking rules
    * upserts `identifier_mappings(entityType='Offer')` for linkable offers
    * returns stats `{ scanned, linked, skipped, nextCursor }`
* [ ] **Worker job:** add generic job + thin handler to trigger mapping population:

  * [ ] Add job type: `marketplace.offers.sync`
  * [ ] Implement handler that validates payload and calls `OfferMappingSyncService.sync(connectionId, { limit })`
  * [ ] (Optional) Hook into existing onboarding/scheduler if it exists; otherwise leave manual enqueue for now.
* [ ] **Allegro adapter:** implement `MarketplacePort.listOffers`:

  * [ ] Return `offerId` and any available deterministic linking keys (best-effort):

    * `externalRef` (if Allegro provides stable external reference)
    * `ean` (if available)
    * `sku` (if available)
  * [ ] If keys are unavailable, still return `offerId` and let core skip linking.
* [ ] **Tests:**

  * [ ] Unit tests for `OfferLinkingService` deterministic rules (unique match only).
  * [ ] Unit tests for `OfferMappingSyncService` ensuring:

    * idempotent upsert behavior (safe to run multiple times)
    * correct mapping fields written (`entityType`, `externalId`, `internalId`, `connectionId`, `platformType`, `context`)
  * [ ] Worker handler test: delegates to core service with correct payload.
* [ ] **Docs (minimal):** add a short note to architecture docs explaining that `Offer` mappings are populated via `marketplace.offers.sync` (no ops endpoints described).

## Affected Components

* [ ] API (`apps/api`)
* [x] Worker (`apps/worker`)
* [x] Core Library (specify: `libs/core/src/integrations`, `libs/core/src/orders` (resolver dependency), new module e.g. `libs/core/src/offers` or `libs/core/src/listings` for linking services)
* [ ] Shared Library (`libs/shared`)
* [x] Integration Adapter (specify: `libs/integrations/allegro`)
* [x] Database Schema
* [ ] Other (specify: ___________)

## Acceptance Criteria

* [ ] `identifier_mappings` has UNIQUE `(entityType, connectionId, externalId)` and INDEX `(entityType, connectionId, internalId)`.
* [ ] A new job type `marketplace.offers.sync` exists and runs end-to-end for an Allegro connection.
* [ ] Running `marketplace.offers.sync` creates `identifier_mappings` rows with:

  * `entityType = 'Offer'`
  * `externalId = <allegroOfferId>`
  * `internalId = <internal sellable item id>` (prefer internal variant/inventory item id)
  * `connectionId = <connectionId>`
  * `platformType` matching the connection
  * `context` includes `{ linkMethod, source: 'marketplace.offers.sync' }` (optional but recommended)
* [ ] `OfferLinkingService` only links when deterministic:

  * externalRef match OR unique EAN match OR unique SKU match
  * ambiguous matches are skipped (no mapping written)
* [ ] `marketplace.order.sync` no longer throws `MissingOrderItemMappingError` **for offers that have been linked** by the sync job.
* [ ] All tests pass
* [ ] Code follows [[Engineering Standards](engineering-standards.md)](../docs/engineering-standards.md)
* [ ] Documentation updated (if applicable)

## Notes

Any additional context, architecture considerations, or dependencies:

* **Do not create Offer mappings during `marketplace.order.sync` by default.** Order sync should remain deterministic and should fail fast (non-retryable) if mapping is missing.
* **EntityType naming:** use exactly `'Offer'` (case-sensitive) consistently across services/tests/migrations.
* **InternalId semantics:** `identifier_mappings('Offer').internalId` must represent the internal “sellable/inventory item” ID (prefer variant). Avoid mixing product vs variant semantics.
* **Idempotency:** `OfferMappingSyncService` must be safe to run repeatedly. Use DB uniqueness + upsert/insert-on-conflict behavior.
* **Performance:** `listOffers` must support pagination (cursor or page-based). Keep payload minimal (offerId + optional linking keys).
* **Linking keys availability:** if Allegro cannot provide SKU/EAN/externalRef cheaply, the job still works but will link fewer offers (skips safely).
* **No ops endpoints in this task:** manual linking/requeue can be a follow-up task once the automatic population path exists.