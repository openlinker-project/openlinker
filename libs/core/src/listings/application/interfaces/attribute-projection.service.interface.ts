/**
 * Attribute Projection Service Interface
 *
 * Contract for projecting a product variant's `attributes` into a destination's
 * neutral parameter shape (#1038, ADR-023 §4). Provenance-aware: a destination
 * that owns its taxonomy (`CategoryParametersReader`) gets dictionary value-id
 * resolution; one that borrows/opens its taxonomy gets a name-keyed
 * pass-through.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  AttributeProjectionInput,
  AttributeProjectionResult,
} from '../types/attribute-projection.types';

export interface IAttributeProjectionService {
  /**
   * Project the input variant attributes into destination parameters. Pure
   * read-only — performs no writes; surfaces unmapped / unresolved-required
   * diagnostics for the caller (offer builder / publish gate).
   */
  project(input: AttributeProjectionInput): Promise<AttributeProjectionResult>;
}
