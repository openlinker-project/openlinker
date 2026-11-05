/**
 * Gift rule list view model tests (#3940)
 */
import { describe, expect, it } from 'vitest';
import type { GiftRule } from '../api/gifts.types';
import { canExtend, isSelfPaused, movedOrder, ruleStateKey } from './gift-rule-view';

const base: GiftRule = {
  id: 'r',
  name: 'n',
  isActive: true,
  position: 1,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [],
  gift: null,
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 0,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('ruleStateKey', () => {
  it('should say why a paused promotion paused', () => {
    expect(ruleStateKey({ ...base, status: 'paused', pausedReason: 'gift-out-of-stock' })).toBe('pausedStock');
    expect(ruleStateKey({ ...base, status: 'paused', pausedReason: 'unit-cap' })).toBe('pausedLimit');
  });

  it('should read a switched-off rule as a draft and an old one as ended', () => {
    expect(ruleStateKey({ ...base, status: 'inactive' })).toBe('draft');
    expect(ruleStateKey({ ...base, status: 'ended' })).toBe('ended');
    expect(ruleStateKey({ ...base, status: 'scheduled' })).toBe('scheduled');
    expect(ruleStateKey(base)).toBe('active');
  });

  it('should tell a self-pause from a plain switch-off', () => {
    expect(isSelfPaused({ ...base, status: 'paused', pausedReason: 'unit-cap' })).toBe(true);
    expect(isSelfPaused({ ...base, status: 'inactive' })).toBe(false);
  });

  it('should offer to extend only an ended promotion', () => {
    expect(canExtend({ ...base, status: 'ended' })).toBe(true);
    expect(canExtend(base)).toBe(false);
  });
});

describe('movedOrder', () => {
  it('should swap a rule with its neighbour', () => {
    expect(movedOrder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(movedOrder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('should refuse to move past either end', () => {
    expect(movedOrder(['a', 'b'], 'a', 'up')).toBeNull();
    expect(movedOrder(['a', 'b'], 'b', 'down')).toBeNull();
    expect(movedOrder(['a', 'b'], 'zzz', 'up')).toBeNull();
  });
});
