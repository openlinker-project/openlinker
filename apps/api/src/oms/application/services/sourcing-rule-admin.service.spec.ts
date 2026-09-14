/**
 * Sourcing Rule Admin Service — unit tests (#2953)
 *
 * The subject is the VALIDATION matrix, which is the whole reason this service
 * exists between the controller and `RoutingRuleAdminPort`. The port itself is
 * mocked (`engineering-standards.md § Mocking Ports`).
 *
 * @module apps/api/src/oms/application/services
 */
import { BadRequestException } from '@nestjs/common';
import { OMS_PLATFORM_TYPE, RoutingRuleNotFoundError, type RoutingRuleRecord } from '@openlinker/oms';

import { SourcingRuleAdminService } from './sourcing-rule-admin.service';

const CONNECTION_ID = 'conn-oms';
const RULE_ID = 'rule-1';

function makeRecord(overrides: Partial<RoutingRuleRecord> = {}): RoutingRuleRecord {
  return {
    id: RULE_ID,
    connectionId: CONNECTION_ID,
    position: 1,
    kind: 'filter',
    name: 'in-stock',
    afterAction: 'quantity-split',
    priorityLocationIds: [],
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    recognised: true,
    ...overrides,
  };
}

/**
 * Mocked at the PORT / service-interface level, never at a concrete class
 * (`engineering-standards.md § Mocking Ports`). Typed as `jest.Mock` records
 * rather than `any` so a signature change here is a compile error.
 */
interface RulesMock {
  listRules: jest.Mock;
  getRule: jest.Mock;
  createRule: jest.Mock;
  updateRule: jest.Mock;
  deleteRule: jest.Mock;
  reorderRules: jest.Mock;
}

describe('SourcingRuleAdminService', () => {
  let rules: RulesMock;
  let connections: { get: jest.Mock };
  let locations: { getLocation: jest.Mock };
  let service: SourcingRuleAdminService;

  beforeEach(() => {
    rules = {
      listRules: jest.fn().mockResolvedValue([]),
      getRule: jest.fn().mockResolvedValue(makeRecord()),
      createRule: jest
        .fn()
        .mockImplementation((input: Partial<RoutingRuleRecord>) =>
          Promise.resolve(makeRecord(input))
        ),
      updateRule: jest.fn().mockResolvedValue(makeRecord()),
      deleteRule: jest.fn().mockResolvedValue(true),
      reorderRules: jest.fn().mockResolvedValue([]),
    };
    connections = {
      get: jest.fn().mockResolvedValue({ id: CONNECTION_ID, platformType: OMS_PLATFORM_TYPE }),
    };
    locations = { getLocation: jest.fn().mockResolvedValue({ id: 'loc-a' }) };

    service = new SourcingRuleAdminService(
      rules as never,
      connections as never,
      locations as never
    );
  });

  const validCreate = {
    position: 1,
    kind: 'filter' as const,
    name: 'in-stock',
    afterAction: 'quantity-split' as const,
  };

  describe('connection scoping', () => {
    it('should refuse authoring when the connection is not an OpenLinker OMS connection', async () => {
      connections.get.mockResolvedValue({ id: CONNECTION_ID, platformType: 'prestashop' });

      await expect(service.createRule(CONNECTION_ID, validCreate)).rejects.toThrow(
        BadRequestException
      );
      expect(rules.createRule).not.toHaveBeenCalled();
    });

    it('should name the remedy when refusing a non-OMS connection', async () => {
      connections.get.mockResolvedValue({ id: CONNECTION_ID, platformType: 'allegro' });

      await expect(service.listRules(CONNECTION_ID)).rejects.toThrow(/OpenLinker OMS/);
    });
  });

  describe('vocabulary validation', () => {
    it('should refuse a filter rule carrying a sort name', async () => {
      // Both names are members of the closed vocabulary, so a per-field @IsIn
      // accepts this — only the coercer round-trip catches the pairing.
      await expect(
        service.createRule(CONNECTION_ID, { ...validCreate, kind: 'filter', name: 'nearest' })
      ).rejects.toThrow(BadRequestException);
      expect(rules.createRule).not.toHaveBeenCalled();
    });

    it('should refuse a sort rule carrying a filter name', async () => {
      await expect(
        service.createRule(CONNECTION_ID, { ...validCreate, kind: 'sort', name: 'in-stock' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept a valid sort rule', async () => {
      await expect(
        service.createRule(CONNECTION_ID, { ...validCreate, kind: 'sort', name: 'least-splits' })
      ).resolves.toBeDefined();
      expect(rules.createRule).toHaveBeenCalled();
    });
  });

  describe('priorityLocationIds', () => {
    it('should refuse priorityLocationIds on a rule that does not read them', async () => {
      await expect(
        service.createRule(CONNECTION_ID, { ...validCreate, priorityLocationIds: ['loc-a'] })
      ).rejects.toThrow(/only read by the 'priority' sort/);
    });

    it('should accept priorityLocationIds on the priority sort', async () => {
      await expect(
        service.createRule(CONNECTION_ID, {
          ...validCreate,
          kind: 'sort',
          name: 'priority',
          priorityLocationIds: ['loc-a'],
        })
      ).resolves.toBeDefined();
    });

    it('should refuse an unknown location id and name it', async () => {
      locations.getLocation.mockResolvedValue(null);

      await expect(
        service.createRule(CONNECTION_ID, {
          ...validCreate,
          kind: 'sort',
          name: 'priority',
          priorityLocationIds: ['loc-missing'],
        })
      ).rejects.toThrow(/loc-missing/);
      expect(rules.createRule).not.toHaveBeenCalled();
    });

    it('should not query locations when the list is empty', async () => {
      await service.createRule(CONNECTION_ID, validCreate);
      expect(locations.getLocation).not.toHaveBeenCalled();
    });
  });

  describe('effective window', () => {
    it('should refuse a window that closes before it opens', async () => {
      await expect(
        service.createRule(CONNECTION_ID, {
          ...validCreate,
          effectiveFrom: new Date('2026-09-10T00:00:00.000Z'),
          effectiveTo: new Date('2026-09-01T00:00:00.000Z'),
        })
      ).rejects.toThrow(/effectiveTo must be after effectiveFrom/);
    });
  });

  describe('patching', () => {
    it('should validate the MERGED row, refusing a name that mismatches the stored kind', async () => {
      rules.getRule.mockResolvedValue(makeRecord({ kind: 'filter', name: 'in-stock' }));

      await expect(
        service.updateRule(CONNECTION_ID, RULE_ID, { name: 'nearest' })
      ).rejects.toThrow(BadRequestException);
      expect(rules.updateRule).not.toHaveBeenCalled();
    });

    it('should refuse ANY patch of an unrecognised row and point at delete', async () => {
      rules.getRule.mockResolvedValue(
        makeRecord({ name: 'method-capable', recognised: false })
      );

      // Even a position-only patch: the merged candidate still fails coercion.
      await expect(service.updateRule(CONNECTION_ID, RULE_ID, { position: 9 })).rejects.toThrow(
        /Delete it and create a replacement/
      );
    });

    it('should raise not-found rather than patching a rule on another connection', async () => {
      rules.getRule.mockResolvedValue(null);

      await expect(service.updateRule(CONNECTION_ID, RULE_ID, { position: 2 })).rejects.toThrow(
        RoutingRuleNotFoundError
      );
    });

    it('should validate the effective window against the MERGED row, not the patch alone', async () => {
      // The patch carries only `effectiveTo`; the opening instant comes from
      // the stored row. A check that looked at the patch in isolation would see
      // one date and pass.
      rules.getRule.mockResolvedValue(
        makeRecord({ effectiveFrom: new Date('2026-10-01T00:00:00.000Z') })
      );

      await expect(
        service.updateRule(CONNECTION_ID, RULE_ID, {
          effectiveTo: new Date('2026-09-01T00:00:00.000Z'),
        })
      ).rejects.toThrow(/effectiveTo must be after effectiveFrom/);
      expect(rules.updateRule).not.toHaveBeenCalled();
    });

    it('should accept a patch that CLEARS effectiveFrom, widening the window', async () => {
      // The `!== undefined` arms must read an explicit null as "clear", not as
      // "leave the stored value" — inverting them would refuse this.
      rules.getRule.mockResolvedValue(
        makeRecord({ effectiveFrom: new Date('2026-10-01T00:00:00.000Z') })
      );

      await expect(
        service.updateRule(CONNECTION_ID, RULE_ID, {
          effectiveFrom: null,
          effectiveTo: new Date('2026-09-01T00:00:00.000Z'),
        })
      ).resolves.toBeDefined();
    });
  });

  describe('reorder', () => {
    it('should delegate to the port once the connection is confirmed as OMS', async () => {
      await service.reorderRules(CONNECTION_ID, ['a', 'b']);
      expect(rules.reorderRules).toHaveBeenCalledWith(CONNECTION_ID, ['a', 'b']);
    });

    it('should refuse to reorder on a non-OMS connection', async () => {
      connections.get.mockResolvedValue({ id: CONNECTION_ID, platformType: 'woocommerce' });

      await expect(service.reorderRules(CONNECTION_ID, ['a'])).rejects.toThrow(
        BadRequestException
      );
      expect(rules.reorderRules).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should raise not-found when the rule does not belong to the connection', async () => {
      rules.deleteRule.mockResolvedValue(false);

      await expect(service.deleteRule(CONNECTION_ID, RULE_ID)).rejects.toThrow(
        RoutingRuleNotFoundError
      );
    });
  });

  describe('list', () => {
    it('should exclude retired rules by default', async () => {
      await service.listRules(CONNECTION_ID);
      expect(rules.listRules).toHaveBeenCalledWith(CONNECTION_ID, { includeSuperseded: false });
    });

    it('should include retired rules when asked', async () => {
      await service.listRules(CONNECTION_ID, true);
      expect(rules.listRules).toHaveBeenCalledWith(CONNECTION_ID, { includeSuperseded: true });
    });
  });
});
