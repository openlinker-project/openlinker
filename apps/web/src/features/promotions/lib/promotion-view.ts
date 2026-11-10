/**
 * Promotion list view model (#3935)
 *
 * What a promotions row says about itself: the state word, whether it paused by
 * itself (and why), the usage bar, which tab it belongs to and which "to check"
 * group it counts in. Pure, so the list, the peek and their tests share one
 * reading.
 *
 * @module apps/web/src/features/promotions/lib
 */
import type { Promotion } from '../api/promotions.types';

export type PromotionStateKey =
  | 'active'
  | 'scheduled'
  | 'pausedStock'
  | 'pausedLimit'
  | 'draft'
  | 'ended';

export function promotionStateKey(promotion: Pick<Promotion, 'status' | 'pausedReason'>): PromotionStateKey {
  if (promotion.status === 'ended') return 'ended';
  if (promotion.status === 'inactive') return 'draft';
  if (promotion.status === 'scheduled') return 'scheduled';
  if (promotion.status === 'paused') {
    return promotion.pausedReason === 'unit-cap' ? 'pausedLimit' : 'pausedStock';
  }
  return 'active';
}

/** True when OpenLinker paused the promotion by itself, so the operator is told why. */
export function isSelfPaused(promotion: Pick<Promotion, 'status'>): boolean {
  return promotion.status === 'paused';
}

/** Moving a promotion up or down by one; `null` when it is already at that end. */
export function movedOrder(
  ids: readonly string[],
  id: string,
  direction: 'up' | 'down',
): string[] | null {
  const index = ids.indexOf(id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** An ended promotion can be extended: new end date, active again. */
export function canExtend(promotion: Pick<Promotion, 'status'>): boolean {
  return promotion.status === 'ended';
}

export const PROMOTION_STATE_TONE: Record<PromotionStateKey, 'success' | 'info' | 'warning' | 'neutral'> = {
  active: 'success',
  scheduled: 'info',
  pausedStock: 'warning',
  pausedLimit: 'warning',
  draft: 'neutral',
  ended: 'neutral',
};

export const PromotionTabValues = ['active', 'paused', 'scheduled', 'draft', 'ended'] as const;
export type PromotionTab = (typeof PromotionTabValues)[number];

export function tabOf(promotion: Pick<Promotion, 'status'>): PromotionTab {
  switch (promotion.status) {
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'scheduled':
      return 'scheduled';
    case 'ended':
      return 'ended';
    case 'inactive':
      return 'draft';
  }
}

export const PromotionAttentionValues = ['stock', 'limit'] as const;
export type PromotionAttention = (typeof PromotionAttentionValues)[number];

/** The "to check" group a promotion counts in, or `null` when it needs nothing. */
export function attentionOf(promotion: Pick<Promotion, 'status' | 'pausedReason'>): PromotionAttention | null {
  if (promotion.status !== 'paused') return null;
  return promotion.pausedReason === 'unit-cap' ? 'limit' : 'stock';
}

export interface PromotionCounts {
  total: number;
  tabs: Record<PromotionTab, number>;
  attention: Record<PromotionAttention, number>;
}

export function countPromotions(promotions: readonly Promotion[]): PromotionCounts {
  const counts: PromotionCounts = {
    total: promotions.length,
    tabs: { active: 0, paused: 0, scheduled: 0, draft: 0, ended: 0 },
    attention: { stock: 0, limit: 0 },
  };
  for (const promotion of promotions) {
    counts.tabs[tabOf(promotion)] += 1;
    const attention = attentionOf(promotion);
    if (attention !== null) counts.attention[attention] += 1;
  }
  return counts;
}

export interface PromotionListFilters {
  tab: PromotionTab | null;
  attention: PromotionAttention | null;
  channelId: string | null;
  query: string;
}

/** The channel ids a promotion covers; empty means every channel. */
export function promotionChannelIds(promotion: Pick<Promotion, 'conditions'>): string[] {
  const channels = promotion.conditions.find((c) => c.field === 'sourceConnectionIn');
  return channels && channels.field === 'sourceConnectionIn' ? [...channels.values] : [];
}

export function filterPromotions(
  promotions: readonly Promotion[],
  filters: PromotionListFilters,
  searchText: (promotion: Promotion) => string,
): Promotion[] {
  const query = filters.query.trim().toLowerCase();
  return promotions.filter((promotion) => {
    if (filters.tab !== null && tabOf(promotion) !== filters.tab) return false;
    if (filters.attention !== null && attentionOf(promotion) !== filters.attention) return false;
    if (filters.channelId !== null) {
      const ids = promotionChannelIds(promotion);
      if (ids.length > 0 && !ids.includes(filters.channelId)) return false;
    }
    if (query !== '' && !searchText(promotion).toLowerCase().includes(query)) return false;
    return true;
  });
}

export interface PromotionUsage {
  given: number;
  cap: number | null;
  /** 0..100, `null` without a cap. */
  percent: number | null;
  full: boolean;
}

export function promotionUsage(promotion: Pick<Promotion, 'unitsGiven' | 'effectiveCap'>): PromotionUsage {
  const { unitsGiven: given, effectiveCap: cap } = promotion;
  if (cap === null || cap <= 0) return { given, cap: null, percent: null, full: false };
  const percent = Math.min(100, Math.round((given / cap) * 100));
  return { given, cap, percent, full: given >= cap };
}
