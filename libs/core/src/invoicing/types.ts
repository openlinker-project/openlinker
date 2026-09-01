/**
 * Invoicing - types sub-barrel (cycle-breaker seam).
 *
 * Exports the invoicing context's neutral status vocabulary WITHOUT pulling in
 * `InvoicingModule`, its services or its ORM entities, mirroring the
 * `@openlinker/core/orders/types` seam (#2155) this file is modelled on.
 *
 * It exists for one consumer: the neutral per-order sales-document projection
 * in `@openlinker/core/sales-documents` (#2515, ADR-065). That concern must
 * name the EXISTING invoice axes rather than declare a third vocabulary, and it
 * is also a zero-outbound-CORE-CONTEXT-edge leaf - so the only import it may
 * make is a type-only one, from a sub-barrel that re-exports no runtime value.
 *
 * Only TYPES are re-exported here, deliberately. A value export (the `*Values`
 * arrays, say) would let a future edit turn an erased `import type` into a real
 * `require()` and close the very CJS cycle `libs/core/src/__tests__/
 * barrel-purity.spec.ts` exists to forbid. A caller needing the runtime arrays
 * uses the main `@openlinker/core/invoicing` barrel, which no leaf context may
 * import at all.
 *
 * @module libs/core/src/invoicing/types
 * @see docs/architecture/adrs/065-sales-document-read-surface.md
 */
export type {
  DocumentType,
  InvoiceFailureCode,
  InvoiceFailureMode,
  InvoiceStatus,
  RegulatoryStatus,
} from './domain/types/invoicing.types';
