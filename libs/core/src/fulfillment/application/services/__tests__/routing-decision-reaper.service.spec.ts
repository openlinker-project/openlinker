/**
 * RoutingDecisionReaperService — unit spec (#2731)
 */
import { RoutingDecision } from '../../../domain/entities/routing-decision.entity';
import type { RoutingDecisionState } from '../../../domain/types/routing-decision.types';
import { RoutingDecisionReaperService } from '../routing-decision-reaper.service';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const TTL_MS = 60 * 60 * 1000;

function decision(
  overrides: Partial<{
    id: string;
    orderId: string;
    routerConnectionId: string;
    state: RoutingDecisionState;
    createdAt: Date;
  }> = {}
): RoutingDecision {
  return new RoutingDecision(
    overrides.id ?? 'ol_routingdecision_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.routerConnectionId ?? 'conn-router',
    overrides.state ?? 'live',
    null,
    null,
    null,
    overrides.createdAt ?? new Date('2026-10-27T09:00:00.000Z'),
    overrides.createdAt ?? new Date('2026-10-27T09:00:00.000Z')
  );
}

describe('RoutingDecisionReaperService (#2731)', () => {
  let repository: {
    listStrandedLive: jest.Mock;
    terminalise: jest.Mock;
    findLatestByOrderId: jest.Mock;
  };
  let service: RoutingDecisionReaperService;

  beforeEach(() => {
    repository = {
      listStrandedLive: jest.fn().mockResolvedValue([]),
      terminalise: jest.fn().mockResolvedValue(true),
      findLatestByOrderId: jest.fn().mockResolvedValue(null),
    };
    service = new RoutingDecisionReaperService(repository as never);
  });

  describe('reapStranded', () => {
    it('should read candidates created before now minus the TTL, within the limit', async () => {
      await service.reapStranded({ limit: 25, ttlMs: TTL_MS, now: NOW });

      expect(repository.listStrandedLive).toHaveBeenCalledWith({
        createdBefore: new Date('2026-10-27T11:00:00.000Z'),
        limit: 25,
      });
    });

    it('should abandon a stranded decision with the reaper reason and no router reference', async () => {
      repository.listStrandedLive.mockResolvedValue([decision()]);

      await service.reapStranded({ limit: 25, ttlMs: TTL_MS, now: NOW });

      expect(repository.terminalise).toHaveBeenCalledWith({
        decisionId: 'ol_routingdecision_1',
        state: 'abandoned',
        abandonReason: 'stranded-past-ttl',
        routerDecisionRef: null,
      });
    });

    it('should report an intent with the routing-stuck attention and the routing-failed fallback when reaped', async () => {
      repository.listStrandedLive.mockResolvedValue([decision()]);

      const result = await service.reapStranded({ limit: 25, ttlMs: TTL_MS, now: NOW });

      expect(result).toMatchObject({ examined: 1, reaped: 1, raced: 0, failed: 0, ttlMs: TTL_MS });
      expect(result.intents).toEqual([
        {
          orderId: 'ol_order_1',
          decisionId: 'ol_routingdecision_1',
          routerConnectionId: 'conn-router',
          attention: {
            kind: 'blocked',
            reason: 'routing-stuck',
            detail: 'Routing got no answer within 60 minutes and was restarted',
          },
          fallbackBlock: { reason: 'routing-failed', detail: 'stranded-past-ttl' },
        },
      ]);
    });

    it('should count a race and report no intent when a peer terminalised the decision first', async () => {
      repository.listStrandedLive.mockResolvedValue([decision()]);
      repository.terminalise.mockResolvedValue(false);

      const result = await service.reapStranded({ limit: 25, ttlMs: TTL_MS, now: NOW });

      expect(result).toMatchObject({ reaped: 0, raced: 1, failed: 0 });
      expect(result.intents).toEqual([]);
    });

    it('should count a failure and continue with the rest of the page when one write throws', async () => {
      repository.listStrandedLive.mockResolvedValue([
        decision({ id: 'd-1', orderId: 'o-1' }),
        decision({ id: 'd-2', orderId: 'o-2' }),
      ]);
      repository.terminalise
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce(true);

      const result = await service.reapStranded({ limit: 25, ttlMs: TTL_MS, now: NOW });

      expect(result).toMatchObject({ examined: 2, reaped: 1, failed: 1 });
      expect(result.intents.map((intent) => intent.orderId)).toEqual(['o-2']);
    });

    it('should propagate a failure of the frontier read itself', async () => {
      repository.listStrandedLive.mockRejectedValue(new Error('db down'));

      await expect(service.reapStranded({ limit: 25, ttlMs: TTL_MS, now: NOW })).rejects.toThrow(
        'db down'
      );
    });
  });

  describe('getStatusForOrder', () => {
    it('should return null when the order was never routed', async () => {
      await expect(
        service.getStatusForOrder({ orderId: 'ol_order_1', ttlMs: TTL_MS, now: NOW })
      ).resolves.toBeNull();
    });

    it('should report a live decision past its TTL as stranded since createdAt plus the TTL', async () => {
      repository.findLatestByOrderId.mockResolvedValue(decision());

      const view = await service.getStatusForOrder({ orderId: 'ol_order_1', ttlMs: TTL_MS, now: NOW });

      expect(view).toMatchObject({
        decisionId: 'ol_routingdecision_1',
        state: 'live',
        routerConnectionId: 'conn-router',
        ageMs: 3 * 60 * 60 * 1000,
        ttlMs: TTL_MS,
        strandedSince: new Date('2026-10-27T10:00:00.000Z'),
      });
    });

    it('should not report a live decision inside its TTL as stranded', async () => {
      repository.findLatestByOrderId.mockResolvedValue(
        decision({ createdAt: new Date('2026-10-27T11:30:00.000Z') })
      );

      const view = await service.getStatusForOrder({ orderId: 'ol_order_1', ttlMs: TTL_MS, now: NOW });

      expect(view?.strandedSince).toBeNull();
    });

    it('should never terminalise anything when read', async () => {
      repository.findLatestByOrderId.mockResolvedValue(decision());

      await service.getStatusForOrder({ orderId: 'ol_order_1', ttlMs: TTL_MS, now: NOW });

      expect(repository.terminalise).not.toHaveBeenCalled();
    });
  });
});
