/**
 * AutomationRuleRepository specs (#2358)
 *
 * Two behaviours that are contract rather than plumbing:
 *
 *  - **A malformed persisted member is DROPPED, not thrown.** One bad row must
 *    not crash every read of the rule carrying it (the #2170 "malformed row
 *    never matches" contract).
 *  - **A 23505 on the unique index becomes a DOMAIN error.** Infrastructure
 *    errors never escape the port, and the guard's exact layer must not surface
 *    a race as a raw 500.
 *
 * @module libs/core/src/automation/infrastructure/persistence/repositories/__tests__
 */
import { QueryFailedError } from 'typeorm';

import { AutomationRuleRepository } from '../automation-rule.repository';
import type { AutomationRuleOrmEntity } from '../../entities/automation-rule.orm-entity';
import { AutomationRuleConflictError } from '../../../../domain/exceptions/automation-rule-conflict.error';
import { AutomationRuleNotFoundError } from '../../../../domain/exceptions/automation-rule-not-found.error';
import type { AutomationRulePersistInput } from '../../../../domain/ports/automation-rule-repository.port';

function ormRow(overrides: Partial<AutomationRuleOrmEntity> = {}): AutomationRuleOrmEntity {
  return {
    id: 'rule-1',
    name: 'Label and tell',
    trigger: 'order.packed',
    triggerConfig: {},
    conditions: [],
    actions: [],
    definitionHash: 'hash',
    isActive: true,
    effectiveFrom: '2026-09-01',
    effectiveTo: null,
    moneyAckByUserId: null,
    moneyAckAt: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    ...overrides,
  } as AutomationRuleOrmEntity;
}

function persistInput(): AutomationRulePersistInput {
  return {
    name: 'Label and tell',
    trigger: 'order.packed',
    triggerConfig: {},
    conditions: [],
    actions: [{ action: 'relay-status-to-source' }],
    definitionHash: 'hash',
    isActive: false,
    effectiveFrom: new Date('2026-09-01'),
    effectiveTo: null,
  };
}

describe('AutomationRuleRepository', () => {
  /**
   * Typed per member rather than as a bare `jest.Mock` bag: an untyped mock
   * makes every `mock.calls[...]` read `any`, which is exactly where an
   * assertion silently stops checking anything.
   */
  let ormRepository: {
    findOne: jest.Mock<Promise<AutomationRuleOrmEntity | null>>;
    find: jest.Mock<Promise<AutomationRuleOrmEntity[]>>;
    create: jest.Mock<Partial<AutomationRuleOrmEntity>, [Partial<AutomationRuleOrmEntity>]>;
    merge: jest.Mock;
    save: jest.Mock<Promise<AutomationRuleOrmEntity>>;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let repository: AutomationRuleRepository;

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: Partial<AutomationRuleOrmEntity>) => value),
      merge: jest.fn(
        (target: AutomationRuleOrmEntity, value: Partial<AutomationRuleOrmEntity>) => ({
          ...target,
          ...value,
        }),
      ),
      save: jest.fn((value: AutomationRuleOrmEntity) => Promise.resolve(value)),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    repository = new AutomationRuleRepository(
      ormRepository as unknown as ConstructorParameters<typeof AutomationRuleRepository>[0],
    );
  });

  describe('toDomain via findById', () => {
    it('should drop a malformed condition rather than throwing when a row is read', async () => {
      ormRepository.findOne.mockResolvedValue(
        ormRow({
          conditions: [
            { field: 'orderCountry', op: 'eq', value: 'PL' },
            { field: 'nonsense', op: 'eq', value: 'x' },
          ],
        }),
      );
      const rule = await repository.findById('rule-1');
      expect(rule?.conditions).toHaveLength(1);
      expect(rule?.conditions[0].field).toBe('orderCountry');
    });

    it('should drop a malformed action rather than throwing when a row is read', async () => {
      ormRepository.findOne.mockResolvedValue(
        ormRow({ actions: [{ action: 'relay-status-to-source' }, { action: 'launch-rocket' }] }),
      );
      const rule = await repository.findById('rule-1');
      expect(rule?.actions).toHaveLength(1);
    });

    it('should degrade a trigger config that does not match its trigger to empty', async () => {
      // The safe direction: a deadline-sweep rule reads back with NO threshold,
      // which the sweep must treat as non-firing. It can never silently become
      // a different threshold.
      ormRepository.findOne.mockResolvedValue(
        ormRow({ trigger: 'order.on_hold_for', triggerConfig: { withinHours: -5 } }),
      );
      const rule = await repository.findById('rule-1');
      expect(rule?.triggerConfig).toEqual({});
    });

    it('should map a date-only column back to a Date when a row is read', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ effectiveTo: '2026-12-31' }));
      const rule = await repository.findById('rule-1');
      expect(rule?.effectiveFrom).toBeInstanceOf(Date);
      expect(rule?.effectiveTo).toBeInstanceOf(Date);
    });

    it('should return null when no row carries the id', async () => {
      ormRepository.findOne.mockResolvedValue(null);
      await expect(repository.findById('missing')).resolves.toBeNull();
    });

    it('should CARRY a row whose trigger this build does not recognise', async () => {
      // Dropping it would hide the rule from the surface that could fix it.
      ormRepository.findOne.mockResolvedValue(ormRow({ trigger: 'order.teleported' }));
      const rule = await repository.findById('rule-1');
      expect(rule?.trigger).toBe('order.teleported');
    });

    it('should WARN when it carries an unrecognised trigger, never silently', async () => {
      // The cast is the one place the declared type outruns what the row
      // proves, and #2359 switches on it with a `never` default.
      const warn = jest
        .spyOn(
          (repository as unknown as { logger: { warn: (m: string) => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      ormRepository.findOne.mockResolvedValue(ormRow({ trigger: 'order.teleported' }));

      await repository.findById('rule-1');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('order.teleported'));
    });
  });

  describe('findActiveByTrigger', () => {
    it('should exclude a rule whose effective window has already closed', async () => {
      ormRepository.find.mockResolvedValue([
        ormRow({ id: 'expired', effectiveTo: '2026-06-30' }),
        ormRow({ id: 'open', effectiveTo: null }),
      ]);
      const rules = await repository.findActiveByTrigger('order.packed', new Date('2026-09-15'));
      expect(rules.map((r) => r.id)).toEqual(['open']);
    });
  });

  describe('create', () => {
    it('should translate a unique-index violation into a domain conflict error', async () => {
      const violation = new QueryFailedError(
        'INSERT',
        [],
        new Error(
          'duplicate key value violates unique constraint "UQ_automation_rules_trigger_hash_from"',
        ),
      );
      (violation as QueryFailedError & { code?: string }).code = '23505';
      ormRepository.save.mockRejectedValue(violation);
      ormRepository.find.mockResolvedValue([ormRow({ id: 'rule-existing' })]);

      await expect(repository.create(persistInput())).rejects.toBeInstanceOf(
        AutomationRuleConflictError,
      );
    });

    it('should rethrow an unrelated database error unchanged', async () => {
      const other = new QueryFailedError('INSERT', [], new Error('connection lost'));
      ormRepository.save.mockRejectedValue(other);
      await expect(repository.create(persistInput())).rejects.toBe(other);
    });

    it('should serialize an open-ended effectiveTo as null when persisting', async () => {
      await repository.create(persistInput());
      expect(ormRepository.create.mock.calls[0][0].effectiveTo).toBeNull();
      expect(ormRepository.create.mock.calls[0][0].effectiveFrom).toBe('2026-09-01');
    });
  });

  describe('update', () => {
    it('should reject an unknown id when a rule is updated', async () => {
      ormRepository.findOne.mockResolvedValue(null);
      await expect(repository.update('missing', persistInput())).rejects.toBeInstanceOf(
        AutomationRuleNotFoundError,
      );
    });

    it('should preserve the money acknowledgement across an ordinary edit', async () => {
      // The write input does not carry moneyAck* (they are #2363's own write),
      // so merging rather than constructing is what stops an edit nulling them.
      const acknowledged = ormRow({
        moneyAckByUserId: 'user-1',
        moneyAckAt: new Date('2026-08-10'),
      });
      ormRepository.findOne.mockResolvedValue(acknowledged);
      const updated = await repository.update('rule-1', persistInput());
      expect(updated.moneyAckByUserId).toBe('user-1');
    });
  });

  describe('countRulesByTrigger', () => {
    it('should skip a trigger this build does not recognise when counting', async () => {
      ormRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([
            { trigger: 'order.packed', count: '3' },
            { trigger: 'order.teleported', count: '9' },
          ]),
      });
      const counts = await repository.countRulesByTrigger();
      expect(counts.get('order.packed')).toBe(3);
      expect(counts.size).toBe(1);
    });
  });
});
