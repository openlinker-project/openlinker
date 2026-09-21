/**
 * Sales-Document Rules Controller - unit tests (#3299)
 *
 * The controller's own siblings (`SalesDocumentMarketsController`,
 * `SalesDocumentTemplatesController`) already have specs; this one had none.
 * Constructed directly (the `SalesDocumentTemplatesController` shape) rather
 * than through a `TestingModule`, since the constructor takes two plain
 * dependencies and no framework wiring is under test.
 *
 * @module apps/api/src/sales-documents/http
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ISalesDocumentRulesService } from '@openlinker/core/sales-documents';
import {
  SalesDocumentCountryAlreadyConfiguredException,
  SalesDocumentCountryDefaultNotFoundException,
  SalesDocumentInvalidConditionException,
  SalesDocumentRuleConflictException,
  SalesDocumentRuleNotFoundException,
  SalesDocumentThresholdNotFoundException,
} from '@openlinker/core/sales-documents';
import { SalesDocumentRulesController } from './sales-document-rules.controller';
import type { SalesDocumentCapabilityGuardService } from '../sales-document-capability-guard.service';

describe('SalesDocumentRulesController', () => {
  let service: jest.Mocked<ISalesDocumentRulesService>;
  let capabilityGuard: jest.Mocked<Pick<SalesDocumentCapabilityGuardService, 'assertConnectionSupportsKind'>>;
  let controller: SalesDocumentRulesController;

  const ruleFixture = {
    id: 'rule-1',
    country: 'PL',
    conditions: [{ field: 'buyerHasTaxId' as const, op: 'eq' as const, value: true }],
    conditionsHash: 'hash-1',
    documentKind: 'invoice',
    connectionId: 'conn-1',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    provenance: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    service = {
      listRules: jest.fn(),
      createRule: jest.fn(),
      detectRuleOverlap: jest.fn(),
      deleteRule: jest.fn(),
      listCountryDefaults: jest.fn(),
      upsertCountryDefault: jest.fn(),
      deleteCountryDefault: jest.fn(),
      listThresholds: jest.fn(),
      listConfiguredCountries: jest.fn(),
      acknowledgeNoDocument: jest.fn(),
      clearAcknowledgment: jest.fn(),
    } as unknown as jest.Mocked<ISalesDocumentRulesService>;
    capabilityGuard = { assertConnectionSupportsKind: jest.fn().mockResolvedValue(undefined) };
    controller = new SalesDocumentRulesController(
      service,
      capabilityGuard as unknown as SalesDocumentCapabilityGuardService,
    );
  });

  describe('listRules', () => {
    it('should delegate to the service and map each rule to a response DTO', async () => {
      service.listRules.mockResolvedValue([ruleFixture]);

      const result = await controller.listRules('PL');

      expect(service.listRules).toHaveBeenCalledWith('PL');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'rule-1', country: 'PL', documentKind: 'invoice' });
    });

    it('should reject an empty country before calling the service', async () => {
      await expect(controller.listRules('')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.listRules).not.toHaveBeenCalled();
    });

    it('should reject a country longer than 8 characters before calling the service', async () => {
      await expect(controller.listRules('123456789')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.listRules).not.toHaveBeenCalled();
    });

    it("should accept the '*' Rest-of-world sentinel", async () => {
      service.listRules.mockResolvedValue([]);

      await controller.listRules('*');

      expect(service.listRules).toHaveBeenCalledWith('*');
    });
  });

  describe('createRule', () => {
    const dto = {
      country: 'PL',
      conditions: [{ field: 'buyerHasTaxId' as const, op: 'eq' as const, boolValue: true }],
      documentKind: 'invoice' as const,
      connectionId: 'conn-1',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      provenance: null,
    };

    it('should check the connection capability before creating the rule', async () => {
      service.createRule.mockResolvedValue(ruleFixture);

      await controller.createRule(dto);

      expect(capabilityGuard.assertConnectionSupportsKind).toHaveBeenCalledWith('conn-1', 'invoice');
      expect(service.createRule).toHaveBeenCalledWith(
        expect.objectContaining({
          country: 'PL',
          documentKind: 'invoice',
          connectionId: 'conn-1',
          conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }],
        }),
      );
    });

    it('should map a conflict from the service to 409', async () => {
      service.createRule.mockRejectedValue(new SalesDocumentRuleConflictException('rule-2', 'conn-2'));

      await expect(controller.createRule(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('should map an invalid-condition error from the service to 400', async () => {
      service.createRule.mockRejectedValue(new SalesDocumentInvalidConditionException(0));

      await expect(controller.createRule(dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should let an unrecognized error propagate unchanged', async () => {
      const unknown = new Error('boom');
      service.createRule.mockRejectedValue(unknown);

      await expect(controller.createRule(dto)).rejects.toBe(unknown);
    });
  });

  describe('checkRuleOverlap', () => {
    const overlapDto = {
      country: 'PL',
      conditions: [{ field: 'buyerHasTaxId' as const, op: 'eq' as const, boolValue: true }],
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      excludeRuleId: 'rule-being-edited',
    };
    const emptyVerdict = { overlapping: [], disjoint: [], undecided: [] };

    it('should validate the country param before calling the service', async () => {
      await expect(
        controller.checkRuleOverlap({ ...overlapDto, country: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.detectRuleOverlap).not.toHaveBeenCalled();
    });

    it('should reject a country longer than 8 characters', async () => {
      await expect(
        controller.checkRuleOverlap({ ...overlapDto, country: '123456789' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.detectRuleOverlap).not.toHaveBeenCalled();
    });

    it('should delegate to detectRuleOverlap with the mapped domain conditions and excludeRuleId', async () => {
      service.detectRuleOverlap.mockResolvedValue(emptyVerdict);

      await controller.checkRuleOverlap(overlapDto);

      expect(service.detectRuleOverlap).toHaveBeenCalledWith({
        country: 'PL',
        conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }],
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
        excludeRuleId: 'rule-being-edited',
      });
    });

    it('should never check the connection capability - it is a read', async () => {
      service.detectRuleOverlap.mockResolvedValue(emptyVerdict);

      await controller.checkRuleOverlap(overlapDto);

      expect(capabilityGuard.assertConnectionSupportsKind).not.toHaveBeenCalled();
    });

    it('should map the verdict into the response shape verbatim', async () => {
      service.detectRuleOverlap.mockResolvedValue({
        overlapping: [{ ruleId: 'rule-2', connectionId: 'conn-2', documentKind: 'invoice' }],
        disjoint: [{ ruleId: 'rule-3', reason: 'currency' }],
        undecided: [{ ruleId: 'rule-4', reason: 'unreadable-condition' }],
      });

      const result = await controller.checkRuleOverlap(overlapDto);

      expect(result.overlapping).toEqual([
        { ruleId: 'rule-2', connectionId: 'conn-2', documentKind: 'invoice' },
      ]);
      expect(result.disjoint).toEqual([{ ruleId: 'rule-3', reason: 'currency' }]);
      expect(result.undecided).toEqual([{ ruleId: 'rule-4', reason: 'unreadable-condition' }]);
    });

    it('should reject a malformed condition (DTO-level toDomain gate) rather than sending it to the service', async () => {
      // `buyerHasTaxId` requires a boolean `boolValue` - the DTO's own
      // `toDomain` throws before the service is ever called, exactly as it
      // does on the `createRule` path (`sales-document-condition.dto.ts`).
      const malformed = {
        ...overlapDto,
        conditions: [{ field: 'buyerHasTaxId' as const, op: 'eq' as const }],
      };

      await expect(controller.checkRuleOverlap(malformed)).rejects.toBeInstanceOf(BadRequestException);
      expect(service.detectRuleOverlap).not.toHaveBeenCalled();
    });

    it('should reject a blank-after-trim orderCountry condition value', async () => {
      const malformed = {
        ...overlapDto,
        conditions: [{ field: 'orderCountry' as const, op: 'eq' as const, stringValue: '   ' }],
      };

      await expect(controller.checkRuleOverlap(malformed)).rejects.toBeInstanceOf(BadRequestException);
      expect(service.detectRuleOverlap).not.toHaveBeenCalled();
    });

    it('should reject an orderTotalGross condition with a non-decimal-string amount', async () => {
      const malformed = {
        ...overlapDto,
        conditions: [
          { field: 'orderTotalGross' as const, op: 'gte' as const, amount: 'not-a-number', currency: 'PLN' },
        ],
      };

      await expect(controller.checkRuleOverlap(malformed)).rejects.toBeInstanceOf(BadRequestException);
      expect(service.detectRuleOverlap).not.toHaveBeenCalled();
    });

    it('should reject an orderTotalGross condition whose op is neither gte nor lt', async () => {
      const malformed = {
        ...overlapDto,
        conditions: [
          { field: 'orderTotalGross' as const, op: 'eq' as const, amount: '450.00', currency: 'PLN' },
        ],
      };

      await expect(controller.checkRuleOverlap(malformed)).rejects.toBeInstanceOf(BadRequestException);
      expect(service.detectRuleOverlap).not.toHaveBeenCalled();
    });

    it('should treat effectiveTo as null when omitted', async () => {
      service.detectRuleOverlap.mockResolvedValue(emptyVerdict);

      await controller.checkRuleOverlap({ ...overlapDto, effectiveTo: undefined });

      expect(service.detectRuleOverlap).toHaveBeenCalledWith(
        expect.objectContaining({ effectiveTo: null }),
      );
    });
  });

  describe('deleteRule', () => {
    it('should delegate to the service', async () => {
      await controller.deleteRule('rule-1');

      expect(service.deleteRule).toHaveBeenCalledWith('rule-1');
    });

    it('should map a not-found error to 404', async () => {
      service.deleteRule.mockRejectedValue(new SalesDocumentRuleNotFoundException('rule-1'));

      await expect(controller.deleteRule('rule-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listCountryDefaults', () => {
    it('should validate the country param before calling the service', async () => {
      await expect(controller.listCountryDefaults('')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.listCountryDefaults).not.toHaveBeenCalled();
    });

    it('should delegate to the service and map each default', async () => {
      const countryDefaultFixture = {
        id: 'def-1',
        country: 'PL',
        documentKind: 'invoice' as const,
        connectionId: 'conn-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      service.listCountryDefaults.mockResolvedValue([countryDefaultFixture]);

      const result = await controller.listCountryDefaults('PL');

      expect(service.listCountryDefaults).toHaveBeenCalledWith('PL');
      expect(result).toEqual([
        { id: 'def-1', country: 'PL', documentKind: 'invoice', connectionId: 'conn-1' },
      ]);
    });
  });

  describe('upsertCountryDefault', () => {
    const dto = { country: 'PL', documentKind: 'invoice' as const, connectionId: 'conn-1' };

    it('should check the connection capability before upserting', async () => {
      service.upsertCountryDefault.mockResolvedValue({
        id: 'def-1',
        country: 'PL',
        documentKind: 'invoice',
        connectionId: 'conn-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await controller.upsertCountryDefault(dto);

      expect(capabilityGuard.assertConnectionSupportsKind).toHaveBeenCalledWith('conn-1', 'invoice');
      expect(service.upsertCountryDefault).toHaveBeenCalledWith(dto);
    });
  });

  describe('deleteCountryDefault', () => {
    it('should delegate to the service', async () => {
      await controller.deleteCountryDefault('def-1');

      expect(service.deleteCountryDefault).toHaveBeenCalledWith('def-1');
    });

    it('should map a not-found error to 404', async () => {
      service.deleteCountryDefault.mockRejectedValue(
        new SalesDocumentCountryDefaultNotFoundException('def-1'),
      );

      await expect(controller.deleteCountryDefault('def-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listThresholds', () => {
    it('should delegate to the service with no arguments', async () => {
      service.listThresholds.mockResolvedValue([
        {
          ref: 'pl-vat-invoice-threshold',
          amount: 450,
          currency: 'PLN',
          comparisonOp: 'gte' as const,
          versionEffectiveFrom: new Date('2026-01-01'),
          versionEffectiveTo: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await controller.listThresholds();

      expect(service.listThresholds).toHaveBeenCalledWith();
      expect(result[0]).toMatchObject({ ref: 'pl-vat-invoice-threshold', amount: 450, currency: 'PLN' });
    });
  });

  describe('listConfiguredCountries', () => {
    it('should delegate to the service and map each summary', async () => {
      service.listConfiguredCountries.mockResolvedValue([
        {
          country: 'PL',
          ruleCount: 2,
          invoiceDefaultConnectionId: 'conn-1',
          receiptDefaultConnectionId: null,
          acknowledgedNoDocumentAt: null,
        },
      ]);

      const result = await controller.listConfiguredCountries();

      expect(result[0]).toMatchObject({ country: 'PL', ruleCount: 2 });
    });
  });

  describe('acknowledgeNoDocument', () => {
    it('should validate the country param before calling the service', async () => {
      await expect(controller.acknowledgeNoDocument('')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.acknowledgeNoDocument).not.toHaveBeenCalled();
    });

    it('should delegate to the service', async () => {
      service.acknowledgeNoDocument.mockResolvedValue({
        country: 'PL',
        acknowledgedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await controller.acknowledgeNoDocument('PL');

      expect(service.acknowledgeNoDocument).toHaveBeenCalledWith('PL');
      expect(result.country).toBe('PL');
    });

    it('should map an already-configured error to 409', async () => {
      service.acknowledgeNoDocument.mockRejectedValue(
        new SalesDocumentCountryAlreadyConfiguredException('PL'),
      );

      await expect(controller.acknowledgeNoDocument('PL')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('clearAcknowledgment', () => {
    it('should validate the country param before calling the service', async () => {
      await expect(controller.clearAcknowledgment('')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.clearAcknowledgment).not.toHaveBeenCalled();
    });

    it('should delegate to the service', async () => {
      await controller.clearAcknowledgment('PL');

      expect(service.clearAcknowledgment).toHaveBeenCalledWith('PL');
    });
  });

  describe('toHttpException fallback (via deleteRule)', () => {
    it('should map a threshold-not-found error to 400', async () => {
      service.deleteRule.mockRejectedValue(new SalesDocumentThresholdNotFoundException('some-ref'));

      await expect(controller.deleteRule('rule-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
