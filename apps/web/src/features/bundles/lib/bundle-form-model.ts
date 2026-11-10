/**
 * The bundle form's shape (#3935): one row per component, the steps, and the
 * pure rules the steps share (what is missing, the suggested price, the
 * suggested description). Kept apart from the components so the steps and the
 * summary read the same answers.
 *
 * @module apps/web/src/features/bundles/lib
 */
import { z } from 'zod';

export const BUNDLE_STEP_KEYS = ['components', 'product', 'gifts', 'review'] as const;
export type BundleStepKey = (typeof BUNDLE_STEP_KEYS)[number];

export const quantitySchema = z.string().regex(/^[1-9]\d*$/);

export const bundleFormSchema = z.object({
  components: z
    .array(
      z.object({
        variantId: z.string(),
        productId: z.string(),
        name: z.string(),
        sku: z.string().nullable(),
        price: z.number().nullable(),
        currency: z.string().nullable(),
        availableToPromise: z.number().nullable(),
        isBundle: z.boolean(),
        imageUrl: z.string().nullable().optional(),
        ean: z.string().nullable().optional(),
        attributes: z.string().nullable().optional(),
        quantity: quantitySchema,
        gift: z.boolean(),
        documentForm: z.string(),
      })
    )
    .min(1),
});
export type BundleFormValues = z.infer<typeof bundleFormSchema>;
export type BundleFormRow = BundleFormValues['components'][number];

export interface ParsedRow extends BundleFormRow {
  /** 0 when the typed quantity is not a positive whole number. */
  qty: number;
}

export type BundleProductMode = 'existing' | 'create';

export interface NewProductDraft {
  connectionId: string;
  name: string;
  sku: string;
  price: string;
  ean: string;
  description: string;
  /** Which fields the operator has typed in, so a suggestion never overwrites them. */
  touched: { sku: boolean; price: boolean; description: boolean };
}

export const EMPTY_PRODUCT_DRAFT: NewProductDraft = {
  connectionId: '',
  name: '',
  sku: '',
  price: '',
  ean: '',
  description: '',
  touched: { sku: false, price: false, description: false },
};

/** Parses "99,90" or "99.90"; `null` unless it is a positive amount with at most two decimals. */
export function parsePrice(text: string): number | null {
  const normalised = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
  const value = Number(normalised);
  return value > 0 ? value : null;
}

/**
 * What the components cost bought one by one, gifts excluded. `null` when a paid
 * component has no price, because a sum with a hole in it states a wrong number.
 */
export function componentsSum(rows: readonly ParsedRow[]): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.gift || row.qty === 0) continue;
    if (row.price === null) return null;
    total += row.price * row.qty;
  }
  return Math.round(total * 100) / 100;
}

export function suggestedSku(rows: readonly ParsedRow[]): string {
  const first = rows.find((row) => row.sku !== null && !row.gift) ?? rows.find((row) => row.sku !== null);
  return first?.sku ? `${first.sku}-SET` : '';
}

/** "Kubek ceramiczny, Kawa ziarnista 250 g" - the names, with quantities when above one. */
export function suggestedDescription(rows: readonly ParsedRow[]): string {
  return rows
    .filter((row) => row.qty > 0)
    .map((row) => (row.qty > 1 ? `${String(row.qty)} x ${row.name}` : row.name))
    .join(', ');
}

export function formatPriceInput(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

/** The forms a bundle's gift slot can take; a custom price is not one of them. */
export const BUNDLE_GIFT_FORMS = ['priced-in', 'technical-cent', 'show-zero', 'omit'] as const;
