/**
 * AutomationsController specs (#2363)
 *
 * Three things this controller owns and nothing below it does: the required
 * `trigger` param, the money-acknowledgement refusal, and the honest reporting
 * of what an operator can actually arm.
 *
 * @module apps/api/src/automation/http/__tests__
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AutomationRule,
  AutomationRuleNotFoundError,
  type IAutomationRulesService,
  type IAutomationRunsReadService,
} from '@openlinker/core/automation';

import type { AuthenticatedUser } from '../../../auth/auth.types';
import type { IAutomationDryRunService } from '../../application/automation-dry-run.tokens';
import { AutomationsController } from '../automations.controller';
import type { WriteAutomationRuleDto } from '../dto/automation-rule.dto';

const USER = { id: 'user-7' } as AuthenticatedUser;

const LABEL_STEP = {
  action: 'dispatch-shipment',
  carrierId: 'dpd',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};
const EMAIL_STEP = {
  action: 'send-email',
  recipient: { kind: 'buyer' },
  subject: 'Packed',
  body: 'On its way.',
};

function body(overrides: Partial<WriteAutomationRuleDto> = {}): WriteAutomationRuleDto {
  return {
    name: 'Label and tell',
    trigger: 'order.packed',
    triggerConfig: {},
    conditions: [],
    actions: [EMAIL_STEP],
    effectiveFrom: '2026-09-01',
    effectiveTo: null,
    ...overrides,
  } as WriteAutomationRuleDto;
}

function rule(): AutomationRule {
  return new AutomationRule(
    'rule-1',
    'Label and tell',
    'order.packed',
    {},
    [],
    [LABEL_STEP] as never,
    'hash',
    true,
    new Date('2026-09-01'),
    null,
    null,
    null,
    new Date('2026-08-01'),
    new Date('2026-08-01')
  );
}

describe('AutomationsController', () => {
  let rules: jest.Mocked<IAutomationRulesService>;
  let runs: jest.Mocked<IAutomationRunsReadService>;
  let dryRun: jest.Mocked<IAutomationDryRunService>;
  let controller: AutomationsController;

  beforeEach(() => {
    rules = {
      createRule: jest.fn().mockResolvedValue(rule()),
      updateRule: jest.fn().mockResolvedValue(rule()),
      getRule: jest.fn().mockResolvedValue(rule()),
      listRulesByTrigger: jest.fn().mockResolvedValue([rule()]),
      countRulesByTrigger: jest.fn().mockResolvedValue(new Map([['order.packed', 3]])),
      deleteRule: jest.fn(),
      validateRule: jest.fn(),
      setMoneyAck: jest.fn(),
    } as unknown as jest.Mocked<IAutomationRulesService>;
    runs = {
      listRecentByRule: jest
        .fn()
        .mockResolvedValue({ runs: [], limit: 50, hasMore: false, recordingAvailable: false }),
      isRecordingPersisted: jest.fn().mockReturnValue(false),
      listRecentBySubject: jest
        .fn()
        .mockResolvedValue({ runs: [], limit: 50, hasMore: false, recordingAvailable: true }),
      listRecent: jest
        .fn()
        .mockResolvedValue({ runs: [], limit: 50, hasMore: false, recordingAvailable: true }),
      getRunById: jest.fn().mockResolvedValue(null),
    };
    dryRun = { evaluate: jest.fn() } as unknown as jest.Mocked<IAutomationDryRunService>;
    controller = new AutomationsController(rules, runs, dryRun);
  });

  describe('listRules', () => {
    it('should refuse an unrecognised trigger with a 400 naming the valid ones', async () => {
      await expect(controller.listRules('order.teleported')).rejects.toThrow(BadRequestException);
    });

    it('should list the rules on a recognised trigger', async () => {
      const listed = await controller.listRules('order.packed');
      expect(rules.listRulesByTrigger).toHaveBeenCalledWith('order.packed');
      expect(listed).toHaveLength(1);
    });
  });

  describe('getSummary', () => {
    it('should report every trigger, including those with no rules', async () => {
      // A trigger missing from the index reads as "not supported" rather than
      // "nothing configured", and only the second is actionable.
      const summary = await controller.getSummary();
      expect(summary).toHaveLength(8);
      expect(summary.find((row) => row.trigger === 'order.packed')?.ruleCount).toBe(3);
      expect(summary.find((row) => row.trigger === 'return.received')?.ruleCount).toBe(0);
    });
  });

  describe('the money acknowledgement', () => {
    it('should refuse to ARM an irreversible rule without one, naming the actions', async () => {
      await expect(
        controller.createRule(body({ actions: [LABEL_STEP], isActive: true }), USER)
      ).rejects.toThrow(/dispatch-shipment/);
      expect(rules.createRule).not.toHaveBeenCalled();
    });

    it('should accept an irreversible rule that is armed WITH one, attributing the token user', async () => {
      await controller.createRule(
        body({ actions: [LABEL_STEP], isActive: true, moneyAcknowledged: true }),
        USER
      );
      expect(rules.createRule).toHaveBeenCalledWith(expect.anything(), { byUserId: 'user-7' });
    });

    it('should not require one for an irreversible rule left DISARMED', async () => {
      // A rule that is not armed spends nothing.
      await controller.createRule(body({ actions: [LABEL_STEP] }), USER);
      expect(rules.createRule).toHaveBeenCalledWith(expect.anything(), null);
    });

    it('should not require one for a reversible rule', async () => {
      await controller.createRule(body({ isActive: true }), USER);
      expect(rules.createRule).toHaveBeenCalledWith(expect.anything(), null);
    });

    it('should ignore an acknowledgement on a rule that needs none', async () => {
      // Recording consent for a money act that is not being armed would put
      // evidence on the row for a decision nobody made.
      await controller.createRule(body({ isActive: true, moneyAcknowledged: true }), USER);
      expect(rules.createRule).toHaveBeenCalledWith(expect.anything(), null);
    });

    it('should apply the same rule on a replace', async () => {
      await expect(
        controller.replaceRule('rule-1', body({ actions: [LABEL_STEP], isActive: true }), USER)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('the fired log', () => {
    it('should 404 for an unknown rule rather than returning an empty log', async () => {
      // "This rule never fired" and "there is no such rule" are different answers.
      rules.getRule.mockResolvedValue(null);
      await expect(controller.listRunsForRule('nope')).rejects.toThrow(AutomationRuleNotFoundError);
    });

    it('should say the log is not recorded yet when it is not', async () => {
      const page = await controller.listRunsForRule('rule-1');
      expect(page.recordingAvailable).toBe(false);
      expect(page.note).toContain('not recorded in this build yet');
    });

    it('should omit the note once firings are persisted', async () => {
      runs.listRecentByRule.mockResolvedValue({
        runs: [],
        limit: 50,
        hasMore: false,
        recordingAvailable: true,
      });
      const page = await controller.listRunsForRule('rule-1');
      expect(page.note).toBeUndefined();
    });
  });

  describe('the vocabulary', () => {
    it('should report every trigger and action, with the 48-cell legality matrix', () => {
      const vocabulary = controller.getVocabulary();
      expect(vocabulary.triggers).toHaveLength(8);
      expect(vocabulary.actions).toHaveLength(6);
      const cells = Object.values(vocabulary.legalActions).flatMap((row) => Object.values(row));
      expect(cells).toHaveLength(48);
    });

    it('should report the five actions that cannot fully run in this build', () => {
      // The legality matrix says what MAY follow a trigger; it says nothing about
      // whether the operation ships. Presenting six ready actions is how an
      // operator arms one and learns the truth from a failed run.
      const vocabulary = controller.getVocabulary();
      const notReady = vocabulary.actions.filter((a) => a.availability !== 'available');
      expect(notReady.map((a) => a.action).sort()).toEqual([
        'dispatch-shipment',
        'issue-sales-document',
        'place-hold',
        'release-hold',
        'send-email',
      ]);
      expect(notReady.every((a) => typeof a.reason === 'string' && a.reason.length > 0)).toBe(true);
    });

    it('should mark the two irreversible actions as such', () => {
      const irreversible = controller
        .getVocabulary()
        .actions.filter((a) => a.irreversible)
        .map((a) => a.action);
      expect(irreversible).toEqual(['issue-sales-document', 'dispatch-shipment']);
    });
  });

  describe('rule responses', () => {
    it('should carry per-step availability so a saved rule is never presented as ready', async () => {
      // The write path deliberately ACCEPTS all six actions, so the response is
      // where an operator learns what the rule they just saved can actually do.
      const response = await controller.getRule('rule-1');
      expect(response.actionAvailability[0].availability).toBe('unavailable');
      expect(response.hasIrreversibleAction).toBe(true);
    });
  });
});

/**
 * The #2385 run-read routes.
 *
 * `/automations/runs` is ONE read serving both the activity list and an order's
 * timeline, which is what makes "one record, four readings" visibly true rather
 * than merely asserted.
 */
describe('AutomationsController — run reads (#2385)', () => {
  let rules: jest.Mocked<IAutomationRulesService>;
  let runs: jest.Mocked<IAutomationRunsReadService>;
  let dryRun: jest.Mocked<IAutomationDryRunService>;
  let controller: AutomationsController;

  beforeEach(() => {
    rules = {} as unknown as jest.Mocked<IAutomationRulesService>;
    runs = {
      listRecentByRule: jest.fn(),
      isRecordingPersisted: jest.fn().mockReturnValue(true),
      listRecentBySubject: jest
        .fn()
        .mockResolvedValue({ runs: [], limit: 50, hasMore: false, recordingAvailable: true }),
      listRecent: jest
        .fn()
        .mockResolvedValue({ runs: [], limit: 50, hasMore: false, recordingAvailable: true }),
      getRunById: jest.fn().mockResolvedValue(null),
    };
    dryRun = { evaluate: jest.fn() } as unknown as jest.Mocked<IAutomationDryRunService>;
    controller = new AutomationsController(rules, runs, dryRun);
  });

  it('should list every recent firing when no subject is given', async () => {
    await controller.listRunFeed(undefined, undefined, undefined, undefined);
    expect(runs.listRecent).toHaveBeenCalled();
    expect(runs.listRecentBySubject).not.toHaveBeenCalled();
  });

  it('should scope to one subject when both parts are given', async () => {
    await controller.listRunFeed('order', 'ol_order_1', undefined, undefined);
    expect(runs.listRecentBySubject).toHaveBeenCalledWith('order', 'ol_order_1', undefined);
    expect(runs.listRecent).not.toHaveBeenCalled();
  });

  it('should refuse a subjectId without a recognised subjectKind', async () => {
    // Silently ignoring the filter would answer a scoped question with every
    // firing in the system — a far worse answer than a 400.
    await expect(
      controller.listRunFeed(undefined, 'ol_order_1', undefined, undefined),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.listRunFeed('spaceship', 'ol_order_1', undefined, undefined),
    ).rejects.toThrow(BadRequestException);
    expect(runs.listRecent).not.toHaveBeenCalled();
  });

  it('should carry recordingAvailable on the activity listing too', async () => {
    // An empty activity list means "the write path is not built" and "nothing
    // fired" identically without it.
    const page = await controller.listRunFeed(undefined, undefined, undefined, undefined);
    expect(page.recordingAvailable).toBe(true);
  });

  it('should answer 404 for a run that does not exist', async () => {
    await expect(controller.getRun('missing')).rejects.toThrow(NotFoundException);
  });
});
