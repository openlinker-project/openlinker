/**
 * Why an order has no gift it should have (#3940)
 *
 * The gift evaluator records a run per rule that matched an order and could not
 * give its gift (and every one that failed outright). The order page reads those
 * rows. The reason travels inside the run's sentence ("No gift added: <reason>."),
 * so it is read back with one pattern here and unknown reasons stay generic: a
 * reason this build does not know is shown, never turned into a different one.
 *
 * @module apps/web/src/features/gifts/lib
 */
import type { GiftAttentionEntry } from '../api/gifts.types';

export const GiftAttentionKindValues = [
  'out-of-stock',
  'stock-unknown',
  'limit-reached',
  'customer-limit',
  'customer-unknown',
  'below-threshold',
  'superseded',
  'failed',
  'other',
] as const;
export type GiftAttentionKind = (typeof GiftAttentionKindValues)[number];

export interface GiftAttentionItem {
  /** The firing, so the seller's decision can be recorded against it. */
  runId: string;
  kind: GiftAttentionKind;
  ruleId: string;
  ruleName: string;
  firedAt: string;
}

const REASON_KIND: Record<string, GiftAttentionKind> = {
  'gift-out-of-stock': 'out-of-stock',
  'gift-stock-unknown': 'stock-unknown',
  'paused-unit-cap': 'limit-reached',
  'unit-cap-reached': 'limit-reached',
  'customer-limit-reached': 'customer-limit',
  'customer-unknown': 'customer-unknown',
  'below-per-unit-threshold': 'below-threshold',
  'superseded-by-earlier-rule': 'superseded',
};

/** Kinds that mean the seller may need to act; the rest explain a rule that behaved as set. */
export const GIFT_ATTENTION_ACTIONABLE: readonly GiftAttentionKind[] = [
  'out-of-stock',
  'stock-unknown',
  'limit-reached',
  'failed',
  'other',
];

/**
 * The latest firing of each gift rule on this order that did not give its gift.
 * The API already answers one entry per rule; a firing a person handled, or one
 * whose gift was already in the order, is not listed.
 */
export function readGiftAttention(entries: readonly GiftAttentionEntry[]): GiftAttentionItem[] {
  const items: GiftAttentionItem[] = [];
  for (const entry of entries) {
    if (entry.dismissed) continue;
    if (entry.outcome === 'failed') {
      items.push({ runId: entry.runId, kind: 'failed', ruleId: entry.ruleId, ruleName: entry.ruleName, firedAt: entry.firedAt });
      continue;
    }
    if (entry.reasonCode === 'gift-already-in-order') continue;
    items.push({
      runId: entry.runId,
      kind: entry.reasonCode === null ? 'other' : (REASON_KIND[entry.reasonCode] ?? 'other'),
      ruleId: entry.ruleId,
      ruleName: entry.ruleName,
      firedAt: entry.firedAt,
    });
  }
  return items;
}
