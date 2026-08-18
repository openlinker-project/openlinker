/**
 * SalesDocumentRulesService — unit spec (#2170)
 *
 * Focused on the write-path conflict guard and threshold-ref validation —
 * `evaluateSalesDocumentRules` (the pure resolver `resolveRouting` delegates
 * to) has its own dedicated spec. Repositories are mocked ports, per
 * `docs/engineering-standards.md § Mocking Ports`.
 *
 * @module libs/core/src/sales-documents/application/services
 */
import { SalesDocumentRulesService } from './sales-document-rules.service';
import type { SalesDocumentRuleRepositoryPort } from '../../domain/ports/sales-document-rule-repository.port';
import type { SalesDocumentCountryDefaultRepositoryPort } from '../../domain/ports/sales-document-country-default-repository.port';
import type { SalesDocumentThresholdRepositoryPort } from '../../domain/ports/sales-document-threshold-repository.port';
import { SalesDocumentRule } from '../../domain/entities/sales-document-rule.entity';
import { SalesDocumentThreshold } from '../../domain/entities/sales-document-threshold.entity';
import { SalesDocumentRuleConflictException } from '../../domain/exceptions/sales-document-rule-conflict.exception';
import { SalesDocumentThresholdNotFoundException } from '../../domain/exceptions/sales-document-threshold-not-found.exception';
import type { SalesDocumentRuleInput } from '../../domain/types/sales-document-rule-write.types';

function makeRuleRepo(): jest.Mocked<SalesDocumentRuleRepositoryPort> {
  return {
    findById: jest.fn(),
    findByCountry: jest.fn(),
    findByCountryAndConditionsHash: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
}

function makeCountryDefaultRepo(): jest.Mocked<SalesDocumentCountryDefaultRepositoryPort> {
  return {
    findById: jest.fn(),
    findByCountry: jest.fn(),
    findByCountryAndKind: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
}

function makeThresholdRepo(): jest.Mocked<SalesDocumentThresholdRepositoryPort> {
  return {
    findAll: jest.fn(),
    findByRef: jest.fn(),
    findByRefs: jest.fn(),
    create: jest.fn(),
  };
}

function existingRule(): SalesDocumentRule {
  return new SalesDocumentRule(
    'existing-rule-id',
    'PL',
    [{ field: 'buyerHasTaxId', op: 'eq', value: false }],
    'hash-abc',
    'fiscal-receipt',
    'conn-eparagony',
    new Date('2020-01-01'),
    null,
    null,
    new Date(),
    new Date(),
  );
}

function baseInput(overrides: Partial<SalesDocumentRuleInput> = {}): SalesDocumentRuleInput {
  return {
    country: 'PL',
    conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }],
    documentKind: 'fiscal-receipt',
    connectionId: 'conn-new',
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
    provenance: null,
    ...overrides,
  };
}

describe('SalesDocumentRulesService (#2170)', () => {
  let ruleRepo: jest.Mocked<SalesDocumentRuleRepositoryPort>;
  let countryDefaultRepo: jest.Mocked<SalesDocumentCountryDefaultRepositoryPort>;
  let thresholdRepo: jest.Mocked<SalesDocumentThresholdRepositoryPort>;
  let service: SalesDocumentRulesService;

  beforeEach(() => {
    ruleRepo = makeRuleRepo();
    countryDefaultRepo = makeCountryDefaultRepo();
    thresholdRepo = makeThresholdRepo();
    service = new SalesDocumentRulesService(ruleRepo, countryDefaultRepo, thresholdRepo);
  });

  describe('createRule — conflict guard', () => {
    it('should reject a same-country/same-conditionsHash/different-connection rule with an overlapping effective range', async () => {
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([existingRule()]);

      await expect(service.createRule(baseInput())).rejects.toBeInstanceOf(
        SalesDocumentRuleConflictException,
      );
      expect(ruleRepo.create).not.toHaveBeenCalled();
    });

    it('should allow the SAME connection to re-share conditions (not a conflict)', async () => {
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([existingRule()]);
      ruleRepo.create.mockResolvedValue(existingRule());

      await expect(
        service.createRule(baseInput({ connectionId: 'conn-eparagony' })),
      ).resolves.toBeDefined();
    });

    it('should allow a different connection when the effective ranges do NOT overlap', async () => {
      const nonOverlapping = existingRule();
      // existing runs 2020-01-01 to null (open-ended) — a real non-overlap
      // needs the existing rule to have a closed end date before the new one starts.
      const closedExisting = new SalesDocumentRule(
        nonOverlapping.id,
        nonOverlapping.country,
        nonOverlapping.conditions,
        nonOverlapping.conditionsHash,
        nonOverlapping.documentKind,
        nonOverlapping.connectionId,
        new Date('2020-01-01'),
        new Date('2025-12-31'),
        null,
        new Date(),
        new Date(),
      );
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([closedExisting]);
      ruleRepo.create.mockResolvedValue(closedExisting);

      await expect(
        service.createRule(baseInput({ effectiveFrom: new Date('2026-01-01') })),
      ).resolves.toBeDefined();
    });
  });

  describe('createRule — threshold-ref validation', () => {
    it('should reject an orderTotalGross condition whose thresholdRef does not resolve', async () => {
      thresholdRepo.findByRefs.mockResolvedValue([]);

      const input = baseInput({
        conditions: [{ field: 'orderTotalGross', op: 'lt', thresholdRef: 'unknown-ref' }],
      });

      await expect(service.createRule(input)).rejects.toBeInstanceOf(
        SalesDocumentThresholdNotFoundException,
      );
      expect(ruleRepo.findByCountryAndConditionsHash).not.toHaveBeenCalled();
      expect(ruleRepo.create).not.toHaveBeenCalled();
    });

    it('should proceed when the referenced threshold resolves', async () => {
      thresholdRepo.findByRefs.mockResolvedValue([
        new SalesDocumentThreshold('pl-simplified-invoice-2026', 450, 'PLN', 'lt', new Date(), null, new Date(), new Date()),
      ]);
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([]);
      ruleRepo.create.mockResolvedValue(existingRule());

      const input = baseInput({
        conditions: [{ field: 'orderTotalGross', op: 'lt', thresholdRef: 'pl-simplified-invoice-2026' }],
      });

      await expect(service.createRule(input)).resolves.toBeDefined();
    });
  });

  describe('deleteRule', () => {
    it('should delete an existing rule', async () => {
      ruleRepo.findById.mockResolvedValue(existingRule());
      await service.deleteRule('existing-rule-id');
      expect(ruleRepo.delete).toHaveBeenCalledWith('existing-rule-id');
    });

    it('should throw when the rule does not exist', async () => {
      ruleRepo.findById.mockResolvedValue(null);
      await expect(service.deleteRule('missing')).rejects.toThrow();
      expect(ruleRepo.delete).not.toHaveBeenCalled();
    });
  });
});
