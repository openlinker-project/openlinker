/**
 * The pure rules of the bulk multipack creator: the pack size bounds, the
 * values a row suggests until the operator types over them, and how a failed
 * create is worded. Kept apart from the table so the rules test without a DOM.
 *
 * @module apps/web/src/features/bundles/lib
 */
import {
  MAX_BUNDLE_NAME_LENGTH,
  formatPriceInput,
  parsePrice,
} from './bundle-form-model';

export const MIN_PACK_SIZE = 2;
export const MAX_PACK_SIZE = 99;
export const DEFAULT_PACK_SIZE = 3;

/** How many products one bulk run takes; more would be hundreds of shop calls in one click. */
export const MAX_BULK_ROWS = 50;

/** The pack size a typed value means, or `null` when it is not a whole number in 2..99. */
export function parsePackSize(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number.parseInt(text, 10);
  return parsed >= MIN_PACK_SIZE && parsed <= MAX_PACK_SIZE ? parsed : null;
}

/**
 * "Kubek ceramiczny x3": the product's own name plus the pack size. Never cut
 * to a few words (two different products would end up with one name on the
 * marketplace); only a name too long for the master is shortened, at a word.
 */
export function packName(productName: string, pack: number): string {
  const suffix = ` x${String(pack)}`;
  const name = productName.trim();
  if (name.length + suffix.length <= MAX_BUNDLE_NAME_LENGTH) return `${name}${suffix}`;
  const room = MAX_BUNDLE_NAME_LENGTH - suffix.length;
  const cut = name.slice(0, room);
  const at = cut.lastIndexOf(' ');
  return `${(at > 0 ? cut.slice(0, at) : cut).trim()}${suffix}`;
}

/** Lower-cased, trimmed: how two names or SKUs are compared for being the same. */
export function sameKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * For each value, the index of the FIRST earlier row holding the same
 * non-empty value, or `null` when it is unique so far.
 */
export function earlierDuplicateOf(values: readonly string[]): (number | null)[] {
  const first = new Map<string, number>();
  return values.map((value, index) => {
    const key = sameKey(value);
    if (key === '') return null;
    const seen = first.get(key);
    if (seen === undefined) {
      first.set(key, index);
      return null;
    }
    return seen;
  });
}

/**
 * A name nobody else in the batch has: when two different products would get
 * the same auto name, the SKU (or a counter) tells them apart.
 */
export function uniquifyName(name: string, sku: string, taken: ReadonlySet<string>): string {
  if (!taken.has(sameKey(name))) return name;
  const withSku = sku.trim() !== '' ? `${name} (${sku.trim()})` : name;
  if (!taken.has(sameKey(withSku)) && withSku.length <= MAX_BUNDLE_NAME_LENGTH) return withSku;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${String(n)})`;
    if (!taken.has(sameKey(candidate))) return candidate;
  }
}

/** "KUB-01-x3"; empty when the product has no SKU, which the operator must then type. */
export function packSku(sku: string | null, pack: number): string {
  const base = (sku ?? '').trim();
  return base === '' ? '' : `${base}-x${String(pack)}`;
}

/** The component price times the pack size, as the text the price field shows. */
export function packPriceText(price: number | null, pack: number): string {
  return price === null ? '' : formatPriceInput(Math.round(price * pack * 100) / 100);
}

export interface PackFieldValues {
  name: string;
  sku: string;
  priceText: string;
}

/** Whether a row holds everything the shop needs to create its product. */
export function isPackRowValid(values: PackFieldValues): boolean {
  return (
    values.name.trim() !== '' &&
    values.name.trim().length <= MAX_BUNDLE_NAME_LENGTH &&
    values.sku.trim() !== '' &&
    parsePrice(values.priceText) !== null
  );
}

export type BulkRowStatus = 'waiting' | 'creating' | 'created' | 'failed';

export interface BulkErrorDetails {
  code: string | null;
  reason: string | null;
  message: string | null;
}

/** The machine reason and the shop's own sentence from an error body, whichever of them it carries. */
export function readBulkErrorDetails(details: unknown): BulkErrorDetails {
  if (typeof details !== 'object' || details === null) return { code: null, reason: null, message: null };
  const record = details as Record<string, unknown>;
  const message = typeof record.message === 'string' && record.message.trim() !== '' ? record.message.trim() : null;
  return {
    code: typeof record.code === 'string' ? record.code : null,
    reason: typeof record.reason === 'string' ? record.reason : null,
    message,
  };
}
