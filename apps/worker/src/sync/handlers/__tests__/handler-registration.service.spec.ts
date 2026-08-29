/**
 * Handler Registration Service Unit Tests
 *
 * Pins the ADR-050 lane partition (#2278): every `JobTypeValues` member is
 * registered with exactly one lane, the per-lane counts match the ADR's
 * table (13 realtime / 21 bulk / 5 fiscal / 7 fan-out — `fiscalization.register`
 * joined `fiscal` post-ADR, #2156; `inventory.provenance.backfill` joined
 * `bulk` with #2317; the three returns types joined realtime/bulk/fan-out with
 * #2330; `returns.orphan.reconcile` joined `bulk` with #2332;
 * `orders.taxRate.backfill` joined `bulk` with #2440; `orders.holds.reconcile`
 * joined `bulk` with #2340 (Wave 2 body A); and the three reservation sweeps
 * joined `bulk` with #2346 / #2347 / #2349 (Wave 2 body B); and
 * `automation.trigger.deadlineSweep` joined `bulk` with #2360 (Wave 2 body D)),
 * and the consequential
 * assignments the ADR calls out cannot silently churn.
 *
 * @module apps/worker/src/sync/handlers
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- test constructs the service with 45 interchangeable dummy handlers */
import type { SyncJobHandler } from '@openlinker/core/sync';
import { JobTypeValues } from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from '../sync-job-handler.registry';
import { HandlerRegistrationService } from '../handler-registration.service';

describe('HandlerRegistrationService (ADR-050 lane partition, #2278)', () => {
  let registry: SyncJobHandlerRegistry;

  beforeEach(() => {
    registry = new SyncJobHandlerRegistry();
    const dummyHandler = { execute: jest.fn() } as unknown as SyncJobHandler;
    // The constructor takes the registry followed by 45 handler instances;
    // the partition under test keys on jobType, so interchangeable dummies
    // are sufficient.
    const handlers = Array.from({ length: 45 }, () => dummyHandler);
    const service = new (HandlerRegistrationService as any)(registry, ...handlers);
    (service as HandlerRegistrationService).onModuleInit();
  });

  it('should register every JobTypeValues member with a lane (full-union coverage)', () => {
    expect(registry.getRegisteredJobTypes().sort()).toEqual([...JobTypeValues].sort());
    expect(() => registry.assertFullLaneCoverage()).not.toThrow();
  });

  it('should partition the 46 job types 13/21/5/7 per ADR-050 decision 1', () => {
    expect(registry.getJobTypesByLane('realtime')).toHaveLength(13);
    // 21, and every one of the six additions since the lane split shares one
    // profile: background catch-up work that enqueues no children, writes
    // locally, and whose lateness costs nobody a request — so `fan-out` (whose
    // subject is a job whose cost is the wave it emits) is wrong for all of
    // them, and none may contend with the `realtime` order ingestion that is
    // what RESOLVES their backlog.
    //
    // #2340 `orders.holds.reconcile` and #2440 `orders.taxRate.backfill` (a
    // paced backfill) took it to 17. #2346 `inventory.reservations.expire`,
    // #2347 `inventory.reservations.consume` and #2349
    // `inventory.reservations.shortfall` took it to 20 — each safe in the same
    // direction: a hold examined a tick later STAYED held, a shipment consumed
    // a tick later is stock released a tick later (never stock oversold), and
    // shortfall names risk rather than repairing anything. #2360
    // `automation.trigger.deadlineSweep` — a page of automation evaluations —
    // is the twenty-first.
    expect(registry.getJobTypesByLane('bulk')).toHaveLength(21);
    expect(registry.getJobTypesByLane('fiscal')).toHaveLength(5);
    expect(registry.getJobTypesByLane('fan-out')).toHaveLength(7);
  });

  it('should pin the consequential dual-profile assignments', () => {
    // Operator-wave children are bulk even though they are single-unit work.
    expect(registry.getLane('marketplace.offer.create')).toBe('bulk');
    expect(registry.getLane('shop.product.publish')).toBe('bulk');
    // Invoicing sweeps are fiscal by cost-of-starvation, not by paged shape.
    expect(registry.getLane('invoicing.pendingRecovery.sweep')).toBe('fiscal');
    // Post-ADR registration joins fiscal (#2156).
    expect(registry.getLane('fiscalization.register')).toBe('fiscal');
    // The buyer-facing path stays realtime.
    expect(registry.getLane('marketplace.order.sync')).toBe('realtime');
    expect(registry.getLane('marketplace.offerQuantity.update')).toBe('realtime');
    // Enumerators are fan-out.
    expect(registry.getLane('marketplace.orders.poll')).toBe('fan-out');
    // #2330 returns: the lanes mirror the order path they were modelled on.
    // Discovery fans out; the per-return child is what a buyer waits on; the
    // lifecycle re-read is a paced sweep whose lateness costs nobody a request.
    expect(registry.getLane('marketplace.returns.poll')).toBe('fan-out');
    expect(registry.getLane('marketplace.return.sync')).toBe('realtime');
    expect(registry.getLane('marketplace.returns.statusSync')).toBe('bulk');
    // The #2317 backfill is bulk, NOT fan-out: it enqueues no children at
    // all - it does the work itself in one bounded local UPDATE - and
    // fan-out's whole subject is a job whose cost is the wave it emits.
    expect(registry.getLane('inventory.provenance.backfill')).toBe('bulk');
  });
});
