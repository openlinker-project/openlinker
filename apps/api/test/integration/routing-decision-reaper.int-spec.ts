/**
 * Stranded routing decision reaper integration test (#2731).
 *
 * The guarantees asserted here are DATABASE-level, so a mock cannot express them:
 *
 *  - a `live` decision older than the TTL is closed as `stranded-past-ttl`, and
 *    leaving `UQ_routing_decisions_live_order` frees the order for a re-route;
 *  - a decision inside the TTL, or already terminal, is left alone;
 *  - a reap and a late commit racing on ONE decision produce exactly one winner,
 *    because both go through `terminalise`'s `WHERE state = 'live'`. Issued
 *    concurrently: a sequential test would pass against no guard at all.
 *
 * @module apps/api/test/integration
 */
import { randomUUID } from 'node:crypto';

import {
  ROUTING_DECISION_REAPER_SERVICE_TOKEN,
  ROUTING_DECISION_REPOSITORY_TOKEN,
} from '@openlinker/core/fulfillment';
import type {
  ClaimRoutingIntentInput,
  IRoutingDecisionReaperService,
  RoutingDecision,
  TerminaliseRoutingDecisionInput,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  type IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * A LOCAL structural view, not the port type — `RoutingDecisionRepositoryPort`
 * is intra-context and absent from the barrel. Mirrors
 * `routing-decision-intent.int-spec.ts`.
 */
interface RoutingDecisionRepositoryView {
  claimIntent(input: ClaimRoutingIntentInput): Promise<RoutingDecision>;
  terminalise(input: TerminaliseRoutingDecisionInput): Promise<boolean>;
  findById(decisionId: string): Promise<RoutingDecision | null>;
}

const TTL_MS = 60 * 60 * 1000;

describe('Stranded routing decision reaper (#2731)', () => {
  let harness: IntegrationTestHarness;
  let repo: RoutingDecisionRepositoryView;
  let reaper: IRoutingDecisionReaperService;

  beforeAll(async () => {
    harness = await getTestHarness();
    repo = harness.getApp().get<RoutingDecisionRepositoryView>(ROUTING_DECISION_REPOSITORY_TOKEN);
    reaper = harness
      .getApp()
      .get<IRoutingDecisionReaperService>(ROUTING_DECISION_REAPER_SERVICE_TOKEN);
  }, 180_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const newOrderId = (): string => `ol_order_${randomUUID().replace(/-/g, '')}`;

  /** Claim a live decision and backdate it, as if `route()` went in doubt `ageMs` ago. */
  const claimAged = async (orderId: string, ageMs: number): Promise<RoutingDecision> => {
    const claimed = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });
    await harness
      .getDataSource()
      .query(`UPDATE routing_decisions SET "createdAt" = $2 WHERE "id" = $1`, [
        claimed.id,
        new Date(Date.now() - ageMs),
      ]);
    return claimed;
  };

  it('should abandon a live decision past the TTL and free the order for a re-route', async () => {
    const orderId = newOrderId();
    const stranded = await claimAged(orderId, 2 * TTL_MS);

    const result = await reaper.reapStranded({ limit: 50, ttlMs: TTL_MS, now: new Date() });

    expect(result.reaped).toBe(1);
    expect(result.intents.map((intent) => intent.decisionId)).toEqual([stranded.id]);
    const stored = await repo.findById(stranded.id);
    expect(stored?.state).toBe('abandoned');
    expect(stored?.abandonReason).toBe('stranded-past-ttl');
    expect(stored?.routerDecisionRef).toBeNull();
    expect(stored?.terminalisedAt).not.toBeNull();

    // The live slot is free again, which is what lets the re-route claim it.
    await expect(
      repo.claimIntent({ orderId, routerConnectionId: randomUUID() })
    ).resolves.toMatchObject({ state: 'live' });
  });

  it('should leave a live decision inside the TTL alone', async () => {
    const fresh = await claimAged(newOrderId(), TTL_MS / 2);

    const result = await reaper.reapStranded({ limit: 50, ttlMs: TTL_MS, now: new Date() });

    expect(result.examined).toBe(0);
    expect((await repo.findById(fresh.id))?.state).toBe('live');
  });

  it('should never touch a terminal decision, however old', async () => {
    const old = await claimAged(newOrderId(), 3 * TTL_MS);
    await repo.terminalise({ decisionId: old.id, state: 'committed', routerDecisionRef: 'v-1' });

    const result = await reaper.reapStranded({ limit: 50, ttlMs: TTL_MS, now: new Date() });

    expect(result.examined).toBe(0);
    expect((await repo.findById(old.id))?.state).toBe('committed');
  });

  it('should let exactly one of a reap and a late commit win when they race', async () => {
    const stranded = await claimAged(newOrderId(), 2 * TTL_MS);

    const [reap, commit] = await Promise.all([
      reaper.reapStranded({ limit: 50, ttlMs: TTL_MS, now: new Date() }),
      repo.terminalise({ decisionId: stranded.id, state: 'committed', routerDecisionRef: 'late' }),
    ]);

    const reapWon = reap.reaped === 1;
    expect(Number(reapWon) + Number(commit)).toBe(1);
    const stored = await repo.findById(stranded.id);
    expect(stored?.state).toBe(reapWon ? 'abandoned' : 'committed');
    // A lost reap reports no intent, so nothing re-routes an order that just committed.
    expect(reap.intents).toHaveLength(reapWon ? 1 : 0);
  });

  it('should read the latest decision for an order, stranded or not', async () => {
    const orderId = newOrderId();
    const first = await claimAged(orderId, 3 * TTL_MS);
    await repo.terminalise({ decisionId: first.id, state: 'abandoned', abandonReason: 'plan-pending' });
    const second = await claimAged(orderId, 2 * TTL_MS);

    const view = await reaper.getStatusForOrder({ orderId, ttlMs: TTL_MS, now: new Date() });

    expect(view?.decisionId).toBe(second.id);
    expect(view?.state).toBe('live');
    expect(view?.strandedSince).not.toBeNull();
    await expect(
      reaper.getStatusForOrder({ orderId: newOrderId(), ttlMs: TTL_MS, now: new Date() })
    ).resolves.toBeNull();
  });
});
