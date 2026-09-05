/**
 * Handler Registration Service Unit Tests
 *
 * Pins the ADR-050 lane partition (#2278): every `JobTypeValues` member is
 * registered with exactly one lane, the per-lane counts match the ADR's
 * table (16 realtime / 27 bulk / 5 fiscal / 7 fan-out across 55 job types —
 * `fiscalization.register` joined `fiscal` post-ADR, #2156;
 * `inventory.provenance.backfill` joined `bulk` with #2317; the three returns
 * types joined realtime/bulk/fan-out with #2330; `returns.orphan.reconcile`
 * joined `bulk` with #2332; `orders.taxRate.backfill` joined `bulk` with #2440;
 * the two sweep-triggered master children moved to `bulk` with #2594;
 * `master.product.syncBatch` joined `bulk` as another catalogue-sweep child
 * with #2593 and `master.inventory.syncBatch` beside it with #2648;
 * `orders.holds.reconcile` joined `bulk` with #2340 (Wave 2 body A); the three
 * reservation sweeps joined `bulk` with #2346 / #2347 / #2349 (Wave 2 body B);
 * and `automation.trigger.deadlineSweep` joined `bulk` with #2360 (Wave 2 body
 * D); `marketplace.offerQuantity.reconcile` joined `bulk` as a scan-style
 * pass over adapter-internal pending state with #2621; and
 * `analytics.currency.recalculate` joined `bulk` with #2468 (the Data Coverage
 * currency-restatement driver). #2609 changed no
 * assignment at all), and the consequential assignments
 * the ADR calls out cannot silently churn.
 *
 * @module apps/worker/src/sync/handlers
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- test constructs the service with 52 interchangeable dummy handlers */
import type { SyncJobHandler } from '@openlinker/core/sync';
import { JobTypeValues, SyncJobLaneValues } from '@openlinker/core/sync';
import { SyncJobHandlerRegistry } from '../sync-job-handler.registry';
import { HandlerRegistrationService } from '../handler-registration.service';

describe('HandlerRegistrationService (ADR-050 lane partition, #2278)', () => {
  let registry: SyncJobHandlerRegistry;

  beforeEach(() => {
    registry = new SyncJobHandlerRegistry();
    // The constructor takes the registry followed by 53 handler instances.
    // The dummies are DISTINCT objects so that "these two job types share one
    // handler instance" (#2594) is a real assertion rather than a tautology;
    // the partition under test keys on jobType, so they are otherwise
    // interchangeable.
    const handlers = Array.from(
      { length: 53 },
      () => ({ execute: jest.fn() }) as unknown as SyncJobHandler
    );
    const service = new (HandlerRegistrationService as any)(registry, ...handlers);
    (service as HandlerRegistrationService).onModuleInit();
  });

  it('should register every JobTypeValues member with a lane (full-union coverage)', () => {
    expect(registry.getRegisteredJobTypes().sort()).toEqual([...JobTypeValues].sort());
    expect(() => registry.assertFullLaneCoverage()).not.toThrow();
  });

  it('should partition the 55 job types 16/27/5/7 per ADR-050 decision 1', () => {
    // 16: the THREE fulfilment job types are all `realtime` by
    // cost-of-starvation.
    //
    // #2395's `fulfillment.work.route` decides whether an order ships AT ALL,
    // so starving it behind a catalogue sweep delays every order's fulfilment.
    // It is the clearest case of the rule stated below: the enqueuing side is
    // an internal pass, and the lane is about who is hurt when it is late.
    //
    // #2399's `fulfillment.work.dispatch` is the outbound "tell the holder to
    // ship" for a just-routed order, where lateness costs a shipment.
    //
    // #2400's `fulfillment.work.statusSync` is the inbound half: an executor's
    // progress report is WAITED ON — a picker is standing at a station and the
    // worklist shows stale counters until it drains — the same argument that
    // puts inbound order sync here. It outranks the "core-owned internal pass"
    // instinct that would suggest `bulk`, because that instinct is about who
    // ENQUEUES a job and the lane is about who is hurt when it is late.
    expect(registry.getJobTypesByLane('realtime')).toHaveLength(16);
    // 27, and every one of the additions since the lane split shares one
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
    // is the twenty-first. The catalogue-sweep children take it the rest of the
    // way: the two #2594 moved out of `realtime`, plus #2593's
    // `master.product.syncBatch` and #2648's `master.inventory.syncBatch`.
    // #2621's `marketplace.offerQuantity.reconcile` is the twenty-sixth - a
    // scan-style pass over adapter-internal pending state, the same profile,
    // and #2468's `analytics.currency.recalculate` (the Data Coverage
    // currency-restatement driver) is the twenty-seventh.
    expect(registry.getJobTypesByLane('bulk')).toHaveLength(27);
    expect(registry.getJobTypesByLane('fiscal')).toHaveLength(5);
    expect(registry.getJobTypesByLane('fan-out')).toHaveLength(7);
  });

  it('should lane the routing commit realtime, never bulk (#2395)', () => {
    // Named rather than left to the count above: a count moves whenever any
    // lane gains a member, so it would not notice this type silently sliding
    // into `bulk`. Routing gates whether an order ships at all — a late route
    // is a late shipment, and `bulk`'s per-scope cap is sized for work an
    // operator tolerates being slow.
    expect(registry.getLane('fulfillment.work.route')).toBe('realtime');
    expect(registry.getJobTypesByLane('bulk')).not.toContain('fulfillment.work.route');
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
    // The batched catalogue child does the same work as the per-product job it
    // replaces, so it carries the same starvation cost and the same lane (#2593).
    expect(registry.getLane('master.product.syncBatch')).toBe('bulk');
    expect(registry.getLane('master.product.syncByExternalId')).toBe('realtime');
    // An operator-triggered batch repair must never delay a queued realtime
    // order sync or a fiscal document (#2468).
    expect(registry.getLane('analytics.currency.recalculate')).toBe('bulk');
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
    // #2609 fixed the propagation scope and the lane cap, not the lane: the
    // job enqueues realtime children and never calls a marketplace itself.
    expect(registry.getLane('inventory.propagateToMarketplaces')).toBe('fan-out');
  });
});
