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
  fulfillmentBadge,
  fulfillmentLabel,
  healthLabel,
  rollupSyncStatus,
  slaBadge,
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
  it('should return source_deleted when recordStatus is source_deleted (highest precedence, #1689)', () => {
    const result = deriveOrderHealth(
      order({
        recordStatus: 'source_deleted',
        syncStatus: [syncEntry({ status: 'failed' })],
        mappingFailureReason: 'variant ol_variant_b deleted at the master',
      })
    );
    expect(result.key).toBe('source_deleted');
    expect(result.tone).toBe('error');
    expect(result.reason).toBe('variant ol_variant_b deleted at the master');
  });

  it('should prefer source_deleted over awaiting_mapping when recordStatus is source_deleted', () => {
    const result = deriveOrderHealth(order({ recordStatus: 'source_deleted' }));
    expect(result.key).toBe('source_deleted');
  });

  it('should return awaiting_mapping when recordStatus is awaiting_mapping (highest precedence)', () => {
    const result = deriveOrderHealth(
      order({ recordStatus: 'awaiting_mapping', syncStatus: [syncEntry({ status: 'failed' })] })
    );
    expect(result.key).toBe('awaiting_mapping');
    expect(result.tone).toBe('warning');
  });

  it('should surface mappingFailureReason on an awaiting_mapping order', () => {
    const result = deriveOrderHealth(
      order({ recordStatus: 'awaiting_mapping', mappingFailureReason: 'no offer mapping yet' })
    );
    expect(result.reason).toBe('no offer mapping yet');
  });

  it('should return needs_attention with the failed reason when a destination failed', () => {
    const result = deriveOrderHealth(
      order({ syncStatus: [syncEntry({ status: 'failed', error: 'Carrier not mapped' })] })
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
      })
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
      })
    );
    expect(result.key).toBe('awaiting_dispatch');
  });

  it('should not set a reason for non-failed buckets', () => {
    expect(
      deriveOrderHealth(order({ syncStatus: [syncEntry({ status: 'synced' })] })).reason
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
    expect(rollup).toEqual({ total: 4, failed: 1, synced: 1, pending: 2, skipped: 0 });
  });

  // #2284 — terminal, and neither failed nor pending.
  it('counts skipped_cancelled in its own bucket', () => {
    const rollup = rollupSyncStatus([
      status({ status: 'skipped_cancelled' }),
      status({ status: 'synced' }),
    ]);
    expect(rollup).toEqual({ total: 2, failed: 0, synced: 1, pending: 0, skipped: 1 });
  });
});

describe('deriveHealthLevel + healthLabel', () => {
  it('returns unknown for no destinations', () => {
    const level = deriveHealthLevel(rollupSyncStatus([]));
    expect(level).toBe('unknown');
    expect(healthLabel(level)).toBe('No destinations');
  });

  it('prioritises attention when any destination failed', () => {
    const level = deriveHealthLevel(
      rollupSyncStatus([status({ status: 'failed' }), status({ status: 'synced' })])
    );
    expect(level).toBe('attention');
    expect(healthLabel(level)).toBe('Needs attention');
  });

  it('reports pending when nothing failed but some are in flight', () => {
    expect(deriveHealthLevel(rollupSyncStatus([status({ status: 'syncing' })]))).toBe('pending');
  });

  it('does not read a skipped_cancelled destination as pending or attention', () => {
    expect(deriveHealthLevel(rollupSyncStatus([status({ status: 'skipped_cancelled' })]))).toBe(
      'healthy'
    );
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
    expect(
      syncCellLabel(rollupSyncStatus([status({ status: 'synced' }), status({ status: 'syncing' })]))
    ).toBe('1 of 2 synced');
  });
  it('surfaces the skipped count alongside the synced count', () => {
    expect(
      syncCellLabel(
        rollupSyncStatus([status({ status: 'synced' }), status({ status: 'skipped_cancelled' })])
      )
    ).toBe('1 of 2 synced (1 skipped)');
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

describe('slaBadge (#1108)', () => {
  it('returns null when there is nothing to show (none / absent)', () => {
    expect(slaBadge('none')).toBeNull();
    expect(slaBadge(undefined)).toBeNull();
  });

  it('maps each actionable bucket to its label + tone', () => {
    expect(slaBadge('overdue')).toEqual({ label: 'Overdue', tone: 'error' });
    expect(slaBadge('at_risk')).toEqual({ label: 'At risk', tone: 'warning' });
    expect(slaBadge('on_track')).toEqual({ label: 'On track', tone: 'success' });
  });
});

describe('fulfillmentBadge (#1108)', () => {
  it('treats absent (NULL) as not-shipped', () => {
    expect(fulfillmentBadge(undefined)).toEqual({ label: 'Not shipped', tone: 'neutral' });
  });

  it('maps each rollup value to its label + tone', () => {
    expect(fulfillmentBadge('not-shipped')).toEqual({ label: 'Not shipped', tone: 'neutral' });
    expect(fulfillmentBadge('dispatched')).toEqual({ label: 'Dispatched', tone: 'info' });
    expect(fulfillmentBadge('delivered')).toEqual({ label: 'Delivered', tone: 'success' });
    expect(fulfillmentBadge('failed')).toEqual({ label: 'Dispatch failed', tone: 'error' });
  });
});

describe('unrecognised state degradation (#2678)', () => {
  // An unrecognised value is reachable without any bug in the union: a rolling
  // deploy ships a new backend member before the browser bundle, a stale cached
  // bundle outlives a deploy, or a cached API response is replayed. `GET /orders`
  // is not schema-parsed, so the value arrives verbatim.
  it('renders a neutral badge naming the value, rather than throwing', () => {
    expect(fulfillmentBadge('teleported')).toEqual({
      label: 'Unknown (teleported)',
      tone: 'neutral',
    });
  });

  it('never reports an unrecognised fulfillment state as not-shipped', () => {
    // The tempting one-character fix (`?? 'not-shipped'` widened to cover the
    // miss) would say "Not shipped" about an order in an unknown state. Absent
    // and unrecognised must stay distinguishable.
    const unknown = fulfillmentBadge('teleported');
    expect(unknown).not.toEqual(fulfillmentBadge(undefined));
    expect(unknown.label).not.toBe('Not shipped');
  });

  it('truncates a pathological value so one row cannot wreck the pill', () => {
    const badge = fulfillmentBadge('x'.repeat(200));
    expect(badge.tone).toBe('neutral');
    expect(badge.label).toBe(`Unknown (${'x'.repeat(15)}…)`);
  });

  it('says only what is true when the value is blank, rather than quoting nothing', () => {
    // `Unknown ()` claims to name the offending value and names nothing. A
    // JSON "" is a real degenerate wire value, so both resolvers must reach the
    // same answer for it — `slaBadge` previously swallowed it via `!slaState`
    // into the same result as `none`, i.e. "no badge, nothing is wrong".
    expect(fulfillmentBadge('')).toEqual({ label: 'Unknown', tone: 'neutral' });
    expect(fulfillmentBadge('   ')).toEqual({ label: 'Unknown', tone: 'neutral' });
    expect(slaBadge('')).toEqual({ label: 'Unknown', tone: 'neutral' });
    // Absent still means absent, on both.
    expect(slaBadge(undefined)).toBeNull();
    expect(fulfillmentBadge(undefined)).toEqual({ label: 'Not shipped', tone: 'neutral' });
  });

  it('surfaces an unrecognised SLA bucket instead of silently dropping it', () => {
    // This one never crashed — every call site guards on `sla ?`, so an
    // unrecognised bucket rendered nothing at all. A silent drop of the signal
    // is its own defect: `none` legitimately means "no badge", so collapsing an
    // unknown bucket into it makes the two indistinguishable.
    expect(slaBadge('quantum')).toEqual({
      label: 'Unknown (quantum)',
      tone: 'neutral',
    });
    expect(slaBadge('none')).toBeNull();
  });
});
