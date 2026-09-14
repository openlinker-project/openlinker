/**
 * SalesDocumentRulesService — unit spec (#2170, #2186)
 *
 * Focused on the write-path conflict guard, threshold-ref validation, the
 * countries-listing merge, and the acknowledgment lifecycle —
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
import type { SalesDocumentCountryAcknowledgmentRepositoryPort } from '../../domain/ports/sales-document-country-acknowledgment-repository.port';
import { SalesDocumentRule } from '../../domain/entities/sales-document-rule.entity';
import { SalesDocumentCountryDefault } from '../../domain/entities/sales-document-country-default.entity';
import { SalesDocumentCountryAcknowledgment } from '../../domain/entities/sales-document-country-acknowledgment.entity';
import { SalesDocumentRuleConflictException } from '../../domain/exceptions/sales-document-rule-conflict.exception';
import { SalesDocumentInvalidConditionException } from '../../domain/exceptions/sales-document-invalid-condition.exception';
import { SalesDocumentCountryAlreadyConfiguredException } from '../../domain/exceptions/sales-document-country-already-configured.exception';
import type { SalesDocumentRuleInput } from '../../domain/types/sales-document-rule-write.types';
import type { SalesDocumentOrderFacts } from '../../domain/types/sales-document-order-facts.types';

function makeRuleRepo(): jest.Mocked<SalesDocumentRuleRepositoryPort> {
  return {
    findById: jest.fn(),
    findByCountry: jest.fn(),
    findByCountries: jest.fn(),
    findByIds: jest.fn(),
    findByCountryAndConditionsHash: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    countRulesByCountry: jest.fn(),
  };
}

function makeCountryDefaultRepo(): jest.Mocked<SalesDocumentCountryDefaultRepositoryPort> {
  return {
    findById: jest.fn(),
    findByCountry: jest.fn(),
    findByCountries: jest.fn(),
    findAll: jest.fn(),
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

function makeAcknowledgmentRepo(): jest.Mocked<SalesDocumentCountryAcknowledgmentRepositoryPort> {
  return {
    findAll: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
}

function countryDefault(overrides: {
  country: string;
  documentKind: string;
  connectionId: string;
}): SalesDocumentCountryDefault {
  return new SalesDocumentCountryDefault(
    `default-${overrides.country}-${overrides.documentKind}`,
    overrides.country,
    overrides.documentKind,
    overrides.connectionId,
    new Date(),
    new Date(),
  );
}

function existingRule(): SalesDocumentRule {
  return new SalesDocumentRule(
    'existing-rule-id',
    'PL',
    [{ field: 'buyerHasTaxId', op: 'eq', value: false }],
    'hash-abc',
    'fiscal-receipt',
    'conn-receipt-only',
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

describe('SalesDocumentRulesService (#2170, #2186)', () => {
  let ruleRepo: jest.Mocked<SalesDocumentRuleRepositoryPort>;
  let countryDefaultRepo: jest.Mocked<SalesDocumentCountryDefaultRepositoryPort>;
  let thresholdRepo: jest.Mocked<SalesDocumentThresholdRepositoryPort>;
  let acknowledgmentRepo: jest.Mocked<SalesDocumentCountryAcknowledgmentRepositoryPort>;
  let service: SalesDocumentRulesService;

  beforeEach(() => {
    ruleRepo = makeRuleRepo();
    countryDefaultRepo = makeCountryDefaultRepo();
    thresholdRepo = makeThresholdRepo();
    acknowledgmentRepo = makeAcknowledgmentRepo();
    service = new SalesDocumentRulesService(ruleRepo, countryDefaultRepo, thresholdRepo, acknowledgmentRepo);
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
        service.createRule(baseInput({ connectionId: 'conn-receipt-only' })),
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

  // #3189 replaced threshold-ref validation: an `orderTotalGross` condition
  // carries its own amount and currency now, so there is no ref to resolve and
  // the guard that matters is the SHAPE check. It matters for the same reason
  // the ref check did - a condition the engine cannot narrow reads as "this
  // rule never matches", with nothing said to the operator, so it has to be
  // refused at authoring time.
  describe('createRule — inline amount validation (#3189)', () => {
    it('should reject an orderTotalGross condition whose amount is not a decimal string', async () => {
      const input = baseInput({
        conditions: [
          { field: 'orderTotalGross', op: 'lt', amount: '450 PLN', currency: 'PLN' } as never,
        ],
      });

      await expect(service.createRule(input)).rejects.toBeInstanceOf(
        SalesDocumentInvalidConditionException,
      );
      expect(ruleRepo.findByCountryAndConditionsHash).not.toHaveBeenCalled();
      expect(ruleRepo.create).not.toHaveBeenCalled();
    });

    it('should reject an orderTotalGross condition whose currency is not an ISO code', async () => {
      const input = baseInput({
        conditions: [
          { field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'zloty' } as never,
        ],
      });

      await expect(service.createRule(input)).rejects.toBeInstanceOf(
        SalesDocumentInvalidConditionException,
      );
      expect(ruleRepo.create).not.toHaveBeenCalled();
    });

    it('should proceed on a well-formed inline amount', async () => {
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([]);
      ruleRepo.create.mockResolvedValue(existingRule());

      const input = baseInput({
        conditions: [{ field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' }],
      });

      await expect(service.createRule(input)).resolves.toBeDefined();
    });

    // The threshold table is no longer read on the evaluation or the write
    // path; asserted so a re-introduced lookup is a failing test rather than a
    // quiet re-coupling.
    it('should not consult the threshold repository at all', async () => {
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([]);
      ruleRepo.create.mockResolvedValue(existingRule());

      await service.createRule(
        baseInput({
          conditions: [{ field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' }],
        }),
      );

      expect(thresholdRepo.findByRefs).not.toHaveBeenCalled();
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

  describe('getRulesByIds (#3186)', () => {
    it('should pass through to the repository unchanged', async () => {
      const rule = existingRule();
      ruleRepo.findByIds.mockResolvedValue([rule]);

      await expect(service.getRulesByIds(['existing-rule-id'])).resolves.toEqual([rule]);
      expect(ruleRepo.findByIds).toHaveBeenCalledWith(['existing-rule-id']);
    });
  });

  describe('resolveRoutingBatch (#2516)', () => {
    const facts = (country: string): SalesDocumentOrderFacts => ({
      country,
      totalGross: 100,
      currency: 'PLN',
      buyerHasTaxId: undefined,
    });

    it('should return no decisions and read nothing for an empty batch', async () => {
      await expect(service.resolveRoutingBatch([])).resolves.toEqual([]);
      expect(ruleRepo.findByCountries).not.toHaveBeenCalled();
      expect(countryDefaultRepo.findByCountries).not.toHaveBeenCalled();
      expect(thresholdRepo.findAll).not.toHaveBeenCalled();
    });

    it('should read each store once for the whole batch, whatever its size', async () => {
      ruleRepo.findByCountries.mockResolvedValue([]);
      countryDefaultRepo.findByCountries.mockResolvedValue([]);
      thresholdRepo.findAll.mockResolvedValue([]);

      const batch = Array.from({ length: 40 }, (_, index) => facts(index % 2 === 0 ? 'PL' : 'DE'));
      const decisions = await service.resolveRoutingBatch(batch);

      expect(decisions).toHaveLength(40);
      expect(ruleRepo.findByCountries).toHaveBeenCalledTimes(1);
      expect(countryDefaultRepo.findByCountries).toHaveBeenCalledTimes(1);
      // #3189: the batch reads rules and defaults only - an `orderTotalGross`
      // condition carries its own amount, so the threshold store is not on the
      // evaluation path at all. Asserted as an absence so a re-introduced read
      // fails here rather than quietly adding a query per batch.
      expect(thresholdRepo.findAll).not.toHaveBeenCalled();
    });

    it('should load the distinct countries plus Rest of world', async () => {
      ruleRepo.findByCountries.mockResolvedValue([]);
      countryDefaultRepo.findByCountries.mockResolvedValue([]);
      thresholdRepo.findAll.mockResolvedValue([]);

      await service.resolveRoutingBatch([facts('PL'), facts('PL'), facts('DE')]);

      expect(ruleRepo.findByCountries).toHaveBeenCalledWith(['PL', 'DE', '*']);
      expect(countryDefaultRepo.findByCountries).toHaveBeenCalledWith(['PL', 'DE', '*']);
    });

    it('should resolve each order against its OWN country configuration', async () => {
      ruleRepo.findByCountries.mockResolvedValue([]);
      countryDefaultRepo.findByCountries.mockResolvedValue([
        countryDefault({ country: 'PL', documentKind: 'fiscal-receipt', connectionId: 'conn-pl' }),
      ]);
      thresholdRepo.findAll.mockResolvedValue([]);

      const decisions = await service.resolveRoutingBatch([facts('PL'), facts('DE')]);

      expect(decisions[0]).toEqual({
        kind: 'route',
        documentKind: 'fiscal-receipt',
        connectionId: 'conn-pl',
      });
      expect(decisions[1]).toEqual({
        kind: 'unresolved',
        reason: 'no-configuration-for-country',
      });
    });

    it('should apply a Rest of world default to a country carrying no configuration of its own', async () => {
      ruleRepo.findByCountries.mockResolvedValue([]);
      countryDefaultRepo.findByCountries.mockResolvedValue([
        countryDefault({ country: '*', documentKind: 'invoice', connectionId: 'conn-row' }),
      ]);
      thresholdRepo.findAll.mockResolvedValue([]);

      const [decision] = await service.resolveRoutingBatch([facts('DE')]);

      expect(decision).toEqual({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-row',
      });
    });
  });

  describe('listConfiguredCountries (#2186)', () => {
    it('should return a country with a rule count only (no defaults, no acknowledgment)', async () => {
      ruleRepo.countRulesByCountry.mockResolvedValue(new Map([['PL', 3]]));
      countryDefaultRepo.findAll.mockResolvedValue([]);
      acknowledgmentRepo.findAll.mockResolvedValue([]);

      const summaries = await service.listConfiguredCountries();

      expect(summaries).toEqual([
        {
          country: 'PL',
          ruleCount: 3,
          invoiceDefaultConnectionId: null,
          receiptDefaultConnectionId: null,
          acknowledgedNoDocumentAt: null,
        },
      ]);
    });

    it('should return a country with defaults only (no rules, no acknowledgment), keeping both document kinds distinct', async () => {
      ruleRepo.countRulesByCountry.mockResolvedValue(new Map());
      countryDefaultRepo.findAll.mockResolvedValue([
        countryDefault({ country: 'DE', documentKind: 'invoice', connectionId: 'conn-invoice' }),
        countryDefault({ country: 'DE', documentKind: 'fiscal-receipt', connectionId: 'conn-receipt' }),
      ]);
      acknowledgmentRepo.findAll.mockResolvedValue([]);

      const summaries = await service.listConfiguredCountries();

      expect(summaries).toEqual([
        {
          country: 'DE',
          ruleCount: 0,
          invoiceDefaultConnectionId: 'conn-invoice',
          receiptDefaultConnectionId: 'conn-receipt',
          acknowledgedNoDocumentAt: null,
        },
      ]);
    });

    it('should merge rules AND defaults for the same country into one row', async () => {
      ruleRepo.countRulesByCountry.mockResolvedValue(new Map([['FR', 2]]));
      countryDefaultRepo.findAll.mockResolvedValue([
        countryDefault({ country: 'FR', documentKind: 'invoice', connectionId: 'conn-fr' }),
      ]);
      acknowledgmentRepo.findAll.mockResolvedValue([]);

      const summaries = await service.listConfiguredCountries();

      expect(summaries).toEqual([
        {
          country: 'FR',
          ruleCount: 2,
          invoiceDefaultConnectionId: 'conn-fr',
          receiptDefaultConnectionId: null,
          acknowledgedNoDocumentAt: null,
        },
      ]);
    });

    it('should include an acknowledged country with no rules and no defaults, reporting the acknowledgment timestamp', async () => {
      const acknowledgedAt = new Date('2026-01-15T00:00:00.000Z');
      ruleRepo.countRulesByCountry.mockResolvedValue(new Map());
      countryDefaultRepo.findAll.mockResolvedValue([]);
      acknowledgmentRepo.findAll.mockResolvedValue([
        new SalesDocumentCountryAcknowledgment('ES', acknowledgedAt),
      ]);

      const summaries = await service.listConfiguredCountries();

      expect(summaries).toEqual([
        {
          country: 'ES',
          ruleCount: 0,
          invoiceDefaultConnectionId: null,
          receiptDefaultConnectionId: null,
          acknowledgedNoDocumentAt: acknowledgedAt.toISOString(),
        },
      ]);
    });

    it('should include the "★ Rest of world" pseudo-country (`*`) like any other country', async () => {
      ruleRepo.countRulesByCountry.mockResolvedValue(new Map([['*', 1]]));
      countryDefaultRepo.findAll.mockResolvedValue([]);
      acknowledgmentRepo.findAll.mockResolvedValue([]);

      const summaries = await service.listConfiguredCountries();

      expect(summaries).toEqual([
        {
          country: '*',
          ruleCount: 1,
          invoiceDefaultConnectionId: null,
          receiptDefaultConnectionId: null,
          acknowledgedNoDocumentAt: null,
        },
      ]);
    });
  });

  describe('acknowledgment lifecycle (#2186)', () => {
    it('should persist a no-document acknowledgment', async () => {
      const acknowledgedAt = new Date('2026-02-01T00:00:00.000Z');
      ruleRepo.findByCountry.mockResolvedValue([]);
      countryDefaultRepo.findByCountry.mockResolvedValue([]);
      acknowledgmentRepo.upsert.mockResolvedValue(
        new SalesDocumentCountryAcknowledgment('IT', acknowledgedAt),
      );

      const result = await service.acknowledgeNoDocument('IT');

      expect(acknowledgmentRepo.upsert).toHaveBeenCalledWith('IT');
      expect(result).toEqual(new SalesDocumentCountryAcknowledgment('IT', acknowledgedAt));
    });

    it('should reject acknowledging a country that still has an active rule', async () => {
      ruleRepo.findByCountry.mockResolvedValue([existingRule()]);
      countryDefaultRepo.findByCountry.mockResolvedValue([]);

      await expect(service.acknowledgeNoDocument('PL')).rejects.toBeInstanceOf(
        SalesDocumentCountryAlreadyConfiguredException,
      );
      expect(acknowledgmentRepo.upsert).not.toHaveBeenCalled();
    });

    it('should reject acknowledging a country that still has a country default', async () => {
      ruleRepo.findByCountry.mockResolvedValue([]);
      countryDefaultRepo.findByCountry.mockResolvedValue([
        countryDefault({ country: 'DE', documentKind: 'invoice', connectionId: 'conn-invoice' }),
      ]);

      await expect(service.acknowledgeNoDocument('DE')).rejects.toBeInstanceOf(
        SalesDocumentCountryAlreadyConfiguredException,
      );
      expect(acknowledgmentRepo.upsert).not.toHaveBeenCalled();
    });

    it('should explicitly clear an acknowledgment', async () => {
      await service.clearAcknowledgment('IT');
      expect(acknowledgmentRepo.delete).toHaveBeenCalledWith('IT');
    });

    it('should auto-clear the acknowledgment when a rule is created for that country', async () => {
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([]);
      ruleRepo.create.mockResolvedValue(existingRule());

      await service.createRule(baseInput({ country: 'IT' }));

      expect(acknowledgmentRepo.delete).toHaveBeenCalledWith('IT');
    });

    it('should NOT clear the acknowledgment when rule creation is rejected by the conflict guard', async () => {
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([existingRule()]);

      await expect(service.createRule(baseInput({ country: 'PL' }))).rejects.toBeInstanceOf(
        SalesDocumentRuleConflictException,
      );

      expect(acknowledgmentRepo.delete).not.toHaveBeenCalled();
    });

    it('should auto-clear the acknowledgment when a country default is upserted for that country', async () => {
      countryDefaultRepo.upsert.mockResolvedValue(
        countryDefault({ country: 'NL', documentKind: 'invoice', connectionId: 'conn-nl' }),
      );

      await service.upsertCountryDefault({
        country: 'NL',
        documentKind: 'invoice',
        connectionId: 'conn-nl',
      });

      expect(acknowledgmentRepo.delete).toHaveBeenCalledWith('NL');
    });
  });

  describe('country normalisation (#3176)', () => {
    it('should uppercase a mixed-case country before every rule lookup and write', async () => {
      ruleRepo.findByCountryAndConditionsHash.mockResolvedValue([]);
      ruleRepo.create.mockResolvedValue(existingRule());

      await service.createRule(baseInput({ country: 'pl' }));

      expect(ruleRepo.findByCountryAndConditionsHash).toHaveBeenCalledWith('PL', expect.any(String));
      expect(ruleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ country: 'PL' }));
      expect(acknowledgmentRepo.delete).toHaveBeenCalledWith('PL');

      await service.listRules('pl');
      expect(ruleRepo.findByCountry).toHaveBeenCalledWith('PL');
    });

    it('should uppercase a mixed-case country before every country-default lookup and write', async () => {
      countryDefaultRepo.upsert.mockResolvedValue(
        countryDefault({ country: 'PL', documentKind: 'invoice', connectionId: 'conn-pl' }),
      );

      await service.upsertCountryDefault({
        country: 'pl',
        documentKind: 'invoice',
        connectionId: 'conn-pl',
      });

      expect(countryDefaultRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'PL' }),
      );
      expect(acknowledgmentRepo.delete).toHaveBeenCalledWith('PL');

      await service.listCountryDefaults('pl');
      expect(countryDefaultRepo.findByCountry).toHaveBeenCalledWith('PL');
    });

    it('should trim + uppercase before acknowledging a country', async () => {
      ruleRepo.findByCountry.mockResolvedValue([]);
      countryDefaultRepo.findByCountry.mockResolvedValue([]);
      acknowledgmentRepo.upsert.mockResolvedValue(
        new SalesDocumentCountryAcknowledgment('PL', new Date()),
      );

      await service.acknowledgeNoDocument(' pl ');

      expect(ruleRepo.findByCountry).toHaveBeenCalledWith('PL');
      expect(countryDefaultRepo.findByCountry).toHaveBeenCalledWith('PL');
      expect(acknowledgmentRepo.upsert).toHaveBeenCalledWith('PL');
    });

    it('should resolve routing for an order whose delivery-address country is lowercase against an uppercase rule scope', async () => {
      ruleRepo.findByCountry.mockImplementation((country) =>
        Promise.resolve(country === 'PL' ? [existingRule()] : []),
      );
      countryDefaultRepo.findByCountry.mockResolvedValue([]);
      thresholdRepo.findAll.mockResolvedValue([]);

      const decision = await service.resolveRouting({
        country: 'pl',
        totalGross: 100,
        currency: 'PLN',
        taxTreatment: undefined,
        buyerHasTaxId: false,
      });

      expect(ruleRepo.findByCountry).toHaveBeenCalledWith('PL');
      expect(decision).toEqual({
        kind: 'route',
        documentKind: existingRule().documentKind,
        connectionId: existingRule().connectionId,
        ruleId: existingRule().id,
      });
    });

    it('should resolve a batch keyed by the normalised country, even when two orders differ only in case', async () => {
      ruleRepo.findByCountries.mockResolvedValue([existingRule()]);
      countryDefaultRepo.findByCountries.mockResolvedValue([]);
      thresholdRepo.findAll.mockResolvedValue([]);

      const orderFacts = (country: string): SalesDocumentOrderFacts => ({
        country,
        totalGross: 100,
        currency: 'PLN',
        taxTreatment: undefined,
        buyerHasTaxId: false,
      });

      const [upper, lower] = await service.resolveRoutingBatch([
        orderFacts('PL'),
        orderFacts('pl'),
      ]);

      expect(ruleRepo.findByCountries).toHaveBeenCalledWith(['PL', '*']);
      expect(upper).toEqual(lower);
    });
  });
  describe('detectRuleOverlap (#3190)', () => {
    it('asks only about the draft country and reports the rival', async () => {
      ruleRepo.findByCountry.mockResolvedValue([existingRule()]);

      const verdict = await service.detectRuleOverlap({
        country: 'PL',
        conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }],
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        effectiveTo: null,
      });

      // Country-scoped on purpose: two rules in different markets are already
      // disjoint by the engine's own tiering, so widening the read would spend
      // a scan to rediscover that.
      expect(ruleRepo.findByCountry).toHaveBeenCalledWith('PL');
      expect(verdict.overlapping).toEqual([
        {
          ruleId: existingRule().id,
          connectionId: existingRule().connectionId,
          documentKind: existingRule().documentKind,
        },
      ]);
    });

    it('never writes - it is a read, and the engine still holds an ambiguous order', async () => {
      ruleRepo.findByCountry.mockResolvedValue([existingRule()]);

      await service.detectRuleOverlap({
        country: 'PL',
        conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }],
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        effectiveTo: null,
      });

      expect(ruleRepo.create).not.toHaveBeenCalled();
    });
  });

});
