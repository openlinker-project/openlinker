/**
 * AutomationRulesService specs (#2358)
 *
 * The write path: vocabulary validation, the fail-closed `isActive` default,
 * and the save-time duplicate guard's overlap semantics.
 *
 * The guard's NEGATIVE cases matter as much as its positive one — a guard that
 * refuses a legitimate rule is as broken as one that admits a duplicate — so
 * both the non-overlapping-window case and the different-conditions case
 * (which is the #2047 runtime guard's job, not this one's) are asserted.
 *
 * @module libs/core/src/automation/application/services/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { AutomationRulesService } from '../automation-rules.service';
import { AUTOMATION_RULE_REPOSITORY_TOKEN } from '../../../automation.tokens';
import type {
  AutomationRulePersistInput,
  AutomationRuleRepositoryPort,
} from '../../../domain/ports/automation-rule-repository.port';
import { AutomationRule } from '../../../domain/entities/automation-rule.entity';
import type { AutomationRuleInput } from '../../types/automation-rule-write.types';
import { AutomationInvalidActionError } from '../../../domain/exceptions/automation-invalid-action.error';
import { AutomationInvalidConditionError } from '../../../domain/exceptions/automation-invalid-condition.error';
import { AutomationInvalidTriggerConfigError } from '../../../domain/exceptions/automation-invalid-trigger-config.error';
import { AutomationRuleConflictError } from '../../../domain/exceptions/automation-rule-conflict.error';
import { AutomationRuleNotFoundError } from '../../../domain/exceptions/automation-rule-not-found.error';
import { AutomationStepCountError } from '../../../domain/exceptions/automation-step-count.error';

const LABEL_STEP = {
  action: 'dispatch-shipment',
  carrierId: 'dpd',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};

function input(overrides: Partial<AutomationRuleInput> = {}): AutomationRuleInput {
  return {
    name: 'Label and tell',
    trigger: 'order.packed',
    triggerConfig: {},
    conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }],
    actions: [LABEL_STEP],
    effectiveFrom: new Date('2026-09-01'),
    effectiveTo: null,
    ...overrides,
  };
}

interface RuleOverrides {
  id?: string;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  isActive?: boolean;
  definitionHash?: string;
}

/**
 * Build a real `AutomationRule` INSTANCE, not a spread of one — the entity
 * carries a method (`hasIrreversibleAction`), so an object literal is not a
 * valid stand-in and would only type-check by weakening the entity.
 */
function rule(overrides: RuleOverrides = {}): AutomationRule {
  return new AutomationRule(
    overrides.id ?? 'rule-1',
    'Label and tell',
    'order.packed',
    {},
    [],
    [],
    overrides.definitionHash ?? 'hash',
    overrides.isActive ?? true,
    overrides.effectiveFrom ?? new Date('2026-09-01'),
    overrides.effectiveTo ?? null,
    null,
    null,
    new Date('2026-08-01'),
    new Date('2026-08-01'),
  );
}

describe('AutomationRulesService', () => {
  let service: AutomationRulesService;
  let repository: jest.Mocked<AutomationRuleRepositoryPort>;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findByTrigger: jest.fn(),
      findActiveByTrigger: jest.fn(),
      findByTriggerAndDefinitionHash: jest.fn().mockResolvedValue([]),
      countRulesByTrigger: jest.fn(),
      create: jest.fn((persist: AutomationRulePersistInput) =>
        Promise.resolve(
          rule({
            definitionHash: persist.definitionHash,
            isActive: persist.isActive,
            effectiveFrom: persist.effectiveFrom,
            effectiveTo: persist.effectiveTo,
          }),
        ),
      ),
      update: jest.fn((_id: string, persist: AutomationRulePersistInput) =>
        Promise.resolve(rule({ definitionHash: persist.definitionHash })),
      ),
      delete: jest.fn(),
    } as unknown as jest.Mocked<AutomationRuleRepositoryPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationRulesService,
        { provide: AUTOMATION_RULE_REPOSITORY_TOKEN, useValue: repository },
      ],
    }).compile();

    service = module.get(AutomationRulesService);
  });

  describe('createRule', () => {
    it('should persist a computed definition hash when the rule is well formed', async () => {
      await service.createRule(input());
      const persisted = repository.create.mock.calls[0][0];
      expect(persisted.definitionHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should default isActive to false when the caller omits it', async () => {
      // Fails closed: a rule is armed deliberately, never by omission.
      await service.createRule(input());
      expect(repository.create.mock.calls[0][0].isActive).toBe(false);
    });

    it('should honour an explicit isActive when the caller supplies it', async () => {
      await service.createRule(input({ isActive: true }));
      expect(repository.create.mock.calls[0][0].isActive).toBe(true);
    });

    it('should reject a malformed condition when the rule is created', async () => {
      await expect(
        service.createRule(input({ conditions: [{ field: 'nonsense', op: 'eq', value: 'x' }] })),
      ).rejects.toBeInstanceOf(AutomationInvalidConditionError);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject a malformed action when the rule is created', async () => {
      await expect(
        service.createRule(input({ actions: [{ action: 'launch-rocket' }] })),
      ).rejects.toBeInstanceOf(AutomationInvalidActionError);
    });

    it('should reject trigger parameters that do not match the trigger when created', async () => {
      await expect(
        service.createRule(input({ trigger: 'order.packed', triggerConfig: { withinHours: 4 } })),
      ).rejects.toBeInstanceOf(AutomationInvalidTriggerConfigError);
    });

    it('should reject an empty action list when the rule is created', async () => {
      // A rule with no steps is a rule that does nothing; saving one silently
      // would present an armed automation that can never have an effect.
      await expect(service.createRule(input({ actions: [] }))).rejects.toBeInstanceOf(
        AutomationStepCountError,
      );
    });

    it('should reject more than three steps when the rule is created', async () => {
      await expect(
        service.createRule(
          input({
            actions: [
              { action: 'relay-status-to-source' },
              { action: 'issue-sales-document' },
              LABEL_STEP,
              { action: 'relay-status-to-source' },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(AutomationStepCountError);
    });

    it('should reject an identical definition covering an overlapping window', async () => {
      repository.findByTriggerAndDefinitionHash.mockResolvedValue([
        rule({ id: 'rule-existing', effectiveFrom: new Date('2026-08-01'), effectiveTo: null }),
      ]);
      await expect(service.createRule(input())).rejects.toBeInstanceOf(AutomationRuleConflictError);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should allow an identical definition whose window does not overlap', async () => {
      // The versioning case: same rule, a later effective period.
      repository.findByTriggerAndDefinitionHash.mockResolvedValue([
        rule({
          id: 'rule-existing',
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: new Date('2026-06-30'),
        }),
      ]);
      await expect(service.createRule(input())).resolves.toBeDefined();
      expect(repository.create).toHaveBeenCalled();
    });

    it('should not treat two rules with different conditions as a conflict', async () => {
      // Two money rules that both match one order is the #2047 case, and it is
      // the RUNTIME guard's job (#2362) — this guard sees different hashes and
      // must let both save.
      repository.findByTriggerAndDefinitionHash.mockResolvedValue([]);
      await expect(
        service.createRule(
          input({ conditions: [{ field: 'orderCountry', op: 'eq', value: 'DE' }] }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('updateRule', () => {
    it('should reject an unknown id when the rule is updated', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.updateRule('missing', input())).rejects.toBeInstanceOf(
        AutomationRuleNotFoundError,
      );
    });

    it('should not conflict with itself when a rule is re-saved unchanged', async () => {
      repository.findById.mockResolvedValue(rule({ id: 'rule-1' }));
      repository.findByTriggerAndDefinitionHash.mockResolvedValue([rule({ id: 'rule-1' })]);
      await expect(service.updateRule('rule-1', input())).resolves.toBeDefined();
      expect(repository.update).toHaveBeenCalled();
    });

    it('should still conflict with a DIFFERENT overlapping rule when updated', async () => {
      repository.findById.mockResolvedValue(rule({ id: 'rule-1' }));
      repository.findByTriggerAndDefinitionHash.mockResolvedValue([
        rule({ id: 'rule-1' }),
        rule({ id: 'rule-2' }),
      ]);
      await expect(service.updateRule('rule-1', input())).rejects.toBeInstanceOf(
        AutomationRuleConflictError,
      );
    });
  });

  describe('deleteRule', () => {
    it('should reject an unknown id when a rule is deleted', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.deleteRule('missing')).rejects.toBeInstanceOf(
        AutomationRuleNotFoundError,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('should delete an existing rule when the id resolves', async () => {
      repository.findById.mockResolvedValue(rule({ id: 'rule-1' }));
      await service.deleteRule('rule-1');
      expect(repository.delete).toHaveBeenCalledWith('rule-1');
    });
  });
});
