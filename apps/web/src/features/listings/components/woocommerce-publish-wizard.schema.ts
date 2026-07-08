/**
 * WooCommerce publish wizard schema (#1044, per-product stock/price #1414)
 *
 * Zod schema for the shop-publish wizard form. **Single** mode carries a top-
 * level `stock`/`priceAmount` (variant id comes from props, not the form).
 * **Bulk** mode carries one `items[]` row per selected variant — stock and
 * price are per-product, not one shared value for the whole batch — plus a
 * shared `status`/`priceCurrency`. Visibility isn't a per-item concern, so it
 * stays a single top-level field in both modes.
 *
 * `priceAmount` is a string in the form (empty = "use master price") and is
 * coerced to a number at submit time by the component. The schema validates
 * the string shape (numeric, > 0 when present) without forcing a number.
 *
 * @module apps/web/src/features/listings/components
 */
import { z } from 'zod';

export const ShopPublishVisibilityValues = ['draft', 'published'] as const;

const stockFieldSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+$/.test(v), 'Stock must be a whole number ≥ 0');

const priceAmountFieldSchema = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0),
    'Price must be a positive number',
  );

const bulkItemSchema = z.object({
  variantId: z.string().trim().min(1),
  label: z.string(),
  stock: stockFieldSchema,
  priceAmount: priceAmountFieldSchema,
});

export const woocommercePublishWizardSchema = z.object({
  status: z.enum(ShopPublishVisibilityValues),
  // Single-mode only — ignored by the bulk submit path.
  stock: stockFieldSchema,
  priceAmount: priceAmountFieldSchema,
  priceCurrency: z.string().trim().min(1),
  // Bulk-mode only — one row per selected variant, seeded when the operator
  // finishes picking. Ignored by the single-publish submit path.
  items: z.array(bulkItemSchema),
});

export type WoocommercePublishWizardValues = z.input<typeof woocommercePublishWizardSchema>;
export type WoocommercePublishWizardSubmission = z.output<typeof woocommercePublishWizardSchema>;
export type WoocommercePublishWizardItem = z.output<typeof bulkItemSchema>;

export const WOOCOMMERCE_PUBLISH_DEFAULT_CURRENCY = 'PLN';

export const WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS: WoocommercePublishWizardValues = {
  status: 'published',
  stock: '0',
  priceAmount: '',
  priceCurrency: WOOCOMMERCE_PUBLISH_DEFAULT_CURRENCY,
  items: [],
};

export const WOOCOMMERCE_PUBLISH_BULK_DEFAULTS: WoocommercePublishWizardValues = {
  status: 'draft',
  stock: '',
  priceAmount: '',
  priceCurrency: WOOCOMMERCE_PUBLISH_DEFAULT_CURRENCY,
  items: [],
};
