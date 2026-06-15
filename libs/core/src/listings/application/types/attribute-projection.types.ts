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
}

/**
 * One projected destination parameter.
 *
 * `id` dual semantics: on the **owns** path it is the live `CategoryParameter.id`
 * (the destination's parameter identifier); on the **pass-through** path it is
 * the `destinationParameterName` (the adapter interprets, since no schema is
 * available to resolve an id). `valuesIds` carries resolved dictionary entry ids
 * (owns + dictionary type); `values` carries free-text / pass-through values.
 */
export interface ResolvedParameter {
  id: string;
  values?: string[];
  valuesIds?: string[];
  section: CategoryParameterSection;
}

/**
 * Projection result. `parameters` are ready for the adapter to serialize;
 * `unmappedSourceKeys` are present source attributes that didn't reach the
 * destination (no mapping, or mapped to a parameter absent from the category);
 * `unresolvedRequired` are required destination parameters that couldn't be
 * populated — the publish gate (#1039) consumes these.
 */
export interface AttributeProjectionResult {
  parameters: ResolvedParameter[];
  unmappedSourceKeys: string[];
  unresolvedRequired: { id: string; name: string }[];
}
