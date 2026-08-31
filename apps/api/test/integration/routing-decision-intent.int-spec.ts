/**
 * Routing Decision intent-row integration test (#2394, `W3a-5`, ADR-054 R1).
 *
 * Everything asserted here is a DATABASE-level guarantee a mock cannot express:
 *
 *  - `UQ_routing_decisions_live_order` leaves **exactly one** live row when two
 *    claims race for one order, and refuses the loser with a domain error;
 *  - the predicate is `live`-only, so terminalising frees the order for the
 *    legitimate re-route DESIGN §5.4 requires;
 *  - the index is keyed on `orderId` ALONE, so a SECOND ROUTER is refused too —
 *    #2395's guard must refuse "regardless of router identity", and a
 *    `(orderId, routerConnectionId)` key would silently permit the double-ship;
 *  - `updatedAt` really moves on the conditional UPDATE.
 *
 * @module apps/api/test/integration
 */
import { randomUUID } from 'node:crypto';

import {
  ROUTING_DECISION_REPOSITORY_TOKEN,
  RoutingDecisionAlreadyLiveError,
} from '@openlinker/core/fulfillment';
import type {
  ClaimRoutingIntentInput,
  RoutingDecision,
  TerminaliseRoutingDecisionInput,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * A LOCAL structural view, not the port type — `RoutingDecisionRepositoryPort`
 * is intra-context and deliberately absent from the barrel (the deny pattern).
 * Mirrors `fulfillment-work-transitions.int-spec.ts`.
 */
interface RoutingDecisionRepositoryView {
  claimIntent(input: ClaimRoutingIntentInput): Promise<RoutingDecision>;
  terminalise(input: TerminaliseRoutingDecisionInput): Promise<boolean>;
  findLiveByOrderId(orderId: string): Promise<RoutingDecision | null>;
  findById(decisionId: string): Promise<RoutingDecision | null>;
}

describe('Routing decision intent row (#2394)', () => {
  let harness: IntegrationTestHarness;
  let repo: RoutingDecisionRepositoryView;

  beforeAll(async () => {
    harness = await getTestHarness();
    repo = harness.getApp().get<RoutingDecisionRepositoryView>(ROUTING_DECISION_REPOSITORY_TOKEN);
  }, 180_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const liveCount = async (orderId: string): Promise<number> => {
    const rows = await harness
      .getDataSource()
      .query(
        `SELECT count(*)::int AS n FROM routing_decisions WHERE "orderId" = $1 AND "state" = 'live'`,
        [orderId],
      );
    return (rows as { n: number }[])[0].n;
  };

  it('should leave exactly one live row when two claims race for one order', async () => {
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;

    // Issued CONCURRENTLY and settled together — the assertion is over the
    // PERSISTED row count, not over which promise happened to reject, so the
    // test cannot pass by accident of scheduling.
    const [first, second] = await Promise.allSettled([
      repo.claimIntent({ orderId, routerConnectionId: randomUUID() }),
      repo.claimIntent({ orderId, routerConnectionId: randomUUID() }),
    ]);

    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      RoutingDecisionAlreadyLiveError,
    );
    expect(await liveCount(orderId)).toBe(1);
  });

  it('should refuse a SECOND ROUTER, not merely a second claim by the same one', async () => {
    // This is the assertion that distinguishes the shipped index from a
    // `(orderId, routerConnectionId)` one, which would pass every other test in
    // this file while permitting the double-ship #2395 exists to prevent.
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });

    await expect(
      repo.claimIntent({ orderId, routerConnectionId: randomUUID() }),
    ).rejects.toBeInstanceOf(RoutingDecisionAlreadyLiveError);
    expect(await liveCount(orderId)).toBe(1);
  });

  it('should free the order for a re-route once the decision is terminalised', async () => {
    // DESIGN §5.4: `short_picked` + `releaseShortfall` re-enters `route()`. An
    // unconditional unique index would forbid this forever.
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    const first = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });

    expect(
      await repo.terminalise({
        decisionId: first.id,
        state: 'committed',
        routerDecisionRef: 'vendor-decision-1',
      }),
    ).toBe(true);

    const second = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });
    expect(second.id).not.toBe(first.id);
    expect(await liveCount(orderId)).toBe(1);
  });

  it('should record the router decision reference separately from its own id', async () => {
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    const claimed = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });

    await repo.terminalise({
      decisionId: claimed.id,
      state: 'committed',
      routerDecisionRef: 'vendor-decision-9',
    });

    const stored = await repo.findById(claimed.id);
    expect(stored?.routerDecisionRef).toBe('vendor-decision-9');
    // OL's id and the vendor's are different values by construction.
    expect(stored?.id).not.toBe(stored?.routerDecisionRef);
    expect(stored?.terminalisedAt).toBeInstanceOf(Date);
  });

  it('should refuse to terminalise a decision that is already terminal', async () => {
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    const claimed = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });

    expect(await repo.terminalise({ decisionId: claimed.id, state: 'committed' })).toBe(true);
    expect(await repo.terminalise({ decisionId: claimed.id, state: 'abandoned' })).toBe(false);

    const stored = await repo.findById(claimed.id);
    expect(stored?.state).toBe('committed');
  });

  it('should advance updatedAt on the conditional UPDATE', async () => {
    // Pinned rather than asserted in a docblock: #2392's transitions rely on
    // TypeORM injecting `@UpdateDateColumn` into `UpdateQueryBuilder` while
    // `recordLineProgress` sets it explicitly. A conditional UPDATE that
    // silently skipped it would leave `updatedAt` frozen at insert — a trap for
    // the next reader, who would reach for the obvious column.
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    const claimed = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await repo.terminalise({ decisionId: claimed.id, state: 'abandoned' });

    const stored = await repo.findById(claimed.id);
    expect(stored?.updatedAt.getTime()).toBeGreaterThan(stored!.createdAt.getTime());
  });

  it('should report the live decision for #2395 guard reads and nothing once terminal', async () => {
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    const claimed = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });

    expect((await repo.findLiveByOrderId(orderId))?.id).toBe(claimed.id);

    await repo.terminalise({ decisionId: claimed.id, state: 'abandoned' });
    expect(await repo.findLiveByOrderId(orderId)).toBeNull();
  });

  it('should round-trip a recognised abandon reason through terminalise', async () => {
    // The sibling case below writes the column with raw SQL, so it proves the
    // READ coerces and says nothing about the WRITE. Without this, a
    // `terminalise` that dropped `abandonReason` entirely would leave every
    // test in this file green while #2395's refusal reason vanished silently.
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    const claimed = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });

    await repo.terminalise({
      decisionId: claimed.id,
      state: 'abandoned',
      abandonReason: 'plan-not-conserving',
      routerDecisionRef: 'vendor-decision-refused',
    });

    const stored = await repo.findById(claimed.id);
    expect(stored?.abandonReason).toBe('plan-not-conserving');
    // Legal on the abandoned arm too: #2393's `plan-not-conserving` describes a
    // router that DID name a decision, which OpenLinker then refused.
    expect(stored?.routerDecisionRef).toBe('vendor-decision-refused');
    expect(stored?.state).toBe('abandoned');
  });

  it('should read an abandon reason this build does not recognise as absent', async () => {
    // #2395 widens the union with no migration, so an older build must read a
    // newer value as absent rather than crash on it (the #2100 rule).
    const orderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    const claimed = await repo.claimIntent({ orderId, routerConnectionId: randomUUID() });
    await repo.terminalise({ decisionId: claimed.id, state: 'abandoned' });

    await harness
      .getDataSource()
      .query(`UPDATE routing_decisions SET "abandonReason" = $1 WHERE "id" = $2`, [
        'a-reason-from-the-future',
        claimed.id,
      ]);

    const stored = await repo.findById(claimed.id);
    expect(stored?.abandonReason).toBeNull();
    expect(stored?.state).toBe('abandoned');
  });
});
