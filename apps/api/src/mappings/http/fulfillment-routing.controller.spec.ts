/**
 * Fulfillment Routing Controller unit tests (#836).
 *
 * Mocks IFulfillmentRoutingService. Covers delegation + DTO mapping, the
 * local routing-error → 400 mapping, and that connection-lifecycle exceptions
 * propagate untouched to the global `ConnectionExceptionFilter` (#1087).
 */

import { BadRequestException } from '@nestjs/common';
import {
  type IFulfillmentRoutingService,
  FulfillmentRoutingRule,
  IncompatibleProcessorException,
  DuplicateRoutingRuleException,
} from '@openlinker/core/mappings';
import {
  ConnectionNotFoundException,
  ConnectionDisabledException,
} from '@openlinker/core/identifier-mapping';
import { FulfillmentRoutingController } from './fulfillment-routing.controller';
import { UpsertRoutingRulesDto } from './dto/upsert-routing-rules.dto';

const SOURCE = 'conn-allegro';

function makeRule(): FulfillmentRoutingRule {
  return new FulfillmentRoutingRule(
    'rule-1',
    SOURCE,
    'method-x',
    'ol_managed_carrier',
    'conn-inpost',
    new Date(),
    new Date(),
  );
}

function dto(): UpsertRoutingRulesDto {
  const d = new UpsertRoutingRulesDto();
  d.items = [
    { sourceDeliveryMethodId: 'method-x', processorKind: 'ol_managed_carrier', processorConnectionId: 'conn-inpost' },
  ];
  return d;
}

describe('FulfillmentRoutingController', () => {
  let routing: jest.Mocked<IFulfillmentRoutingService>;
  let controller: FulfillmentRoutingController;

  beforeEach(() => {
    routing = {
      getRules: jest.fn(),
      getCandidateProcessors: jest.fn(),
      replaceRules: jest.fn(),
      resolve: jest.fn(),
      resolveBatch: jest.fn(),
    };
    controller = new FulfillmentRoutingController(routing);
  });

  describe('getRules', () => {
    it('should map persisted rules to response DTOs', async () => {
      routing.getRules.mockResolvedValue([makeRule()]);

      const result = await controller.getRules(SOURCE);

      expect(routing.getRules).toHaveBeenCalledWith(SOURCE);
      expect(result).toEqual([
        {
          id: 'rule-1',
          sourceConnectionId: SOURCE,
          sourceDeliveryMethodId: 'method-x',
          processorKind: 'ol_managed_carrier',
          processorConnectionId: 'conn-inpost',
        },
      ]);
    });

    it('should propagate ConnectionNotFoundException to the global filter (→ 404)', async () => {
      routing.getRules.mockRejectedValue(new ConnectionNotFoundException(SOURCE));

      await expect(controller.getRules(SOURCE)).rejects.toBeInstanceOf(ConnectionNotFoundException);
    });
  });

  describe('getCandidates', () => {
    it('should map candidates to response DTOs', async () => {
      routing.getCandidateProcessors.mockResolvedValue([
        { processorKind: 'omp_fulfilled', processorConnectionId: 'conn-ps' },
      ]);

      const result = await controller.getCandidates(SOURCE);

      expect(result).toEqual([{ processorKind: 'omp_fulfilled', processorConnectionId: 'conn-ps' }]);
    });

    it('should propagate ConnectionNotFoundException to the global filter (→ 404)', async () => {
      routing.getCandidateProcessors.mockRejectedValue(new ConnectionNotFoundException(SOURCE));

      await expect(controller.getCandidates(SOURCE)).rejects.toBeInstanceOf(ConnectionNotFoundException);
    });
  });

  describe('replaceRules', () => {
    it('should delegate and map the result', async () => {
      routing.replaceRules.mockResolvedValue([makeRule()]);

      const result = await controller.replaceRules(SOURCE, dto());

      expect(routing.replaceRules).toHaveBeenCalledWith(SOURCE, dto().items);
      expect(result).toHaveLength(1);
    });

    it('should map IncompatibleProcessorException to 400', async () => {
      routing.replaceRules.mockRejectedValue(
        new IncompatibleProcessorException('conn-inpost', 'ol_managed_carrier', 'nope'),
      );

      await expect(controller.replaceRules(SOURCE, dto())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should map DuplicateRoutingRuleException to 400', async () => {
      routing.replaceRules.mockRejectedValue(new DuplicateRoutingRuleException('method-x'));

      await expect(controller.replaceRules(SOURCE, dto())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should propagate ConnectionDisabledException to the global filter (→ 409)', async () => {
      routing.replaceRules.mockRejectedValue(new ConnectionDisabledException('conn-inpost'));

      await expect(controller.replaceRules(SOURCE, dto())).rejects.toBeInstanceOf(ConnectionDisabledException);
    });

    it('should propagate ConnectionNotFoundException to the global filter (→ 404)', async () => {
      routing.replaceRules.mockRejectedValue(new ConnectionNotFoundException(SOURCE));

      await expect(controller.replaceRules(SOURCE, dto())).rejects.toBeInstanceOf(ConnectionNotFoundException);
    });
  });
});
