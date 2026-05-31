/**
 * deriveOrderHealth tests (#929)
 *
 * Asserts the canonical four-way precedence — the FE twin of the SQL `CASE` in
 * `OrderRecordRepository`. The failed+synced → needs_attention case is the key
 * precedence assertion shared with the backend integration test.
 */
import { describe, it, expect } from 'vitest';
import { deriveOrderHealth } from './order-health';
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
    expect(deriveOrderHealth(order({ syncStatus: [syncEntry({ status: 'synced' })] })).reason).toBeUndefined();
  });
});
