/**
 * Handler Registration Service Unit Tests
 *
 * Pins the ADR-050 lane partition (#2278): every `JobTypeValues` member is
 * registered with exactly one lane, the per-lane counts match the ADR's
 * table (12 realtime / 18 bulk / 5 fiscal / 6 fan-out — `fiscalization.register`
 * joined `fiscal` post-ADR, #2156; `orders.taxRate.backfill` joined `bulk`,
<<<<<<< HEAD
 * #2440; `analytics.currency.recalculate` joined `bulk`, #2468; the two
 * sweep-triggered master children joined `bulk`, #2594; `master.product.syncBatch`
 * joined `bulk` as another catalogue-sweep child, #2593; `master.inventory.syncBatch`
 * joined `bulk` alongside it, #2648; #2609 changed no assignment at all), and
 * the consequential assignments the ADR calls out cannot silently churn.
=======
 * #2440; the two sweep-triggered master children joined `bulk`, #2594;
 * `master.product.syncBatch` joined `bulk` as another catalogue-sweep child,
 * #2593; `master.inventory.syncBatch` joined `bulk` the same way, #2648;
 * #2609 changed no assignment at all; `marketplace.offerQuantity.reconcile`
 * joined `bulk`, #2621), and the consequential assignments the ADR calls out
 * cannot silently churn.
>>>>>>> origin/main
 *
 * @module apps/worker/src/sync/handlers
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- test constructs the service with 39 interchangeable dummy handlers */
import type { SyncJobHandler } from '@openlinker/core/sync';
import { JobTypeValues, SyncJobLaneValues } from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from '../sync-job-handler.registry';
import { HandlerRegistrationService } from '../handler-registration.service';

describe('HandlerRegistrationService (ADR-050 lane partition, #2278)', () => {
  let registry: SyncJobHandlerRegistry;

  beforeEach(() => {
    registry = new SyncJobHandlerRegistry();
    // The constructor takes the registry followed by 39 handler instances.
    // The dummies are DISTINCT objects so that "these two job types share one
    // handler instance" (#2594) is a real assertion rather than a tautology.
    const handlers = Array.from(
      { length: 39 },
      () => ({ execute: jest.fn() }) as unknown as SyncJobHandler
    );
    const service = new (HandlerRegistrationService as any)(registry, ...handlers);
    (service as HandlerRegistrationService).onModuleInit();
  });

  it('should register every JobTypeValues member with a lane (full-union coverage)', () => {
    expect(registry.getRegisteredJobTypes().sort()).toEqual([...JobTypeValues].sort());
    expect(() => registry.assertFullLaneCoverage()).not.toThrow();
  });

  it('should partition the 41 job types 12/18/5/6 per ADR-050 decision 1', () => {
    // 18 bulk: #2648's `master.inventory.syncBatch` and #2593's
    // `master.product.syncBatch` sit beside the two sweep-triggered master
    // children #2594 moved out of `realtime`, and #2621's
    // `marketplace.offerQuantity.reconcile` joins the same lane as a
    // scan-style pass over adapter-internal pending state.
    expect(registry.getJobTypesByLane('realtime')).toHaveLength(12);
    expect(registry.getJobTypesByLane('bulk')).toHaveLength(18);
    expect(registry.getJobTypesByLane('fiscal')).toHaveLength(5);
    expect(registry.getJobTypesByLane('fan-out')).toHaveLength(6);
  });

  it('should lane the master children by TRIGGER, webhook realtime and sweep bulk (#2594)', () => {
    // One handler, two job types. The webhook child keeps the lane it has
    // always had; the sweep child must not compete for realtime slots, or a
    // catalogue cycle sits ahead of a buyer's order.
    expect(registry.getLane('master.product.syncByExternalId')).toBe('realtime');
    expect(registry.getLane('master.inventory.syncByExternalId')).toBe('realtime');
    expect(registry.getLane('master.product.syncFromSweep')).toBe('bulk');
    expect(registry.getLane('master.inventory.syncFromSweep')).toBe('bulk');
    expect(registry.getHandler('master.product.syncFromSweep')).toBe(
      registry.getHandler('master.product.syncByExternalId')
    );
    expect(registry.getHandler('master.inventory.syncFromSweep')).toBe(
      registry.getHandler('master.inventory.syncByExternalId')
    );
  });

  it('should keep the lane vocabulary at four entries (ADR-050 reversal gate)', () => {
    // A per-trigger starvation profile is expressed as a second job type, not
    // as a fifth lane. A fifth entry here is the ADR's own reversal gate.
    expect(SyncJobLaneValues).toHaveLength(4);
  });

  it('should pin the consequential dual-profile assignments', () => {
    // Operator-wave children are bulk even though they are single-unit work.
    expect(registry.getLane('marketplace.offer.create')).toBe('bulk');
    expect(registry.getLane('shop.product.publish')).toBe('bulk');
    // Invoicing sweeps are fiscal by cost-of-starvation, not by paged shape.
    expect(registry.getLane('invoicing.pendingRecovery.sweep')).toBe('fiscal');
    // An operator-triggered batch repair must never delay a queued realtime
    // order sync or a fiscal document (#2468).
    expect(registry.getLane('analytics.currency.recalculate')).toBe('bulk');
    // The batched catalogue child does the same work as the per-product job it
    // replaces, so it carries the same starvation cost and the same lane (#2593).
    expect(registry.getLane('master.product.syncBatch')).toBe('bulk');
    expect(registry.getLane('master.product.syncByExternalId')).toBe('realtime');
    // Post-ADR registration joins fiscal (#2156).
    expect(registry.getLane('fiscalization.register')).toBe('fiscal');
    // The buyer-facing path stays realtime.
    expect(registry.getLane('marketplace.order.sync')).toBe('realtime');
    expect(registry.getLane('marketplace.offerQuantity.update')).toBe('realtime');
    // Enumerators are fan-out.
    expect(registry.getLane('marketplace.orders.poll')).toBe('fan-out');
    // #2609 fixed the propagation scope and the lane cap, not the lane: the
    // job enqueues realtime children and never calls a marketplace itself.
    expect(registry.getLane('inventory.propagateToMarketplaces')).toBe('fan-out');
  });
});
