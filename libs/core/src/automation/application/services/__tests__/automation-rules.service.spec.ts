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
import { AutomationIllegalPairError } from '../../../domain/exceptions/automation-illegal-pair.error';
import { AutomationIllegalConditionFieldError } from '../../../domain/exceptions/automation-illegal-condition-field.error';

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
  moneyAckByUserId?: string | null;
  moneyAckAt?: Date | null;
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
    overrides.moneyAckByUserId ?? null,
    overrides.moneyAckAt ?? null,
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
      setMoneyAck: jest.fn((id: string, byUserId: string | null, at: Date | null) =>
        Promise.resolve(rule({ id, moneyAckByUserId: byUserId, moneyAckAt: at })),
      ),
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

  describe('the §5.4 legality matrix is enforced on the write path (#2359)', () => {
    // The matrix is declared once and consumed by three call sites; enforcing it
    // HERE is what stops an illegal pair being persisted by curl, which would
    // otherwise save, arm and never fire.
    it('should refuse an action the trigger may not carry', async () => {
      await expect(
        service.createRule(input({ trigger: 'return.received', actions: [LABEL_STEP] })),
      ).rejects.toBeInstanceOf(AutomationIllegalPairError);
    });

    it('should name the offending pair, which is what the API renders', async () => {
      await expect(
        service.createRule(input({ trigger: 'return.received', actions: [LABEL_STEP] })),
      ).rejects.toThrow(/dispatch-shipment.*return\.received/);
    });

    it('should admit the pair that justifies the wave (T5 packed -> A2 label)', async () => {
      await expect(
        service.createRule(input({ trigger: 'order.packed', actions: [LABEL_STEP] })),
      ).resolves.toBeDefined();
    });

    it('should refuse a holdReason condition on a trigger that has no hold', async () => {
      await expect(
        service.createRule(
          input({
            trigger: 'order.packed',
            conditions: [{ field: 'holdReason', op: 'eq', value: 'payment-review' }],
          }),
        ),
      ).rejects.toBeInstanceOf(AutomationIllegalConditionFieldError);
    });

    it('should admit a holdReason condition on T1/T2/T3', async () => {
      await expect(
        service.createRule(
          input({
            trigger: 'order.hold.placed',
            actions: [{ action: 'send-email', recipient: { kind: 'buyer' }, subject: 's', body: 'b' }],
            conditions: [{ field: 'holdReason', op: 'eq', value: 'payment-review' }],
          }),
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

  describe('validateRule (#2363 — the dry run\'s draft path)', () => {
    it('should apply the same refusals a save applies', () => {
      // A preview and a save must not disagree about what is legal, or the
      // operator passes the gate and then cannot save what they tested.
      expect(() => service.validateRule(input({ trigger: 'return.received' }))).toThrow(
        AutomationIllegalPairError,
      );
      expect(() => service.validateRule(input({ actions: [] }))).toThrow(AutomationStepCountError);
      expect(() => service.validateRule(input({ conditions: [{ field: 'nope' }] }))).toThrow(
        AutomationInvalidConditionError,
      );
    });

    it('should compute the same hash a save would, without touching the repository', () => {
      // Non-mutation, structurally: no repository method is reachable from this
      // call. The int-spec pins the same property end to end by counting rows.
      const validated = service.validateRule(input());
      expect(validated.definitionHash).toMatch(/^[0-9a-f]{64}$/);
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.setMoneyAck).not.toHaveBeenCalled();
    });
  });

  describe('the money acknowledgement (#2363, spec §5.7 S3-2)', () => {
    it('should stamp the ack on create when the caller supplies one', async () => {
      await service.createRule(input({ isActive: true }), { byUserId: 'user-7' });
      expect(repository.setMoneyAck).toHaveBeenCalledWith('rule-1', 'user-7', expect.any(Date));
    });

    it('should not stamp anything when no ack is supplied', async () => {
      await service.createRule(input({ isActive: true }));
      expect(repository.setMoneyAck).not.toHaveBeenCalled();
    });

    it('should CLEAR an existing ack when the definition changes', async () => {
      // The ack is evidence about what the rule DOES. An ack given for "email me"
      // must not carry forward to "buy a label".
      repository.findById.mockResolvedValue(
        rule({ definitionHash: 'a-different-hash', moneyAckByUserId: 'user-7' }),
      );
      await service.updateRule('rule-1', input());
      expect(repository.setMoneyAck).toHaveBeenCalledWith('rule-1', null, null);
    });

    it('should clear BEFORE the definition is written, so a crash never leaves a stale ack', async () => {
      const order: string[] = [];
      repository.findById.mockResolvedValue(
        rule({ definitionHash: 'a-different-hash', moneyAckByUserId: 'user-7' }),
      );
      repository.setMoneyAck.mockImplementation((id: string) => {
        order.push('ack');
        return Promise.resolve(rule({ id }));
      });
      repository.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve(rule());
      });

      await service.updateRule('rule-1', input());

      // Clear first: a failure between the two leaves the OLD definition with NO
      // ack, never a new definition carrying an old one.
      expect(order).toEqual(['ack', 'update']);
    });

    it('should PRESERVE the ack when only the name changes', async () => {
      // A rename must not make an operator click through a money warning again —
      // that is how a warning stops being read.
      const validated = service.validateRule(input());
      repository.findById.mockResolvedValue(
        rule({ definitionHash: validated.definitionHash, moneyAckByUserId: 'user-7' }),
      );
      await service.updateRule('rule-1', input({ name: 'Renamed, same behaviour' }));
      expect(repository.setMoneyAck).not.toHaveBeenCalled();
    });

    it('should preserve the ack when only the effective window moves', async () => {
      const validated = service.validateRule(input());
      repository.findById.mockResolvedValue(
        rule({ definitionHash: validated.definitionHash, moneyAckByUserId: 'user-7' }),
      );
      await service.updateRule('rule-1', input({ effectiveTo: new Date('2027-01-01') }));
      expect(repository.setMoneyAck).not.toHaveBeenCalled();
    });

    it('should not clear when there was no ack to clear', async () => {
      repository.findById.mockResolvedValue(rule({ definitionHash: 'a-different-hash' }));
      await service.updateRule('rule-1', input());
      expect(repository.setMoneyAck).not.toHaveBeenCalled();
    });

    it('should refuse setMoneyAck for a rule that does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.setMoneyAck('nope', 'user-7')).rejects.toThrow(
        AutomationRuleNotFoundError,
      );
    });

    it('should pass a null instant when clearing through setMoneyAck', async () => {
      repository.findById.mockResolvedValue(rule({ moneyAckByUserId: 'user-7' }));
      await service.setMoneyAck('rule-1', null);
      expect(repository.setMoneyAck).toHaveBeenCalledWith('rule-1', null, null);
    });
  });
});
