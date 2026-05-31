import { describe, expect, it } from 'vitest';
import type { OrderSyncStatus } from '../api/orders.types';
import {
  deriveFulfillment,
  deriveHealthLevel,
  fulfillmentLabel,
  healthLabel,
  rollupSyncStatus,
  syncCellLabel,
  totalUnits,
} from './order-health';

function status(over: Partial<OrderSyncStatus>): OrderSyncStatus {
  return {
    destinationConnectionId: 'conn-1',
    status: 'synced',
    syncedAt: null,
    externalOrderId: null,
    externalOrderNumber: null,
    error: null,
    ...over,
  };
}

describe('rollupSyncStatus', () => {
  it('counts failed, synced and pending (pending + syncing) buckets', () => {
    const rollup = rollupSyncStatus([
      status({ status: 'failed' }),
      status({ status: 'synced' }),
      status({ status: 'pending' }),
      status({ status: 'syncing' }),
    ]);
    expect(rollup).toEqual({ total: 4, failed: 1, synced: 1, pending: 2 });
  });
});

describe('deriveHealthLevel + healthLabel', () => {
  it('returns unknown for no destinations', () => {
    const level = deriveHealthLevel(rollupSyncStatus([]));
    expect(level).toBe('unknown');
    expect(healthLabel(level)).toBe('No destinations');
  });

  it('prioritises attention when any destination failed', () => {
    const level = deriveHealthLevel(rollupSyncStatus([status({ status: 'failed' }), status({ status: 'synced' })]));
    expect(level).toBe('attention');
    expect(healthLabel(level)).toBe('Needs attention');
  });

  it('reports pending when nothing failed but some are in flight', () => {
    expect(deriveHealthLevel(rollupSyncStatus([status({ status: 'syncing' })]))).toBe('pending');
  });

  it('reports healthy when all synced', () => {
    const level = deriveHealthLevel(rollupSyncStatus([status({ status: 'synced' })]));
    expect(level).toBe('healthy');
    expect(healthLabel(level)).toBe('Synced');
  });
});

describe('syncCellLabel', () => {
  it('leads with failures when present', () => {
    expect(syncCellLabel(rollupSyncStatus([status({ status: 'failed' })]))).toBe('1 of 1 failed');
  });
  it('reports synced count otherwise', () => {
    expect(syncCellLabel(rollupSyncStatus([status({ status: 'synced' }), status({ status: 'syncing' })]))).toBe(
      '1 of 2 synced',
    );
  });
  it('handles no destinations', () => {
    expect(syncCellLabel(rollupSyncStatus([]))).toBe('No destinations');
  });
});

describe('deriveFulfillment + fulfillmentLabel', () => {
  it('is unavailable without a shipping capability', () => {
    expect(deriveFulfillment(['dispatched'], false)).toBe('unavailable');
    expect(fulfillmentLabel('unavailable')).toBe('Not tracked');
  });

  it('is not-shipped when capable but no shipment exists', () => {
    expect(deriveFulfillment(null, true)).toBe('not-shipped');
    expect(deriveFulfillment([], true)).toBe('not-shipped');
  });

  it('prefers delivered over in-flight states', () => {
    expect(deriveFulfillment(['dispatched', 'delivered'], true)).toBe('delivered');
  });

  it('reports dispatched for generated / dispatched / in-transit', () => {
    expect(deriveFulfillment(['generated'], true)).toBe('dispatched');
    expect(deriveFulfillment(['in-transit'], true)).toBe('dispatched');
  });

  it('reports failed only when every shipment is terminal-bad', () => {
    expect(deriveFulfillment(['failed', 'cancelled'], true)).toBe('failed');
    expect(fulfillmentLabel('failed')).toBe('Dispatch failed');
  });
});

describe('totalUnits', () => {
  it('sums item quantities', () => {
    expect(totalUnits([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
    expect(totalUnits([])).toBe(0);
  });
});
