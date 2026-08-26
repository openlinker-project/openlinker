/**
 * Handler Registration Service Unit Tests
 *
 * Pins the ADR-050 lane partition (#2278): every `JobTypeValues` member is
 * registered with exactly one lane, the per-lane counts match the ADR's
 * table (13 realtime / 18 bulk / 5 fiscal / 7 fan-out — `fiscalization.register`
 * joined `fiscal` post-ADR, #2156; `inventory.provenance.backfill` joined
 * `bulk` with #2317; the three returns types joined realtime/bulk/fan-out with
 * #2330; `returns.orphan.reconcile` joined `bulk` with #2332;
 * `orders.taxRate.backfill` joined `bulk` with #2440; and the two reservation
 * sweeps joined `bulk` with #2346 / #2347), and the consequential
 * assignments the ADR calls out cannot silently churn.
 *
 * @module apps/worker/src/sync/handlers
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- test constructs the service with 43 interchangeable dummy handlers */
import type { SyncJobHandler } from '@openlinker/core/sync';
import { JobTypeValues } from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from '../sync-job-handler.registry';
import { HandlerRegistrationService } from '../handler-registration.service';

describe('HandlerRegistrationService (ADR-050 lane partition, #2278)', () => {
  let registry: SyncJobHandlerRegistry;

  beforeEach(() => {
    registry = new SyncJobHandlerRegistry();
    const dummyHandler = { execute: jest.fn() } as unknown as SyncJobHandler;
    // The constructor takes the registry followed by 43 handler instances;
    // the partition under test keys on jobType, so interchangeable dummies
    // are sufficient.
    const handlers = Array.from({ length: 43 }, () => dummyHandler);
    const service = new (HandlerRegistrationService as any)(registry, ...handlers);
    (service as HandlerRegistrationService).onModuleInit();
  });

  it('should register every JobTypeValues member with a lane (full-union coverage)', () => {
    expect(registry.getRegisteredJobTypes().sort()).toEqual([...JobTypeValues].sort());
    expect(() => registry.assertFullLaneCoverage()).not.toThrow();
  });

  it('should partition the 43 job types 13/18/5/7 per ADR-050 decision 1', () => {
    expect(registry.getJobTypesByLane('realtime')).toHaveLength(13);
    // 16 since #2332 added `returns.orphan.reconcile` — background catch-up work whose
    // lateness costs nobody a request, and which must not contend with the `realtime`
    // order ingestion that is what RESOLVES its orphans — and #2440 added
    // `orders.taxRate.backfill`, a paced backfill with the same profile.
    //
    // 17 since #2346 added `inventory.reservations.expire`, which shares that
    // profile exactly: it enqueues no children and writes locally, so `fan-out`
    // (whose subject is a job whose cost is the wave it emits) is wrong for it,
    // and a hold examined a tick later is a hold that STAYED held — the safe
    // direction — so a saturated lane delaying it costs nothing.
    //
    // 18 since #2347 added `inventory.reservations.consume` — the same profile
    // once more, and safe in the same direction for the opposite reason: a
    // shipment consumed a tick later is stock released a tick later, never
    // stock oversold.
    expect(registry.getJobTypesByLane('bulk')).toHaveLength(18);
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
