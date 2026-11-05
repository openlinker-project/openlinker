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
import type { AutomationRun } from '../../automation';

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

const NOT_ADDED = /^No gift added: (.+)\.$/;

/** Kinds that mean the seller may need to act; the rest explain a rule that behaved as set. */
export const GIFT_ATTENTION_ACTIONABLE: readonly GiftAttentionKind[] = [
  'out-of-stock',
  'stock-unknown',
  'limit-reached',
  'failed',
  'other',
];

function giftStep(run: AutomationRun): AutomationRun['steps'][number] | undefined {
  return run.steps.find((s) => s.action === 'add-gift');
}

/** The structured code when the run has one; the sentence is the fallback for older runs. */
function reasonOf(run: AutomationRun): string | null {
  const step = giftStep(run);
  if (step === undefined) return null;
  if (step.reasonCode != null) return step.reasonCode;
  const text = step.detail ?? step.report?.message ?? null;
  return text === null ? null : (NOT_ADDED.exec(text)?.[1] ?? null);
}

/**
 * The latest firing of each gift rule on this order that did not give its gift.
 * A firing that gave the gift, or one a person already handled, is not listed.
 */
export function readGiftAttention(runs: readonly AutomationRun[]): GiftAttentionItem[] {
  const newestFirst = [...runs]
    .filter((run) => run.trigger === 'order.ingested' && run.steps.some((s) => s.action === 'add-gift'))
    .sort((a, b) => b.firedAt.localeCompare(a.firedAt));
  const seen = new Set<string>();
  const items: GiftAttentionItem[] = [];
  for (const run of newestFirst) {
    if (seen.has(run.ruleId)) continue;
    seen.add(run.ruleId);
    if (run.outcome === 'done' || run.dismissedAt !== null) continue;
    if (run.outcome === 'failed') {
      items.push({ kind: 'failed', ruleId: run.ruleId, ruleName: run.ruleName, firedAt: run.firedAt });
      continue;
    }
    const reason = reasonOf(run);
    if (reason === 'gift-already-in-order') continue;
    items.push({
      kind: reason === null ? 'other' : (REASON_KIND[reason] ?? 'other'),
      ruleId: run.ruleId,
      ruleName: run.ruleName,
      firedAt: run.firedAt,
    });
  }
  return items;
}
