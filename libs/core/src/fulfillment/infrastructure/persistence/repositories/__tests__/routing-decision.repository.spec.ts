/**
 * Routing Decision Repository specs (#2394).
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/repositories
 */
import { QueryFailedError } from 'typeorm';

// Imported for the format-drift guard at the bottom. A SPEC may value-import a
// sibling context — the leaf walker excludes `*.spec.ts` — which is exactly
// what lets the repository's local minter be checked against the real one.
import { formatInternalId } from '@openlinker/core/identifier-mapping';

import { FulfillmentPersistenceError } from '../../../../domain/exceptions/fulfillment-persistence.error';
import { RoutingDecisionAlreadyLiveError } from '../../../../domain/exceptions/routing-decision-already-live.error';
import { RoutingDecisionRepository } from '../routing-decision.repository';

const uniqueViolation = (constraint: string): QueryFailedError => {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  Object.assign(error, { code: '23505', constraint });
  return error;
};

const updateQueryBuilder = (result: { affected?: number }) => {
  const qb: Record<string, unknown> = {};
  for (const method of ['update', 'set', 'where', 'andWhere']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue(result);
  return qb;
};

describe('RoutingDecisionRepository', () => {
  describe('claimIntent', () => {
    it('should insert the row live without accepting a state from the caller', async () => {
      const save = jest.fn().mockImplementation((row: unknown) => Promise.resolve(row));
      const repo = new RoutingDecisionRepository({ save } as never);

      const decision = await repo.claimIntent({
        orderId: 'ol_order_1',
        routerConnectionId: 'c1',
      });

      expect(decision.state).toBe('live');
      expect(decision.routerDecisionRef).toBeNull();
      expect(decision.terminalisedAt).toBeNull();
      expect(decision.abandonReason).toBeNull();
    });

    it('should throw RoutingDecisionAlreadyLiveError when the live index refuses', async () => {
      const save = jest.fn().mockRejectedValue(uniqueViolation('UQ_routing_decisions_live_order'));
      const repo = new RoutingDecisionRepository({ save } as never);

      await expect(
        repo.claimIntent({ orderId: 'ol_order_1', routerConnectionId: 'c1' }),
      ).rejects.toBeInstanceOf(RoutingDecisionAlreadyLiveError);
    });

    it('should NOT report a primary-key collision as an already-live decision', async () => {
      // The #2392 rule: catching every 23505 would name a state that is fine,
      // about a constraint that did not fail.
      const save = jest.fn().mockRejectedValue(uniqueViolation('PK_routing_decisions'));
      const repo = new RoutingDecisionRepository({ save } as never);

      await expect(
        repo.claimIntent({ orderId: 'ol_order_1', routerConnectionId: 'c1' }),
      ).rejects.toBeInstanceOf(FulfillmentPersistenceError);
    });
  });

  describe('terminalise', () => {
    it('should report false when nothing was applied', async () => {
      const qb = updateQueryBuilder({ affected: 0 });
      const repo = new RoutingDecisionRepository({
        createQueryBuilder: () => qb,
      } as never);

      await expect(repo.terminalise({ decisionId: 'd1', state: 'committed' })).resolves.toBe(false);
    });

    it('should guard on the live state so a terminal row cannot be re-terminalised', async () => {
      const qb = updateQueryBuilder({ affected: 1 });
      const repo = new RoutingDecisionRepository({
        createQueryBuilder: () => qb,
      } as never);

      await repo.terminalise({ decisionId: 'd1', state: 'committed' });

      const clauses = ((qb.andWhere as jest.Mock).mock.calls as unknown[][]).map(
        (call) => call[0] as string,
      );
      expect(clauses.some((clause) => clause.includes(`"state" = 'live'`))).toBe(true);
    });

    it('should carry the abandon reason and the router reference into the UPDATE', async () => {
      // Without this, a `set()` that simply omitted either column passed every
      // other test in this file: the only DB-level check of `abandonReason`
      // writes the column with raw SQL, so nothing exercised the write path.
      const qb = updateQueryBuilder({ affected: 1 });
      const repo = new RoutingDecisionRepository({
        createQueryBuilder: () => qb,
      } as never);

      await repo.terminalise({
        decisionId: 'd1',
        state: 'abandoned',
        abandonReason: 'plan-not-conserving',
        routerDecisionRef: 'vendor-1',
      });

      const setCalls = (qb.set as jest.Mock).mock.calls as unknown[][];
      const assigned = setCalls[0][0] as Record<string, unknown>;
      expect(assigned.abandonReason).toBe('plan-not-conserving');
      expect(assigned.routerDecisionRef).toBe('vendor-1');
      expect(assigned.state).toBe('abandoned');
    });

    it('should treat an undefined affected count as NOT applied', async () => {
      // The `?? 0` is load-bearing: a truthy coercion here is the silent
      // double-apply shape.
      const qb = updateQueryBuilder({});
      const repo = new RoutingDecisionRepository({
        createQueryBuilder: () => qb,
      } as never);

      await expect(repo.terminalise({ decisionId: 'd1', state: 'abandoned' })).resolves.toBe(false);
    });
  });
});

/**
 * Format-drift guard for the leaf's local id minter.
 *
 * The repository cannot value-import `formatInternalId` (a sibling-context
 * VALUE import, forbidden from a registered zero-sibling-edge leaf), so it
 * reproduces the format. A spec file CAN import it, which is what makes the
 * duplication safe rather than merely convenient.
 */
describe('routing decision id format', () => {
  it('should match what formatInternalId would have produced', async () => {
    const reference = formatInternalId('RoutingDecision');
    expect(reference).toMatch(/^ol_routingdecision_[0-9a-f]{32}$/);

    const save = jest.fn().mockImplementation((row: unknown) => Promise.resolve(row));
    const repo = new RoutingDecisionRepository({ save } as never);
    const decision = await repo.claimIntent({ orderId: 'o', routerConnectionId: 'c' });

    expect(decision.id).toMatch(/^ol_routingdecision_[0-9a-f]{32}$/);
  });
});
