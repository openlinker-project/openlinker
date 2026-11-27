/**
 * Bulk edit modal - Zod schema (#1741)
 *
 * Validates the editor's SHARED BASE scope (also the simple-product flat form).
 * Per-variant overrides are tracked outside RHF in an explicit override map (an
 * inherited field pre-filled with the base value is not "dirty" yet renders as
 * inherited), so they are not part of this schema; the base scope is the only
 * RHF form and it reuses the key names the single-offer-wizard subcomponents
 * (`BulkCategoryChooseModal`, `CategoryParametersStep`) already read via
 * `useFormContext()` (`categoryId`, `parameters`).
 *
 * Messages come from the `listings.bulkEditModal.validation` copy, read when the
 * schema is built, so build it inside the component rather than at module level.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { z } from 'zod';

import type { Messages, ResolvedCopy } from '../../../../shared/i18n';

/** The `listings.bulkEditModal.validation` copy. */
export type BulkEditModalValidationCopy =
  ResolvedCopy<Messages['listings']>['bulkEditModal']['validation'];

// Offer title cap (Allegro's is 75), shared across supported marketplaces.
const TITLE_MAX = 75;
const DESCRIPTION_MAX = 50_000;

/**
 * Build the base-scope edit schema. `requireCategory` is true for a destination
 * with a browsable category tree (Allegro - the operator must pick a category);
 * false for a `borrows` destination (Erli, #1096), where a blank category is
 * valid because it resolves server-side at submit (override -> barcode ->
 * configured category mapping, ADR-025 §3).
 */
export function makeBulkEditModalSchema(
  requireCategory: boolean,
  copy: BulkEditModalValidationCopy,
) {
  return z.object({
    title: z.string().trim().min(1, copy.titleRequired).max(TITLE_MAX),
    // Both branches are `ZodString`, so the inferred object type is identical
    // regardless of `requireCategory` - only the runtime validation differs.
    categoryId: requireCategory
      ? z.string().trim().min(1, copy.categoryRequired)
      : z.string().trim(),
    // Hidden field - set when the operator picks a multi-match candidate so the
    // offer links that card (#810/#808). Cleared on a manual category change.
    productCardId: z.string().optional(),
    // Offer-level barcode (#1741). The single-offer (simple-product) barcode
    // that clears the `no-ean` blocker - distinct from the Allegro category GTIN
    // parameter. GS1 validity is enforced inline + by the blocker recompute (a
    // blank value inherits the master barcode at submit).
    ean: z.string().trim(),
    // Optional at base - a blank base description falls back to the master
    // product description on the wire.
    description: z.string().trim().max(DESCRIPTION_MAX),
    // Optional decimal price. Blank ⇒ inherit the master/policy price at submit.
    priceAmount: z
      .string()
      .trim()
      .regex(/^(\d+([.,]\d{1,2})?)?$/, copy.priceFormat),
    // Only consumed by the simple-product flat form; base scope leaves it 0.
    stock: z.coerce.number().int().min(0, copy.stockNegative),
    publishImmediately: z.boolean(),
    // Permissive object - `CategoryParametersStep` owns its per-field shape and
    // the submit serialiser (`categoryParametersToOfferParameters`).
    parameters: z.record(z.string(), z.unknown()).optional(),
  });
}

type BulkEditModalSchema = ReturnType<typeof makeBulkEditModalSchema>;

export type BulkEditModalValues = z.input<BulkEditModalSchema>;
export type BulkEditModalSubmission = z.output<BulkEditModalSchema>;
