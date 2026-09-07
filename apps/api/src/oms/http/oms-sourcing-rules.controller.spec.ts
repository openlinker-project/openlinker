/**
 * OMS Sourcing Rules Controller — unit tests (#2953)
 *
 * The subject is the domain-error-to-status MAPPING, which is the controller's
 * only real logic and which the int-spec exercises only for the arms it happens
 * to trigger. In particular the reorder-mismatch 409 carries `missingRuleIds`
 * AND `unknownRuleIds` as FIELDS rather than folded into prose — a client that
 * parsed them out of the message would break on the first reword — and the
 * int-spec asserts only the first of the two.
 *
 * @module apps/api/src/oms/http
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  DuplicateLiveRoutingRuleError,
  RoutingRuleNotFoundError,
  RoutingRuleReorderMismatchError,
  type RoutingRuleRecord,
} from '@openlinker/oms';

import { OmsSourcingRulesController } from './oms-sourcing-rules.controller';

const CONNECTION_ID = 'conn-oms';
const RULE_ID = 'rule-1';

const record: RoutingRuleRecord = {
  id: RULE_ID,
  connectionId: CONNECTION_ID,
  position: 1,
  kind: 'filter',
  name: 'in-stock',
  afterAction: 'no-split',
  priorityLocationIds: [],
  effectiveFrom: null,
  effectiveTo: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-02T00:00:00.000Z'),
  recognised: true,
};

interface ServiceMock {
  listRules: jest.Mock;
  getRule: jest.Mock;
  createRule: jest.Mock;
  updateRule: jest.Mock;
  deleteRule: jest.Mock;
  reorderRules: jest.Mock;
}

describe('OmsSourcingRulesController', () => {
  let service: ServiceMock;
  let controller: OmsSourcingRulesController;

  beforeEach(() => {
    service = {
      listRules: jest.fn().mockResolvedValue([record]),
      getRule: jest.fn().mockResolvedValue(record),
      createRule: jest.fn().mockResolvedValue(record),
      updateRule: jest.fn().mockResolvedValue(record),
      deleteRule: jest.fn().mockResolvedValue(undefined),
      reorderRules: jest.fn().mockResolvedValue([record]),
    };
    controller = new OmsSourcingRulesController(service as never);
  });

  describe('error mapping', () => {
    it('should map RoutingRuleNotFoundError to 404', async () => {
      service.getRule.mockRejectedValue(new RoutingRuleNotFoundError(CONNECTION_ID, RULE_ID));

      await expect(controller.get(CONNECTION_ID, RULE_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('should map DuplicateLiveRoutingRuleError to 409', async () => {
      service.createRule.mockRejectedValue(
        new DuplicateLiveRoutingRuleError(CONNECTION_ID, 'filter', 'in-stock')
      );

      await expect(
        controller.create(CONNECTION_ID, {
          position: 1,
          kind: 'filter',
          name: 'in-stock',
          afterAction: 'no-split',
        } as never)
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should map a reorder mismatch to 409 carrying BOTH id sets as fields', async () => {
      service.reorderRules.mockRejectedValue(
        new RoutingRuleReorderMismatchError(CONNECTION_ID, ['missing-1'], ['ghost-1'])
      );

      const rejection = await controller
        .reorder(CONNECTION_ID, { ruleIds: ['ghost-1'] })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(ConflictException);
      expect((rejection as ConflictException).getResponse()).toMatchObject({
        missingRuleIds: ['missing-1'],
        unknownRuleIds: ['ghost-1'],
      });
    });

    it('should pass a service BadRequestException through unchanged', async () => {
      // The service raises this directly (non-OMS connection, unroutable rule),
      // and re-wrapping it would relabel a deliberate 400 as something else.
      const raised = new BadRequestException('not an OMS connection');
      service.listRules.mockRejectedValue(raised);

      await expect(controller.list(CONNECTION_ID, {})).rejects.toBe(raised);
    });

    it('should normalise a non-Error throw rather than rethrowing a bare value', async () => {
      service.deleteRule.mockRejectedValue('a string');

      const rejection = await controller
        .remove(CONNECTION_ID, RULE_ID)
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toBe('a string');
    });
  });

  describe('projection', () => {
    it('should serialise dates as ISO strings and carry the recognised flag', async () => {
      const [body] = await controller.list(CONNECTION_ID, {});

      expect(body).toMatchObject({
        id: RULE_ID,
        effectiveFrom: null,
        effectiveTo: '2026-12-01T00:00:00.000Z',
        recognised: true,
      });
    });

    it('should default includeSuperseded to false when the query omits it', async () => {
      await controller.list(CONNECTION_ID, {});
      expect(service.listRules).toHaveBeenCalledWith(CONNECTION_ID, false);
    });
  });

  describe('patch shaping', () => {
    it('should forward only the fields the patch actually carried', async () => {
      // An absent field must not reach the service as an explicit `undefined`
      // that a spread would then treat as "clear it".
      await controller.update(CONNECTION_ID, RULE_ID, { position: 3 });

      expect(service.updateRule).toHaveBeenCalledWith(CONNECTION_ID, RULE_ID, { position: 3 });
    });

    it('should forward an explicit null effectiveTo as a clear', async () => {
      await controller.update(CONNECTION_ID, RULE_ID, { effectiveTo: null });

      expect(service.updateRule).toHaveBeenCalledWith(CONNECTION_ID, RULE_ID, {
        effectiveTo: null,
      });
    });
  });
});
