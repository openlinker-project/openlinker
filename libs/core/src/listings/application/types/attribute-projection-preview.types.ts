/**
 * Attribute Projection Preview Types
 *
 * I/O shapes for `AttributeProjectionPreviewService` (#3995): what the
 * operator's attribute mappings and #1841 rules will fill for each variant of an
 * offer batch, computed before anything is published.
 *
 * @module libs/core/src/listings/application/types
 */

import type { AttributeProjectionResult } from './attribute-projection.types';

/** One variant to preview, under the category it will be submitted with. */
export interface AttributeProjectionPreviewItem {
  internalVariantId: string;
  /** The destination category the offer will be created in. */
  categoryId: string;
  /** The operator's per-offer EAN override, when set - it feeds `place-value` rules. */
  ean?: string;
}

export interface AttributeProjectionPreviewInput {
  connectionId: string;
  items: AttributeProjectionPreviewItem[];
}

export const AttributeProjectionPreviewFailureValues = [
  'variant-not-found',
  'projection-failed',
] as const;
/**
 * Why one variant could not be previewed. A failure is a state the caller must
 * show, never an empty projection: reading it as "nothing filled" would keep a
 * variant blocked for a reason that is not true, and reading it as "everything
 * filled" would clear a gate nothing checked.
 */
export type AttributeProjectionPreviewFailure =
  (typeof AttributeProjectionPreviewFailureValues)[number];

export type AttributeProjectionPreviewEntry =
  | ({
      internalVariantId: string;
      categoryId: string;
      status: 'ok';
    } & Pick<
      AttributeProjectionResult,
      'parameters' | 'unresolvedRequired' | 'restrictionIssues' | 'origins'
    >)
  | {
      internalVariantId: string;
      categoryId: string;
      status: 'failed';
      reason: AttributeProjectionPreviewFailure;
    };

export interface AttributeProjectionPreviewResult {
  entries: AttributeProjectionPreviewEntry[];
}
