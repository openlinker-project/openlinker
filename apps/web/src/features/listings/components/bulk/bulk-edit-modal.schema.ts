/**
 * Bulk edit modal — Zod schema
 *
 * Narrow per-row override form schema. Reuses key names that the existing
 * single-offer-wizard subcomponents (CategoryPicker, CategoryParametersStep)
 * already consume via `useFormContext()` (`categoryId`, `parameters`) so they
 * drop into the modal's FormProvider without internal changes.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { z } from 'zod';

// 75 chars is Allegro's offer title cap. The wizard's per-row edit form
// applies the same cap.
const TITLE_MAX = 75;
const DESCRIPTION_MAX = 50_000;

const ALLOWED_CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CZK'] as const;

/**
 * Build the per-row edit schema. `requireCategory` is true for a destination
 * with a browsable category tree (Allegro — the operator must pick a category);
 * false for a `borrows` destination (Erli, #1096), where a blank category is
 * valid because it resolves server-side at submit (override → barcode →
 * configured category mapping, ADR-025 §3).
 */
export function makeBulkEditModalSchema(requireCategory: boolean) {
  return z.object({
    title: z.string().trim().min(1, 'Title is required').max(TITLE_MAX),
    // Both branches are `ZodString`, so the inferred object type is identical
    // regardless of `requireCategory` — only the runtime validation differs.
    categoryId: requireCategory
      ? z.string().trim().min(1, 'Category is required')
      : z.string().trim(),
    // Hidden field — not user-editable. Set when the operator picks a multi-match
    // candidate chip so the offer links that card (#810, mirrors #808). Cleared
    // on a manual category change since the card belongs to the candidate's
    // category. Threaded into `overrides.productCardId` at submit.
    productCardId: z.string().optional(),
    description: z.string().trim().min(1, 'Description is required').max(DESCRIPTION_MAX),
    stock: z.coerce.number().int().min(0, 'Stock cannot be negative'),
    priceAmount: z
      .string()
      .trim()
      .regex(/^\d+([.,]\d{1,2})?$/, 'Use a decimal price, e.g. 79.00'),
    priceCurrency: z.enum(ALLOWED_CURRENCIES),
    publishImmediately: z.boolean(),
    // The dynamic parameters block is a permissive object — `CategoryParametersStep`
    // owns its own per-field shape and serialiser. The bulk modal trusts the
    // single-offer-wizard's validation upstream; serialisation happens at submit
    // via the same helper the single-offer wizard uses.
    parameters: z.record(z.string(), z.unknown()).optional(),
  });
}

/**
 * Default (category-required, Allegro) schema. Preserves the original const
 * export + the type derivations below for existing consumers and tests.
 */
export const bulkEditModalSchema = makeBulkEditModalSchema(true);

export type BulkEditModalValues = z.input<typeof bulkEditModalSchema>;
export type BulkEditModalSubmission = z.output<typeof bulkEditModalSchema>;
