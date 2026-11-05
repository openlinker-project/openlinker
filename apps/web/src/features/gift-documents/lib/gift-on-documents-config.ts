/**
 * Gift on documents - connection config (#3941)
 *
 * The per-connection OVERRIDE `config.giftOnDocuments = { form }`; absent means
 * "as in OpenLinker". Reading and merging only: the server validates the shape.
 * `PATCH /connections/:id` replaces `config` wholesale, so only the one key
 * this tab owns is touched. The earlier model's `differentRateGift` is dropped
 * when the key is rewritten (the server ignores a stored one anyway).
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import { GiftDocumentFormChoiceValues, type GiftDocumentFormChoice } from './gift-lines';

export const GIFT_ON_DOCUMENTS_CONFIG_KEY = 'giftOnDocuments';

/** The saved override, or `null` when the connection inherits. Never throws. */
export function readGiftConnectionOverride(config: unknown): GiftDocumentFormChoice | null {
  if (typeof config !== 'object' || config === null) return null;
  const raw = (config as Record<string, unknown>)[GIFT_ON_DOCUMENTS_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null) return null;
  const form = (raw as Record<string, unknown>).form;
  // The earlier model's `show` reads as `show-zero`, like the server does.
  if (form === 'show') return 'show-zero';
  return typeof form === 'string' && (GiftDocumentFormChoiceValues as readonly string[]).includes(form)
    ? (form as GiftDocumentFormChoice)
    : null;
}

export function mergeGiftOnDocumentsConfig(
  existingConfig: Record<string, unknown>,
  next: GiftDocumentFormChoice | null,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existingConfig };
  if (next === null) delete merged[GIFT_ON_DOCUMENTS_CONFIG_KEY];
  else merged[GIFT_ON_DOCUMENTS_CONFIG_KEY] = { form: next };
  return merged;
}
