/**
 * Promotion list view model tests (#3935)
 */
import { describe, expect, it } from 'vitest';
import type { Promotion } from '../api/promotions.types';
import {
  attentionOf,
  canExtend,
  countPromotions,
  filterPromotions,
  isSelfPaused,
  movedOrder,
  promotionStateKey,
  promotionUsage,
  tabOf,
} from './promotion-view';

const base: Promotion = {
  id: 'r',
  name: 'n',
  isActive: true,
  position: 1,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [],
  benefit: {
    kind: 'free-gift',
    productId: 'p',
    variantId: 'v',
    quantity: 1,
    perUnit: null,
    skipIfPresent: true,
  },
  combinesWith: { mode: 'all' },
  limits: { unitCap: null, customerLimit: null },
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 0,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('promotionStateKey', () => {
  it('should say why a paused promotion paused', () => {
    expect(promotionStateKey({ ...base, status: 'paused', pausedReason: 'gift-out-of-stock' })).toBe('pausedStock');
    expect(promotionStateKey({ ...base, status: 'paused', pausedReason: 'unit-cap' })).toBe('pausedLimit');
  });

  it('should read a switched-off promotion as a draft and an old one as ended', () => {
    expect(promotionStateKey({ ...base, status: 'inactive' })).toBe('draft');
    expect(promotionStateKey({ ...base, status: 'ended' })).toBe('ended');
    expect(promotionStateKey({ ...base, status: 'scheduled' })).toBe('scheduled');
    expect(promotionStateKey(base)).toBe('active');
  });

  it('should tell a self-pause from a plain switch-off', () => {
    expect(isSelfPaused({ ...base, status: 'paused' })).toBe(true);
    expect(isSelfPaused({ ...base, status: 'inactive' })).toBe(false);
  });

  it('should offer to extend only an ended promotion', () => {
    expect(canExtend({ ...base, status: 'ended' })).toBe(true);
    expect(canExtend(base)).toBe(false);
  });
});

describe('movedOrder', () => {
  it('should swap a promotion with its neighbour', () => {
    expect(movedOrder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(movedOrder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('should refuse to move past either end', () => {
    expect(movedOrder(['a', 'b'], 'a', 'up')).toBeNull();
    expect(movedOrder(['a', 'b'], 'b', 'down')).toBeNull();
    expect(movedOrder(['a', 'b'], 'zzz', 'up')).toBeNull();
  });
});

describe('tabs, attention and filters', () => {
  const rows: Promotion[] = [
    { ...base, id: 'a', name: 'Mug', status: 'active' },
    { ...base, id: 'b', name: 'Tea', status: 'paused', pausedReason: 'gift-out-of-stock' },
    { ...base, id: 'c', name: 'Bag', status: 'paused', pausedReason: 'unit-cap' },
    { ...base, id: 'd', name: 'Old', status: 'ended' },
    {
      ...base,
      id: 'e',
      name: 'Shop only',
      status: 'inactive',
      conditions: [{ field: 'sourceConnectionIn', op: 'in', values: ['c1'] }],
    },
  ];

  it('should count every tab and every attention group', () => {
    const counts = countPromotions(rows);
    expect(counts.total).toBe(5);
    expect(counts.tabs).toEqual({ active: 1, paused: 2, scheduled: 0, draft: 1, ended: 1 });
    expect(counts.attention).toEqual({ stock: 1, limit: 1 });
  });

  it('should map a status to its tab and to a "to check" group', () => {
    expect(tabOf(rows[4])).toBe('draft');
    expect(attentionOf(rows[0])).toBeNull();
    expect(attentionOf(rows[2])).toBe('limit');
  });

  it('should filter by tab, attention, channel and text together', () => {
    const text = (p: Promotion): string => p.name;
    const none = { tab: null, attention: null, channelId: null, query: '' } as const;
    expect(filterPromotions(rows, { ...none, tab: 'paused' }, text)).toHaveLength(2);
    expect(filterPromotions(rows, { ...none, attention: 'stock' }, text).map((p) => p.id)).toEqual(['b']);
    expect(filterPromotions(rows, { ...none, channelId: 'c2' }, text).map((p) => p.id)).not.toContain('e');
    expect(filterPromotions(rows, { ...none, channelId: 'c1' }, text).map((p) => p.id)).toContain('e');
    expect(filterPromotions(rows, { ...none, query: ' mug ' }, text).map((p) => p.id)).toEqual(['a']);
  });
});

describe('promotionUsage', () => {
  it('should read a promotion without a cap as having no bar', () => {
    expect(promotionUsage({ unitsGiven: 5, effectiveCap: null })).toEqual({
      given: 5,
      cap: null,
      percent: null,
      full: false,
    });
  });

  it('should mark a promotion that gave its whole cap as full', () => {
    expect(promotionUsage({ unitsGiven: 100, effectiveCap: 100 }).full).toBe(true);
    expect(promotionUsage({ unitsGiven: 34, effectiveCap: 100 }).percent).toBe(34);
  });
});
