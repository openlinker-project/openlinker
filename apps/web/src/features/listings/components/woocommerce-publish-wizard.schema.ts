/**
 * WooCommerce publish wizard schema (#1044)
 *
 * Zod schema for the shop-publish wizard form. Shared by single and bulk
 * modes — the variant ids come from props (not the form), so the form only
 * carries the operator-editable knobs: visibility, stock, and an optional
 * price override.
 *
 * `priceAmount` is a string in the form (empty = "use master price") and is
 * coerced to a number at submit time by the component. The schema validates
 * the string shape (numeric, > 0 when present) without forcing a number.
 *
 * @module apps/web/src/features/listings/components
 */
import { z } from 'zod';

export const ShopPublishVisibilityValues = ['draft', 'published'] as const;

export const woocommercePublishWizardSchema = z.object({
  status: z.enum(ShopPublishVisibilityValues),
  // Stock is an integer >= 0. Empty string in bulk mode means "use master
  // stock" — handled by the optional union below.
  stock: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), 'Stock must be a whole number ≥ 0'),
  priceAmount: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0),
      'Price must be a positive number',
    ),
  priceCurrency: z.string().trim().min(1),
});

export type WoocommercePublishWizardValues = z.input<typeof woocommercePublishWizardSchema>;
export type WoocommercePublishWizardSubmission = z.output<typeof woocommercePublishWizardSchema>;

export const WOOCOMMERCE_PUBLISH_DEFAULT_CURRENCY = 'PLN';

export const WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS: WoocommercePublishWizardValues = {
  status: 'published',
  stock: '0',
  priceAmount: '',
  priceCurrency: WOOCOMMERCE_PUBLISH_DEFAULT_CURRENCY,
};

export const WOOCOMMERCE_PUBLISH_BULK_DEFAULTS: WoocommercePublishWizardValues = {
  status: 'draft',
  stock: '',
  priceAmount: '',
  priceCurrency: WOOCOMMERCE_PUBLISH_DEFAULT_CURRENCY,
};
