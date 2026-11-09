/**
 * Attribute Projection Preview Service Interface
 *
 * Contract for previewing, per variant, the destination parameters an offer
 * will be created with from attribute mappings and operator rules (#3995).
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  AttributeProjectionPreviewInput,
  AttributeProjectionPreviewResult,
} from '../types/attribute-projection-preview.types';

export interface IAttributeProjectionPreviewService {
  /**
   * Run the publish-time projection for each item without creating anything.
   * One entry per input item, in input order. A per-variant problem is
   * reported on its entry; a connection-level problem (no master catalogue
   * configured) throws.
   */
  preview(input: AttributeProjectionPreviewInput): Promise<AttributeProjectionPreviewResult>;
}
