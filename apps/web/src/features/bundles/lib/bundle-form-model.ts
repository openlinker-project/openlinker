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

/** The most of one component a single bundle may hold; the step shows it as the limit. */
export const MAX_COMPONENT_QUANTITY = 9999;

/** The longest bundle name the form accepts; a longer one would also overflow every card that echoes it. */
export const MAX_BUNDLE_NAME_LENGTH = 120;
/** A price above this is far more likely a typo than a price. */
export const MAX_BUNDLE_PRICE = 1_000_000;

export const quantitySchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((text) => Number(text) <= MAX_COMPONENT_QUANTITY);

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
  touched: { name: boolean; sku: boolean; price: boolean; description: boolean };
}

export const EMPTY_PRODUCT_DRAFT: NewProductDraft = {
  connectionId: '',
  name: '',
  sku: '',
  price: '',
  ean: '',
  description: '',
  touched: { name: false, sku: false, price: false, description: false },
};

/**
 * Turns what was typed into a plain "1299.00" string: spaces are dropped, and when both a dot and
 * a comma appear the dot is a thousands mark ("1.299,00"). Otherwise a comma is the decimal mark.
 */
function normalisePriceText(text: string): string {
  const compact = text.replace(/[\s\u00a0]/g, '');
  if (compact.includes(',') && compact.includes('.')) return compact.replace(/\./g, '').replace(',', '.');
  return compact.replace(',', '.');
}

export type PriceProblem = 'empty' | 'invalid' | 'high';

/** Why a typed price is unusable, or `null` when it is a positive amount with at most two decimals. */
export function priceProblem(text: string): PriceProblem | null {
  const normalised = normalisePriceText(text);
  if (normalised === '') return 'empty';
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return 'invalid';
  const value = Number(normalised);
  if (value <= 0) return 'invalid';
  return value > MAX_BUNDLE_PRICE ? 'high' : null;
}

/** Parses "99,90", "99.90" or "1 299,00"; `null` unless it is a usable price (see `priceProblem`). */
export function parsePrice(text: string): number | null {
  return priceProblem(text) === null ? Number(normalisePriceText(text)) : null;
}

/** An EAN is empty (optional) or 8, 12, 13 or 14 digits. */
export function isValidEan(text: string): boolean {
  const value = text.trim();
  return value === '' || /^(\d{8}|\d{12,14})$/.test(value);
}

export type CompositionProblem = 'no-paid' | 'single-piece';

/**
 * A composition that cannot be a sellable bundle: every component is a gift (the bundle has no
 * price to stand on), or one product in a quantity of one (that is just the product).
 */
export function compositionProblem(rows: readonly ParsedRow[]): CompositionProblem | null {
  const counted = rows.filter((row) => row.qty > 0);
  if (counted.length === 0) return null;
  if (counted.every((row) => row.gift)) return 'no-paid';
  const only = counted[0];
  if (counted.length === 1 && only !== undefined && only.qty < 2) return 'single-piece';
  return null;
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
  if (!first?.sku) return '';
  const counted = rows.filter((row) => row.qty > 0 && !row.gift);
  // A pack of one product is "-x3" and a set of several is a komplet ("-KPL"): the old shared
  // "-SET" suffix collided with the second bundle anyone made from the same first component.
  if (counted.length === 1 && counted[0] !== undefined && counted[0].qty > 1) {
    return `${first.sku}-x${String(counted[0].qty)}`;
  }
  return counted.length > 1 ? `${first.sku}-KPL` : `${first.sku}-SET`;
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

/** Above this many rows a bundle is more likely two bundles pasted together than one. */
export const SOFT_COMPONENT_LIMIT = 20;

export interface SeedQuantity {
  quantity: number;
  /** True when the typed value was not usable as it stood (0, negative, fractional, too large). */
  altered: boolean;
}

/**
 * Reads a quantity from a hand-edited URL: a whole number from 1 to the form's maximum. Anything
 * else is brought into that range and flagged, so the form can say it did so instead of silently
 * changing what the person pasted.
 */
export function clampSeedQuantity(raw: string | undefined): SeedQuantity {
  if (raw === undefined || raw.trim() === '') return { quantity: 1, altered: false };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { quantity: 1, altered: true };
  const whole = Math.floor(parsed);
  const quantity = Math.min(MAX_COMPONENT_QUANTITY, Math.max(1, whole));
  return { quantity, altered: quantity !== parsed };
}

/** The first words of a name, without a trailing bracket note, kept within `budget` characters. */
export function shortComponentName(name: string, budget = 18): string {
  const cleaned = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter((word) => word !== '');
  if (words.length === 0) return '';
  let shown = words[0] ?? '';
  for (const word of words.slice(1)) {
    if (`${shown} ${word}`.length > budget) break;
    shown = `${shown} ${word}`;
  }
  return shown;
}

/**
 * A pack size a name announces ("Kubek x3", "Kubek ×3", "3 szt.", "3-pak"), or `null`. Only 2 and
 * more count: "x1" is not a pack.
 */
export function namedPackSize(name: string): number | null {
  const match = /(?:^|[\s(])[x×]\s?(\d{1,4})\b/i.exec(name) ?? /\b(\d{1,4})\s?-?\s?(?:szt|pak)/i.exec(name);
  const size = match?.[1] === undefined ? null : Number(match[1]);
  return size !== null && size >= 2 ? size : null;
}

/**
 * The pack size the name claims and the quantity the composition really holds, when the bundle is
 * one product and the two differ; `null` otherwise.
 */
export function packSizeMismatch(
  name: string | null,
  rows: readonly ParsedRow[]
): { named: number; actual: number } | null {
  if (name === null) return null;
  const counted = rows.filter((row) => row.qty > 0);
  const only = counted[0];
  if (counted.length !== 1 || only === undefined) return null;
  const named = namedPackSize(name);
  return named !== null && named !== only.qty ? { named, actual: only.qty } : null;
}
