/**
 * Gift rule list view model (#3940)
 *
 * What a promotions row says about itself: the state word, whether it is a
 * self-pause (and why), and the "given" figure. Pure, so the list and its tests
 * share one reading.
 *
 * @module apps/web/src/features/gifts/lib
 */
import type { GiftRule } from '../api/gifts.types';

export type GiftRuleStateKey =
  | 'active'
  | 'scheduled'
  | 'pausedStock'
  | 'pausedLimit'
  | 'draft'
  | 'ended';

export function ruleStateKey(rule: GiftRule): GiftRuleStateKey {
  if (rule.status === 'ended') return 'ended';
  if (rule.status === 'inactive') return 'draft';
  if (rule.status === 'scheduled') return 'scheduled';
  if (rule.status === 'paused') {
    return rule.pausedReason === 'unit-cap' ? 'pausedLimit' : 'pausedStock';
  }
  return 'active';
}

/** True when OpenLinker paused the rule by itself, so the operator is told why. */
export function isSelfPaused(rule: GiftRule): boolean {
  return rule.status === 'paused';
}

/** Moving a rule up or down by one; `null` when it is already at that end. */
export function movedOrder(
  ruleIds: readonly string[],
  ruleId: string,
  direction: 'up' | 'down',
): string[] | null {
  const index = ruleIds.indexOf(ruleId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ruleIds.length) return null;
  const next = [...ruleIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** An ended rule can be extended: new end date, active again. */
export function canExtend(rule: GiftRule): boolean {
  return rule.status === 'ended';
}
