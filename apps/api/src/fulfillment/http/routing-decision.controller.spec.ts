/**
 * RoutingDecisionController — unit spec (#2731)
 */
import { NotFoundException } from '@nestjs/common';
import type { RoutingDecisionStatusView } from '@openlinker/core/fulfillment';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { RoutingDecisionController } from './routing-decision.controller';

const view: RoutingDecisionStatusView = {
  decisionId: 'ol_routingdecision_1',
  state: 'live',
  routerConnectionId: 'conn-router',
  createdAt: new Date('2026-10-27T09:00:00.000Z'),
  ageMs: 3 * 60 * 60 * 1000,
  ttlMs: 60 * 60 * 1000,
  strandedSince: new Date('2026-10-27T10:00:00.000Z'),
  abandonReason: null,
  terminalisedAt: null,
};

describe('RoutingDecisionController (#2731)', () => {
  let reaper: { getStatusForOrder: jest.Mock; reapStranded: jest.Mock };
  let configService: { get: jest.Mock };
  let controller: RoutingDecisionController;

  beforeEach(() => {
    reaper = { getStatusForOrder: jest.fn().mockResolvedValue(view), reapStranded: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    controller = new RoutingDecisionController(reaper as never, configService as never);
  });

  it('should return the decision view for the order', async () => {
    const dto = await controller.getRoutingDecision('ol_order_1');

    expect(dto).toMatchObject({
      decisionId: 'ol_routingdecision_1',
      state: 'live',
      routerConnectionId: 'conn-router',
      ttlMs: 60 * 60 * 1000,
      strandedSince: new Date('2026-10-27T10:00:00.000Z'),
    });
  });

  it('should ask with the resolved TTL so the reported limit is the enforced one', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'OL_ROUTING_DECISION_TTL_MS' ? String(2 * 60 * 60 * 1000) : undefined
    );

    await controller.getRoutingDecision('ol_order_1');

    expect(reaper.getStatusForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ol_order_1', ttlMs: 2 * 60 * 60 * 1000 })
    );
  });

  it('should answer 404 when the order has no routing decision', async () => {
    reaper.getStatusForOrder.mockResolvedValue(null);

    await expect(controller.getRoutingDecision('ol_order_1')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('should never reap from the read path', async () => {
    await controller.getRoutingDecision('ol_order_1');

    expect(reaper.reapStranded).not.toHaveBeenCalled();
  });

  it('should be readable by admin, operator and viewer, and not by a packer', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      RoutingDecisionController.prototype.getRoutingDecision
    ) as readonly string[];

    expect([...roles].sort()).toEqual(['admin', 'operator', 'viewer']);
  });
});
