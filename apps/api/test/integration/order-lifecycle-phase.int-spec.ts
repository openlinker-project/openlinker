/**
 * Order Lifecycle Phase Integration Test (#2309, ADR-059)
 *
 * Exercises the real `OrderRecordRepository` derived-phase `CASE` against
 * Testcontainers Postgres — the only reliable cover for SQL that exists solely
 * to be the twin of a TypeScript function.
 *
 * **The load-bearing assertion is the cross-check**: every seeded row is read
 * back, classified in TS by the authoritative `deriveOrderLifecyclePhase`, and
 * the `lifecyclePhase` filter's row set is asserted EQUAL to the TS-classified
 * id set, per phase. Two producers, one rule — this is the only guard that the
 * SQL and the pure function agree until #2311's static mirror script lands.
 *
 * Also pins: the bucket partition (`total` = Σ nine buckets), the three
 * placeholder arms as inert (structurally 0 / empty, not accidentally matching),
 * and — separately — that `OrderHealth` counts and filtering are unchanged by a
 * second orthogonal partition sharing the same table.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';
import type { OrderLifecyclePhase } from '@openlinker/core/order-lifecycle';
import {
  OrderLifecyclePhaseValues,
  deriveOrderLifecyclePhase,
  DEFAULT_LIFECYCLE_AUTHORITY,
} from '@openlinker/core/order-lifecycle';

const SOURCE_A = '11111111-1111-4111-8111-111111111111';
const SOURCE_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAGE = { limit: 100, offset: 0 };

/** Phases with no persisted source in Wave 1a — their SQL arms are `FALSE`. */
const UNREACHABLE_PHASES: OrderLifecyclePhase[] = ['vendor_authoritative', 'held', 'amending'];

describe('Order lifecycle phase (integration)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /**
   * One row per REACHABLE phase, plus the precedence cases a mis-ordered `CASE`
   * would get wrong (cancel over a shipment; a fulfilment outcome over an ingest
   * gap; NULL rollup ≡ not-shipped).
   */
  async function seedPhaseSet(): Promise<void> {
    const ds = harness.getDataSource();

    // cancelled — wins over a dispatched shipment (ladder arm 1 over arm 4).
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      cancelledAt: new Date('2026-01-02T03:04:05.000Z'),
      fulfillmentState: 'dispatched',
    });
    // cancelled — plain.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      cancelledAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    // delivered.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      fulfillmentState: 'delivered',
    });
    // delivered — a fulfilment outcome outranks an ingest gap (arm 3 over arm 8).
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'awaiting_mapping',
      fulfillmentState: 'delivered',
    });
    // in_transit — the rollup has no `in-transit` value; `dispatched` is it.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      fulfillmentState: 'dispatched',
    });
    // fulfillment_failed.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      fulfillmentState: 'failed',
    });
    // blocked — awaiting_mapping.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'awaiting_mapping',
    });
    // blocked — source_deleted.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'source_deleted',
    });
    // ready — NULL rollup ≡ not-shipped.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      fulfillmentState: null,
    });
    // ready — explicit not-shipped, so the COALESCE and the literal agree.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      fulfillmentState: 'not-shipped',
    });
    // A second source, to prove the scope arms still apply to the summary.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_B,
      recordStatus: 'ready',
      fulfillmentState: 'delivered',
    });
  }

  /**
   * Classify every persisted row with the AUTHORITATIVE pure function, reading
   * the same inputs the controller's `toDto` passes.
   *
   * `activeHoldReason` is a REAL read since #2340 — hardcoding `null` here
   * would silently exempt the one input whose SQL arm this spec exists to hold
   * the TS ladder against.
   */
  async function classifyInTypescript(): Promise<Map<OrderLifecyclePhase, Set<string>>> {
    const { items } = await repository.findMany({}, PAGE);
    const byPhase = new Map<OrderLifecyclePhase, Set<string>>(
      OrderLifecyclePhaseValues.map((phase) => [phase, new Set<string>()])
    );
    for (const order of items) {
      const phase = deriveOrderLifecyclePhase({
        cancelledAt: order.cancelledAt ?? null,
        fulfillmentState: order.fulfillmentState,
        activeHoldReason: order.activeHoldReason,
        hasOpenAmendment: false,
        recordStatus: order.recordStatus,
        authority: DEFAULT_LIFECYCLE_AUTHORITY,
        vendorDeclaredPhase: null,
      });
      byPhase.get(phase)?.add(order.internalOrderId);
    }
    return byPhase;
  }

  it('returns exactly the TS-classified row set for every phase', async () => {
    await seedPhaseSet();
    const expected = await classifyInTypescript();

    for (const phase of OrderLifecyclePhaseValues) {
      const { items, total } = await repository.findMany({ lifecyclePhase: phase }, PAGE);
      const fromSql = [...items.map((order) => order.internalOrderId)].sort();

      // Sorted arrays so a failure names the offending ids rather than "Set !== Set".
      expect({ phase, ids: fromSql }).toEqual({
        phase,
        ids: [...(expected.get(phase) ?? new Set<string>())].sort(),
      });
      expect(total).toBe(expected.get(phase)?.size ?? 0);
    }
  });

  it('classifies the precedence cases the same way as the TS ladder', async () => {
    await seedPhaseSet();

    // A cancel outranks the dispatched shipment: 2 cancelled, and neither leaks
    // into in_transit.
    const cancelled = await repository.findMany({ lifecyclePhase: 'cancelled' }, PAGE);
    expect(cancelled.total).toBe(2);

    const inTransit = await repository.findMany({ lifecyclePhase: 'in_transit' }, PAGE);
    expect(inTransit.total).toBe(1);
    expect(inTransit.items[0].cancelledAt).toBeNull();

    // A fulfilment outcome outranks an ingest gap: the awaiting_mapping+delivered
    // row is `delivered`, not `blocked`.
    const delivered = await repository.findMany({ lifecyclePhase: 'delivered' }, PAGE);
    expect(delivered.total).toBe(3); // 2 under SOURCE_A + 1 under SOURCE_B
    expect(delivered.items.some((order) => order.recordStatus === 'awaiting_mapping')).toBe(true);

    const blocked = await repository.findMany({ lifecyclePhase: 'blocked' }, PAGE);
    expect(blocked.total).toBe(2);
    expect(blocked.items.map((order) => order.recordStatus).sort()).toEqual([
      'awaiting_mapping',
      'source_deleted',
    ]);

    // NULL rollup ≡ not-shipped, so both plain rows land in `ready`.
    const ready = await repository.findMany({ lifecyclePhase: 'ready' }, PAGE);
    expect(ready.total).toBe(2);
  });

  it('partitions records into phase buckets that sum to the total', async () => {
    await seedPhaseSet();

    const summary = await repository.countByLifecyclePhase({});

    expect(summary.total).toBe(11);
    expect(summary.cancelled).toBe(2);
    expect(summary.delivered).toBe(3);
    expect(summary.inTransit).toBe(1);
    expect(summary.fulfillmentFailed).toBe(1);
    expect(summary.blocked).toBe(2);
    expect(summary.ready).toBe(2);

    const bucketSum =
      summary.cancelled +
      summary.vendorAuthoritative +
      summary.delivered +
      summary.inTransit +
      summary.fulfillmentFailed +
      summary.held +
      summary.amending +
      summary.blocked +
      summary.ready;
    expect(bucketSum).toBe(summary.total);
  });

  it('agrees bucket-for-bucket with the per-phase filter row counts', async () => {
    await seedPhaseSet();

    const summary = await repository.countByLifecyclePhase({});
    const byPhase: Record<OrderLifecyclePhase, number> = {
      cancelled: summary.cancelled,
      vendor_authoritative: summary.vendorAuthoritative,
      delivered: summary.delivered,
      in_transit: summary.inTransit,
      fulfillment_failed: summary.fulfillmentFailed,
      held: summary.held,
      amending: summary.amending,
      blocked: summary.blocked,
      ready: summary.ready,
    };

    for (const phase of OrderLifecyclePhaseValues) {
      const { total } = await repository.findMany({ lifecyclePhase: phase }, PAGE);
      expect({ phase, total }).toEqual({ phase, total: byPhase[phase] });
    }
  });

  it('honours the source scope on the summary', async () => {
    await seedPhaseSet();

    const summary = await repository.countByLifecyclePhase({ sourceConnectionId: SOURCE_B });

    expect(summary.total).toBe(1);
    expect(summary.delivered).toBe(1);
    expect(summary.ready).toBe(0);
  });

  it('leaves the three Wave-2/4 placeholder arms inert — 0 counts and no rows', async () => {
    await seedPhaseSet();

    const summary = await repository.countByLifecyclePhase({});

    for (const phase of UNREACHABLE_PHASES) {
      const { items, total } = await repository.findMany({ lifecyclePhase: phase }, PAGE);
      expect({ phase, total }).toEqual({ phase, total: 0 });
      expect(items).toEqual([]);
    }
    expect(summary.vendorAuthoritative).toBe(0);
    expect(summary.held).toBe(0);
    expect(summary.amending).toBe(0);
  });

  it('ignores the cancelled scope — cancellation is the partition own top arm', async () => {
    await seedPhaseSet();

    const unscoped = await repository.countByLifecyclePhase({});
    // `cancelled: false` would empty the `cancelled` bucket while still labelling
    // it a count of cancellations; the summary therefore does not read the arm.
    const scoped = await repository.countByLifecyclePhase({ cancelled: false });

    expect(scoped).toEqual(unscoped);
    expect(scoped.cancelled).toBe(2);
  });

  describe('OrderHealth is unaffected by the second orthogonal partition', () => {
    it('keeps its bucket counts and its filter behaviour', async () => {
      await seedPhaseSet();

      const health = await repository.countByHealth({});

      // 11 rows: 1 source_deleted, 2 awaiting_mapping, the rest residual
      // (`syncStatus` is the fixture default `pending`, so none are synced/failed).
      expect(health.total).toBe(11);
      expect(health.sourceDeleted).toBe(1);
      expect(health.awaitingMapping).toBe(2);
      expect(health.needsAttention).toBe(0);
      expect(health.synced).toBe(0);
      expect(health.awaitingDispatch).toBe(8);
      expect(
        health.sourceDeleted +
          health.awaitingMapping +
          health.needsAttention +
          health.synced +
          health.awaitingDispatch
      ).toBe(health.total);

      const mapping = await repository.findMany({ health: 'awaiting_mapping' }, PAGE);
      expect(mapping.total).toBe(2);
      const deleted = await repository.findMany({ health: 'source_deleted' }, PAGE);
      expect(deleted.total).toBe(1);
    });

    it('composes with the phase filter rather than competing with it', async () => {
      await seedPhaseSet();

      // The awaiting_mapping+delivered row is `delivered` on one axis and
      // `awaiting_mapping` on the other — ANDing them must return exactly it.
      const both = await repository.findMany(
        { health: 'awaiting_mapping', lifecyclePhase: 'delivered' },
        PAGE
      );

      expect(both.total).toBe(1);
      expect(both.items[0].recordStatus).toBe('awaiting_mapping');
      expect(both.items[0].fulfillmentState).toBe('delivered');
    });
  });
});
