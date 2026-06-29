/**
 * Attribute Projection Types
 *
 * I/O shapes for `AttributeProjectionService` (#1038, ADR-023 §4): projecting a
 * product variant's `attributes` into a destination's neutral parameter shape,
 * resolving dictionary value-ids from the live category schema.
 *
 * @module libs/core/src/listings/application/types
 */

import type { CategoryParameterSection } from '../../domain/types/category-parameter.types';
import type { OfferParameter } from '../../domain/types/offer-parameter.types';

/**
 * Projection input. `sourceConnectionId` selects the source-scoped attribute
 * mappings; `destinationCategoryId` selects the category schema (owns path) and
 * any per-category mapping overrides.
 */
export interface AttributeProjectionInput {
  sourceConnectionId: string;
  destinationConnectionId: string;
  destinationCategoryId: string;
  /** The variant's descriptive attributes (e.g. `{ Color: 'Red' }`). */
  attributes: Record<string, string>;
  /**
   * Capability the destination adapter is resolved under to read its live
   * category schema (the `CategoryParametersReader` provenance branch). Defaults
   * to `'OfferManager'` (the marketplace offer path). The shop-publish path
   * (#1042) passes `'ProductPublisher'` — a shop connection never supports
   * `'OfferManager'`, so resolving it would throw. The structural
   * `isCategoryParametersReader` guard is capability-agnostic: a destination
   * without a parameters reader falls through to the name-keyed pass-through
   * branch regardless of which capability resolved it.
   */
  destinationCapability?: string;
  /**
   * Owner taxonomy this destination borrows (#1045, e.g. `'allegro'`). When set,
   * the projection additionally reuses attribute mappings authored under this
   * provenance across destination connections — so a `borrows` destination (ERLI)
   * reuses the owner's (Allegro's) attribute mappings with zero re-authoring.
   * Rows authored directly against this destination win per source attribute key.
   * Absent for `owns` / `open` destinations.
   */
  borrowedTaxonomy?: string;
}

/**
 * One projected destination parameter.
 *
 * Alias of the canonical domain {@link OfferParameter} (#1039): projection is
 * the producer, and its output travels verbatim on `CreateOfferCommand
 * .parameters`. Kept as a named alias so existing projection-internal call
 * sites read in projection terms while the command references the domain type
 * directly (no domain→application edge).
 */
export type ResolvedParameter = OfferParameter;

/**
 * Projection result. `parameters` are ready for the adapter to serialize;
 * `unmappedSourceKeys` are present source attributes that didn't reach the
 * destination (no mapping, or mapped to a parameter absent from the category);
 * `unresolvedRequired` are required destination parameters that couldn't be
 * populated — the publish gate (#1039) consumes these. `section` lets the gate
 * enforce **offer-section** required params at the builder while deferring
 * product-section ones to the adapter / marketplace (Allegro catalog-card
 * inheritance, #431/#808).
 */
export interface AttributeProjectionResult {
  parameters: ResolvedParameter[];
  unmappedSourceKeys: string[];
  unresolvedRequired: { id: string; name: string; section: CategoryParameterSection }[];
}
