/**
 * order-health derivation tests
 *
 * Covers both models in `order-health.ts`:
 * — `deriveOrderHealth` (#929): the canonical four-way precedence, the FE twin
 *   of the SQL in `OrderRecordRepository` (failed+synced → needs_attention is
 *   the key shared assertion).
 * — the detail-header rollup + fulfillment helpers (#924/#930).
 */
import { describe, expect, it } from 'vitest';
import {
  deriveFulfillment,
  deriveHealthLevel,
  deriveOrderHealth,
  fulfillmentLabel,
  healthLabel,
  rollupSyncStatus,
  syncCellLabel,
  totalUnits,
} from './order-health';
import type { OrderRecord, OrderSyncStatus } from '../api/orders.types';

function syncEntry(overrides: Partial<OrderSyncStatus>): OrderSyncStatus {
  return {
    destinationConnectionId: 'conn_ps_1',
    status: 'pending',
    syncedAt: null,
    externalOrderId: null,
    externalOrderNumber: null,
    error: null,
    ...overrides,
  };
}

function order(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    internalOrderId: 'ol_order_1',
    customerId: null,
    sourceConnectionId: 'conn_allegro_1',
    sourceEventId: null,
    orderSnapshot: {},
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveOrderHealth', () => {
  it('should return awaiting_mapping when recordStatus is awaiting_mapping (highest precedence)', () => {
    const result = deriveOrderHealth(
      order({ recordStatus: 'awaiting_mapping', syncStatus: [syncEntry({ status: 'failed' })] }),
    );
    expect(result.key).toBe('awaiting_mapping');
    expect(result.tone).toBe('warning');
  });

  it('should return needs_attention with the failed reason when a destination failed', () => {
    const result = deriveOrderHealth(
      order({ syncStatus: [syncEntry({ status: 'failed', error: 'Carrier not mapped' })] }),
    );
    expect(result.key).toBe('needs_attention');
    expect(result.tone).toBe('error');
    expect(result.reason).toBe('Carrier not mapped');
  });

  it('should prefer needs_attention over synced when both a failed and a synced destination exist', () => {
    const result = deriveOrderHealth(
      order({
        syncStatus: [
          syncEntry({ destinationConnectionId: 'a', status: 'synced' }),
          syncEntry({ destinationConnectionId: 'b', status: 'failed' }),
        ],
      }),
    );
    expect(result.key).toBe('needs_attention');
  });

  it('should return synced when ready, no failed, and a destination is synced', () => {
    const result = deriveOrderHealth(order({ syncStatus: [syncEntry({ status: 'synced' })] }));
    expect(result.key).toBe('synced');
    expect(result.tone).toBe('success');
  });

  it('should return awaiting_dispatch for an empty syncStatus', () => {
    const result = deriveOrderHealth(order({ syncStatus: [] }));
    expect(result.key).toBe('awaiting_dispatch');
    expect(result.tone).toBe('info');
  });

  it('should return awaiting_dispatch when destinations are only pending/syncing', () => {
    const result = deriveOrderHealth(
      order({
        syncStatus: [
          syncEntry({ destinationConnectionId: 'a', status: 'pending' }),
          syncEntry({ destinationConnectionId: 'b', status: 'syncing' }),
        ],
      }),
    );
    expect(result.key).toBe('awaiting_dispatch');
  });

  it('should not set a reason for non-failed buckets', () => {
    expect(
      deriveOrderHealth(order({ syncStatus: [syncEntry({ status: 'synced' })] })).reason,
    ).toBeUndefined();
  });
});

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
