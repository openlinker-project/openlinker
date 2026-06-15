/**
 * Mapping Domain Types
 *
 * Input types for upsert operations on connection-scoped mapping tables.
 *
 * @module libs/core/src/mappings/domain/types
 */

import type { OrderStatus } from '@openlinker/core/orders';

export interface StatusMappingInput {
  allegroStatus: string;
  prestashopStatusId: string;
}

export interface CarrierMappingInput {
  allegroDeliveryMethodId: string;
  prestashopCarrierId: string;
}

/**
 * Override item for the outbound OL→destination order-state mapping (#862).
 * `externalStateId` is the destination platform's native state id as a string
 * (PrestaShop: numeric order-state id).
 */
export interface OrderStateMappingInput {
  olStatus: OrderStatus;
  externalStateId: string;
}

export interface PaymentMappingInput {
  allegroPaymentProvider: string;
  prestashopPaymentModule: string;
}

export interface CategoryMappingInput {
  sourceCategoryId: string;
  destinationCategoryId: string;
  destinationCategoryName: string;
  destinationCategoryPath?: string;
  /**
   * Owning source connection. Optional for now (#1036 record-only): the API
   * create path doesn't yet supply it, so rows are created with `null` and the
   * lookup falls back to the destination+source-category key. Threading the
   * source connection through create/resolve is a follow-up.
   */
  sourceConnectionId?: string | null;
  /**
   * Owner-taxonomy identifier the mapping is authored against (e.g. `'allegro'`).
   * Defaults to `'allegro'` when omitted (only marketplace pair today).
   */
  destinationTaxonomyProvenance?: string;
}

/**
 * Upsert input for an attribute mapping (#1038, ADR-023 §4). Maps a source
 * attribute key to a destination parameter name, scoped by source connection
 * with an optional per-category override (`destinationCategoryId` null ⇒
 * connection-wide default). `values` carries the per-value translations and
 * **replaces** the existing set on each upsert.
 */
export interface AttributeMappingInput {
  sourceConnectionId: string;
  sourceAttributeKey: string;
  destinationParameterName: string;
  /** Per-category override; `null`/omitted ⇒ the connection-wide default row. */
  destinationCategoryId?: string | null;
  /** Source→destination value translations (e.g. `Red → Czerwony`). */
  values?: { sourceValue: string; destinationValue: string }[];
}
