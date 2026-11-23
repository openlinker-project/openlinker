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
  shortComponentName,
} from './bundle-form-model';

export const MIN_PACK_SIZE = 2;
export const MAX_PACK_SIZE = 99;
export const DEFAULT_PACK_SIZE = 3;

/** The pack size a typed value means: whole, brought into 2..99; anything unreadable is the default. */
export function clampPackSize(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PACK_SIZE;
  return Math.min(MAX_PACK_SIZE, Math.max(MIN_PACK_SIZE, parsed));
}

/** "Kubek x3": the same working name the single-product wizard suggests. */
export function packName(productName: string, pack: number): string {
  return `${shortComponentName(productName, 30)} x${String(pack)}`;
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
