import { describe, expect, it } from 'vitest';

import type { OrderTag } from '../api/orders.types';
import {
  NARROWING_ORDER_FILTER_KEYS,
  ORDER_FILTER_DESCRIPTORS,
  ORDER_FILTER_PARAMS,
  buildOrderFilterChips,
  countActiveOrderFilters,
  describeOrderFilterScope,
  isCountedFilter,
  parseOrderListFilterState,
  toOrderQueryFilters,
  type OrderFilterChipContext,
} from './order-filter-descriptors';

const VIP: OrderTag = {
  id: 'tag-vip',
  name: 'VIP',
  color: 'violet',
  orderCount: 42,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const ctx: OrderFilterChipContext = {
  connectionName: (id) => (id === 'conn-1' ? 'Allegro – Sklep główny' : undefined),
  tagById: (id) => (id === VIP.id ? VIP : undefined),
  formatDay: (ymd) => ymd,
};

const parse = (qs: string) => parseOrderListFilterState(new URLSearchParams(qs));

describe('ORDER_FILTER_DESCRIPTORS', () => {
  it('should map every narrowing key to a distinct URL param', () => {
    expect(new Set(ORDER_FILTER_PARAMS).size).toBe(NARROWING_ORDER_FILTER_KEYS.length);
  });

  it('should keep the pre-#3507 URL contract when the params are listed', () => {
    expect([...ORDER_FILTER_PARAMS].sort()).toEqual(
      [
        'attention',
        'createdFrom',
        'createdTo',
        'due',
        'fulfillmentState',
        'health',
        'hold',
        'invoicing',
        'openReturn',
        'packed',
        'phase',
        'search',
        'slaState',
        'sourceConnectionId',
        'tag',
        'taxRate',
        'untagged',
      ].sort(),
    );
  });

  it('should not count search, health or phase when counting active filters', () => {
    expect(isCountedFilter('search')).toBe(false);
    expect(isCountedFilter('health')).toBe(false);
    expect(isCountedFilter('phase')).toBe(false);
    expect(isCountedFilter('sourceConnectionId')).toBe(true);
  });

  it('should produce a chip for every key when each one is active on its own', () => {
    const qsByKey: Record<string, string> = {
      search: 'search=kulus',
      health: 'health=synced',
      phase: 'phase=ready',
      sourceConnectionId: 'sourceConnectionId=conn-1',
      createdFrom: 'createdFrom=2026-09-01',
      createdTo: 'createdTo=2026-09-25',
      dueBefore: 'due=breaching',
      slaState: 'slaState=overdue',
      fulfillmentState: 'fulfillmentState=not-shipped',
      packed: 'packed=false',
      holdReason: 'hold=operator',
      salesDocumentBlocked: 'invoicing=blocked',
      attention: 'attention=true',
      taxRateConflict: 'taxRate=conflict',
      openReturn: 'openReturn=true',
      tag: 'tag=tag-vip',
      untagged: 'untagged=true',
    };
    for (const key of NARROWING_ORDER_FILTER_KEYS) {
      const qs = qsByKey[key];
      expect(qs, `fixture for ${key}`).toBeDefined();
      const state = parse(qs);
      expect(ORDER_FILTER_DESCRIPTORS[key].isActive(state), key).toBe(true);
      expect(ORDER_FILTER_DESCRIPTORS[key].chip(state, ctx), key).not.toBeNull();
    }
  });
});

describe('parseOrderListFilterState', () => {
  it('should read packed=false as "not packed yet" when the URL carries it', () => {
    expect(parse('packed=false').packed).toBe(false);
    expect(parse('packed=true').packed).toBe(true);
    expect(parse('').packed).toBeUndefined();
  });

  it('should drop an unrecognised enum value when the bookmark is stale', () => {
    const state = parse('health=bogus&phase=nope&hold=zzz&slaState=x&fulfillmentState=y');
    expect(state.health).toBeUndefined();
    expect(state.phase).toBeUndefined();
    expect(state.holdReason).toBeUndefined();
    expect(state.slaState).toBeUndefined();
    expect(state.fulfillmentState).toBeUndefined();
  });
});

describe('toOrderQueryFilters', () => {
  it('should widen calendar days to inclusive UTC instants when building the query', () => {
    const f = toOrderQueryFilters(parse('createdFrom=2026-09-01&createdTo=2026-09-25'), {
      dueBefore: undefined,
      search: '',
    });
    expect(f.createdFrom).toBe('2026-09-01T00:00:00.000Z');
    expect(f.createdTo).toBe('2026-09-25T23:59:59.999Z');
  });

  it('should send present-only toggles as true or omit them when off', () => {
    const on = toOrderQueryFilters(parse('invoicing=blocked&taxRate=conflict&attention=true&openReturn=true'), {
      dueBefore: undefined,
      search: '',
    });
    expect(on).toMatchObject({
      salesDocumentBlocked: true,
      taxRateConflict: true,
      attention: true,
      openReturn: true,
    });
    const off = toOrderQueryFilters(parse(''), { dueBefore: undefined, search: '' });
    expect(off.salesDocumentBlocked).toBeUndefined();
    expect(off.search).toBeUndefined();
  });
});

describe('buildOrderFilterChips', () => {
  it('should fold both date bounds into one chip that clears both when removed', () => {
    const chips = buildOrderFilterChips(parse('createdFrom=2026-09-01&createdTo=2026-09-25'), ctx);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      label: 'Created',
      valueText: '2026-09-01 – 2026-09-25',
      clears: ['createdFrom', 'createdTo'],
    });
  });

  it('should name the source by connection and the tag by its pill when both are active', () => {
    const chips = buildOrderFilterChips(parse('sourceConnectionId=conn-1&tag=tag-vip'), ctx);
    expect(chips.map((c) => [c.label, c.valueText])).toEqual([
      ['Source', 'Allegro – Sklep główny'],
      ['Tag', 'VIP'],
    ]);
    expect(chips[1].tag).toBe(VIP);
    expect(chips[1].clears).toEqual(['tag', 'untagged']);
  });

  it('should leave search, health and phase out of the chip row when only they are active', () => {
    const state = parse('search=kulus&health=synced&phase=ready');
    expect(buildOrderFilterChips(state, ctx)).toEqual([]);
    expect(countActiveOrderFilters(state, ctx)).toBe(0);
  });
});

describe('describeOrderFilterScope', () => {
  it('should describe every narrowing axis including status and search when filtered', () => {
    expect(describeOrderFilterScope(parse('health=needs_attention&sourceConnectionId=conn-1'), ctx)).toBe(
      'Status Needs attention · Source Allegro – Sklep główny',
    );
  });

  it('should return an empty string when the view is unfiltered', () => {
    expect(describeOrderFilterScope(parse(''), ctx)).toBe('');
  });
});
