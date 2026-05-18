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

export const bulkEditModalSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(TITLE_MAX),
  categoryId: z.string().trim().min(1, 'Category is required'),
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

export type BulkEditModalValues = z.input<typeof bulkEditModalSchema>;
export type BulkEditModalSubmission = z.output<typeof bulkEditModalSchema>;
