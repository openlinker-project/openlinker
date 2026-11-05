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
   * Owning source (master) connection. Every interactive writer supplies it
   * (the Category Mappings page and the MCP write tool, #3993): a row written
   * without one is a source-agnostic wildcard, and a second write for the same
   * category would then insert a duplicate instead of updating it. Still
   * optional on the type because historical rows carry `null`.
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
  /**
   * Owner-taxonomy identifier the mapping is authored against (e.g. `'allegro'`).
   * Defaults to `'allegro'` when omitted — mirrors `CategoryMappingInput` so a
   * `borrows` destination (ERLI) can reuse it by provenance (#1045).
   */
  destinationTaxonomyProvenance?: string;
  /** Source→destination value translations (e.g. `Red → Czerwony`). */
  values?: { sourceValue: string; destinationValue: string }[];
}

/**
 * Result of moving category mappings from one destination connection to
 * another (#3993). `keptSourceCategoryIds` lists the source categories that
 * already had a mapping at the target, so the moved row was dropped and the
 * target's own mapping was left as it was.
 */
export interface CategoryMappingReassignResult {
  moved: number;
  keptSourceCategoryIds: string[];
}
