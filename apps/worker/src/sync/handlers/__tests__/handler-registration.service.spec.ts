/**
 * Handler Registration Service Unit Tests
 *
 * Pins the ADR-050 lane partition (#2278): every `JobTypeValues` member is
 * registered with exactly one lane, the per-lane counts match the ADR's
 * table (12 realtime / 13 bulk / 5 fiscal / 6 fan-out — `fiscalization.register`
 * joined `fiscal` post-ADR, #2156; `orders.taxRate.backfill` joined `bulk`,
 * #2440), and the consequential assignments the ADR calls out cannot
 * silently churn.
 *
 * @module apps/worker/src/sync/handlers
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- test constructs the service with 36 interchangeable dummy handlers */
import type { SyncJobHandler } from '@openlinker/core/sync';
import { JobTypeValues } from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from '../sync-job-handler.registry';
import { HandlerRegistrationService } from '../handler-registration.service';

describe('HandlerRegistrationService (ADR-050 lane partition, #2278)', () => {
  let registry: SyncJobHandlerRegistry;

  beforeEach(() => {
    registry = new SyncJobHandlerRegistry();
    const dummyHandler = { execute: jest.fn() } as unknown as SyncJobHandler;
    // The constructor takes the registry followed by 36 handler instances;
    // the partition under test keys on jobType, so interchangeable dummies
    // are sufficient.
    const handlers = Array.from({ length: 36 }, () => dummyHandler);
    const service = new (HandlerRegistrationService as any)(registry, ...handlers);
    (service as HandlerRegistrationService).onModuleInit();
  });

  it('should register every JobTypeValues member with a lane (full-union coverage)', () => {
    expect(registry.getRegisteredJobTypes().sort()).toEqual([...JobTypeValues].sort());
    expect(() => registry.assertFullLaneCoverage()).not.toThrow();
  });

  it('should partition the 37 job types 13/13/5/6 per ADR-050 decision 1', () => {
    // 13 realtime since #2593 added `master.product.syncBatch` beside the
    // per-product catalogue job it fans out instead of.
    expect(registry.getJobTypesByLane('realtime')).toHaveLength(13);
    expect(registry.getJobTypesByLane('bulk')).toHaveLength(13);
    expect(registry.getJobTypesByLane('fiscal')).toHaveLength(5);
    expect(registry.getJobTypesByLane('fan-out')).toHaveLength(6);
  });

  it('should pin the consequential dual-profile assignments', () => {
    // Operator-wave children are bulk even though they are single-unit work.
    expect(registry.getLane('marketplace.offer.create')).toBe('bulk');
    expect(registry.getLane('shop.product.publish')).toBe('bulk');
    // Invoicing sweeps are fiscal by cost-of-starvation, not by paged shape.
    expect(registry.getLane('invoicing.pendingRecovery.sweep')).toBe('fiscal');
    // The batched catalogue child does the same work as the per-product job it
    // replaces, so it carries the same starvation cost and the same lane (#2593).
    expect(registry.getLane('master.product.syncBatch')).toBe('realtime');
    expect(registry.getLane('master.product.syncByExternalId')).toBe('realtime');
    // Post-ADR registration joins fiscal (#2156).
    expect(registry.getLane('fiscalization.register')).toBe('fiscal');
    // The buyer-facing path stays realtime.
    expect(registry.getLane('marketplace.order.sync')).toBe('realtime');
    expect(registry.getLane('marketplace.offerQuantity.update')).toBe('realtime');
    // Enumerators are fan-out.
    expect(registry.getLane('marketplace.orders.poll')).toBe('fan-out');
  });
});
