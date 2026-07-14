/**
 * Offer Creation Request Snapshot Types
 *
 * Domain-owned snapshot of the `CreateOfferRequest` wire aggregate, persisted on
 * `OfferCreationRecord.request` so a failed record can be re-opened in the
 * wizard with its original fields pre-filled. Kept structurally identical to
 * the wire type today, but decoupled so future wire-shape drift stops at the
 * DTO boundary unless the domain explicitly adopts the change.
 *
 * Versioning follows the `MarketplaceOfferCreatePayloadV1` precedent in
 * `@openlinker/core/sync`: readers check `schemaVersion` and degrade to
 * null-like behaviour on unknown versions.
 *
 * @module libs/core/src/listings/domain/types
 */

import type { CreateOfferOverrides, OfferCondition } from '@openlinker/core/listings';

/**
 * Current snapshot schema version. Bump when the shape changes incompatibly;
 * readers (retry-prefill on the FE) should route on this value.
 */
export const OFFER_CREATION_REQUEST_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Price shape as captured in the wizard submission.
 *
 * Distinct from domain-layer `Money` value objects — this is the raw form
 * input shape, so retry pre-fill restores exactly what the operator typed.
 */
export interface OfferCreationRequestPriceSnapshot {
  amount: number;
  currency: string;
}

/**
 * Persisted snapshot of the wizard's `CreateOfferRequest` payload.
 *
 * Stored in `offer_creation_records.request` as jsonb. Optional fields mirror
 * the wire aggregate — the snapshot treats everything the operator didn't
 * provide as `undefined` (not `null`).
 */
export interface OfferCreationRequestSnapshot {
  schemaVersion: 1;
  internalVariantId: string;
  stock: number;
  publishImmediately: boolean;
  price?: OfferCreationRequestPriceSnapshot;
  overrides?: CreateOfferOverrides;
  /**
   * Programmatic item condition captured at submit time (#1500), so a
   * bulk/single retry rebuild carries it back onto the re-enqueued job. Absent
   * for wizard submissions — the operator's Stan choice rides on `overrides`
   * instead — in which case the builder re-applies its `'new'` default.
   */
  condition?: OfferCondition;
}
