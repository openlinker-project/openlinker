/**
 * Fiscalization - types sub-barrel (cycle-breaker seam).
 *
 * The fiscalization sibling of `@openlinker/core/invoicing/types`, and it
 * exists for the same single consumer: the neutral per-order sales-document
 * projection in `@openlinker/core/sales-documents` (#2515, ADR-065), which must
 * name the EXISTING fiscal registration axis rather than restate it.
 *
 * TYPES only, for the reason spelled out in the invoicing sub-barrel: an erased
 * `import type` adds no runtime edge, a value import would add one.
 *
 * @module libs/core/src/fiscalization/types
 * @see docs/architecture/adrs/065-sales-document-read-surface.md
 */
export type {
  FiscalRegistrationFailureMode,
  FiscalRegistrationStatus,
} from './domain/types/fiscalization.types';
