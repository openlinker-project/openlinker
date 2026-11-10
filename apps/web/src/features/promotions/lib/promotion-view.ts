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

export const RULE_STATE_TONE: Record<GiftRuleStateKey, 'success' | 'info' | 'warning' | 'neutral'> = {
  active: 'success',
  scheduled: 'info',
  pausedStock: 'warning',
  pausedLimit: 'warning',
  draft: 'neutral',
  ended: 'neutral',
};

export interface GiftRuleCounts {
  total: number;
  active: number;
  pausedStock: number;
  pausedLimit: number;
}

/** The numbers the list's first two cards show. */
export function countRules(rules: readonly GiftRule[]): GiftRuleCounts {
  const counts: GiftRuleCounts = { total: rules.length, active: 0, pausedStock: 0, pausedLimit: 0 };
  for (const rule of rules) {
    const state = ruleStateKey(rule);
    if (state === 'active') counts.active += 1;
    else if (state === 'pausedStock') counts.pausedStock += 1;
    else if (state === 'pausedLimit') counts.pausedLimit += 1;
  }
  return counts;
}
