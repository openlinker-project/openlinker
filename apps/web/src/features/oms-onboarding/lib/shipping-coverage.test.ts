import { describe, expect, it } from 'vitest';

import type { Connection } from '../../connections';
import type { RoutingRule } from '../../mappings';
import {
  countRoutedMethods,
  coverageBadge,
  selectCarriers,
  selectOrderSources,
  summariseShippingCoverage,
} from './shipping-coverage';

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: 'c1',
    name: 'Shop',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rule(overrides: Partial<RoutingRule>): RoutingRule {
  return {
    id: 'r1',
    sourceConnectionId: 'src',
    sourceDeliveryMethodId: 'm1',
    processorKind: 'ol_managed_carrier',
    processorConnectionId: 'inpost',
    ...overrides,
  };
}

describe('selectOrderSources', () => {
  it('should keep active order sources and drop the packing connection', () => {
    const source = connection({ id: 'a', enabledCapabilities: ['OrderSource'], supportedCapabilities: ['OrderSource'] });
    const packing = connection({ id: 'pack', enabledCapabilities: ['OrderSource'], supportedCapabilities: ['OrderSource'] });
    const off = connection({ id: 'b', status: 'disabled', enabledCapabilities: ['OrderSource'], supportedCapabilities: ['OrderSource'] });
    const notEnabled = connection({ id: 'c', supportedCapabilities: ['OrderSource'] });
    expect(selectOrderSources([source, packing, off, notEnabled], 'pack')).toEqual([source]);
  });
});

describe('selectCarriers', () => {
  it('should keep active connections that can buy labels', () => {
    const inpost = connection({ id: 'inpost', enabledCapabilities: ['ShippingProviderManager'] });
    const off = connection({ id: 'dpd', status: 'disabled', enabledCapabilities: ['ShippingProviderManager'] });
    expect(selectCarriers([inpost, off, connection({ id: 'x' })])).toEqual([inpost]);
  });
});

describe('countRoutedMethods', () => {
  const methods = new Set(['m1', 'm2', 'm3']);

  it('should count routes that buy a label to an active carrier, or through the source', () => {
    const rules = [
      rule({ sourceDeliveryMethodId: 'm1' }),
      rule({ sourceDeliveryMethodId: 'm2', processorKind: 'source_brokered', processorConnectionId: 'src' }),
      rule({ sourceDeliveryMethodId: 'm3', processorKind: 'omp_fulfilled', processorConnectionId: 'shop' }),
    ];
    expect(countRoutedMethods(methods, rules, new Set(['inpost']))).toBe(2);
  });

  it('should not count a route to a switched-off carrier or to a method no longer listed', () => {
    const rules = [rule({ sourceDeliveryMethodId: 'm1' }), rule({ sourceDeliveryMethodId: 'gone' })];
    expect(countRoutedMethods(methods, rules, new Set())).toBe(0);
    expect(countRoutedMethods(methods, rules, new Set(['inpost']))).toBe(1);
  });
});

describe('coverageBadge', () => {
  it('should read to do, partly set and all set', () => {
    expect(coverageBadge({ status: 'ready', withCarrier: 0, total: 4 })).toBe('todo');
    expect(coverageBadge({ status: 'ready', withCarrier: 2, total: 4 })).toBe('partly');
    expect(coverageBadge({ status: 'ready', withCarrier: 4, total: 4 })).toBe('all');
  });
});

describe('summariseShippingCoverage', () => {
  it('should add up ready sources and stay unsettled while one is loading', () => {
    expect(
      summariseShippingCoverage(['a', 'b', 'c'], {
        a: { status: 'ready', withCarrier: 2, total: 3 },
        b: { status: 'cannot-list', withCarrier: 0, total: 0 },
        c: { status: 'loading', withCarrier: 0, total: 0 },
      })
    ).toEqual({ withCarrier: 2, total: 3, settled: false, unknown: false });
  });

  it('should report a source whose rules could not be read', () => {
    expect(
      summariseShippingCoverage(['a'], { a: { status: 'unknown', withCarrier: 0, total: 3 } })
    ).toEqual({ withCarrier: 0, total: 0, settled: true, unknown: true });
  });
});
