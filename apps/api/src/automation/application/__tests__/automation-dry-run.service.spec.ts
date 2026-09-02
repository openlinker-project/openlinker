/**
 * AutomationDryRunService specs (#2363, Wave-2 spec §5.6a)
 *
 * The three properties the dry run is worth having for: it writes nothing, it
 * sees a collision the subject alone could not, and it tells the truth about the
 * retroactivity floor instead of quietly differing from what would really fire.
 *
 * @module apps/api/src/automation/application/__tests__
 */
import { NotFoundException } from '@nestjs/common';
import { AutomationRule, type IAutomationRulesService } from '@openlinker/core/automation';
import type { IOrderRecordService } from '@openlinker/core/orders';
import { OrderRecord } from '@openlinker/core/orders';

import { AutomationDryRunService } from '../automation-dry-run.service';
import { AUTOMATION_DRAFT_RULE_ID } from '../automation-dry-run.service.interface';

const LABEL_STEP = {
  action: 'dispatch-shipment' as const,
  carrierId: 'dpd',
  serviceId: null,
  packagePresetId: null,
  cashOnDelivery: false,
};
const EMAIL_STEP = {
  action: 'send-email' as const,
  recipient: { kind: 'buyer' as const },
  subject: 'Packed',
  body: 'Your order is on its way.',
};

/** A real entity instance — it carries a method, so a literal is not a stand-in. */
function rule(
  id: string,
  overrides: {
    actions?: readonly (typeof LABEL_STEP | typeof EMAIL_STEP)[];
    conditions?: readonly { field: string; op: string; value: string }[];
    isActive?: boolean;
    createdAt?: Date;
  } = {}
): AutomationRule {
  return new AutomationRule(
    id,
    `Rule ${id}`,
    'order.packed',
    {},
    (overrides.conditions ?? []) as never,
    (overrides.actions ?? [EMAIL_STEP]) as never,
    `hash-${id}`,
    overrides.isActive ?? true,
    new Date('2026-01-01'),
    null,
    null,
    null,
    overrides.createdAt ?? new Date('2026-01-01'),
    new Date('2026-01-01')
  );
}

function order(overrides: { placedAt?: Date | null; country?: string } = {}): OrderRecord {
  const record = new OrderRecord(
    'ol_order_1',
    null,
    'conn-1',
    null,
    { shippingAddress: { countryIso2: overrides.country ?? 'PL' } },
    [],
    'ready',
    new Date('2026-06-01'),
    new Date('2026-06-01')
  );
  return Object.assign(Object.create(Object.getPrototypeOf(record) as object) as OrderRecord, record, {
    placedAt: overrides.placedAt === undefined ? new Date('2026-06-01') : overrides.placedAt,
    currency: 'PLN',
    totalAmount: 250,
  }) as OrderRecord;
}

describe('AutomationDryRunService', () => {
  let rules: jest.Mocked<IAutomationRulesService>;
  let orders: jest.Mocked<IOrderRecordService>;
  let service: AutomationDryRunService;

  beforeEach(() => {
    rules = {
      createRule: jest.fn(),
      updateRule: jest.fn(),
      getRule: jest.fn(),
      listRulesByTrigger: jest.fn().mockResolvedValue([]),
      countRulesByTrigger: jest.fn(),
      deleteRule: jest.fn(),
      validateRule: jest.fn(),
      setMoneyAck: jest.fn(),
    } as unknown as jest.Mocked<IAutomationRulesService>;
    orders = {
      getOrderRecord: jest.fn().mockResolvedValue(order()),
    } as unknown as jest.Mocked<IOrderRecordService>;
    service = new AutomationDryRunService(rules, orders);
  });

  it('should write nothing when previewing a saved rule', async () => {
    const subject = rule('rule-1');
    rules.getRule.mockResolvedValue(subject);
    rules.listRulesByTrigger.mockResolvedValue([subject]);

    await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-1' });

    // Nothing that could persist is even reachable from this service — these
    // assertions pin that the reachable surface stays read-only.
    expect(rules.createRule).not.toHaveBeenCalled();
    expect(rules.updateRule).not.toHaveBeenCalled();
    expect(rules.setMoneyAck).not.toHaveBeenCalled();
    expect(rules.deleteRule).not.toHaveBeenCalled();
  });

  it('should validate a draft without persisting it', async () => {
    const draft = {
      name: 'Draft',
      trigger: 'order.packed' as const,
      triggerConfig: {},
      conditions: [],
      actions: [EMAIL_STEP],
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: null,
      isActive: true,
    };
    rules.validateRule.mockReturnValue({
      ...draft,
      definitionHash: 'draft-hash',
      isActive: true,
    } as never);

    const result = await service.evaluate({ orderId: 'ol_order_1', draft });

    expect(rules.validateRule).toHaveBeenCalledWith(draft);
    expect(rules.createRule).not.toHaveBeenCalled();
    expect(result.verdicts.find((v) => v.isSubject)?.ruleId).toBe(AUTOMATION_DRAFT_RULE_ID);
  });

  it('should waive the retroactivity floor and report the waiver', async () => {
    // The rule was saved AFTER the order was placed. Enforced, the floor would
    // report `fact-precedes-rule` and the operator would learn nothing about
    // their conditions.
    const subject = rule('rule-1', { createdAt: new Date('2026-07-01') });
    rules.getRule.mockResolvedValue(subject);
    rules.listRulesByTrigger.mockResolvedValue([subject]);

    const result = await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-1' });
    const verdict = result.verdicts[0];

    expect(verdict.matches).toBe(true);
    // …and it says so, rather than presenting a match that would not have fired.
    expect(verdict.retroactivityFloorWaived).toBe(true);
  });

  it('should report a rule that is switched off rather than hiding it', async () => {
    const subject = rule('rule-1', { isActive: false });
    rules.getRule.mockResolvedValue(subject);
    rules.listRulesByTrigger.mockResolvedValue([subject]);

    const verdict = (await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-1' }))
      .verdicts[0];

    expect(verdict.matches).toBe(false);
    expect(verdict.nonFiringReason).toBe('rule-inactive');
    expect(verdict.isActive).toBe(false);
  });

  it('should surface a two-money-rules collision, naming the colliding rules and actions', async () => {
    // The S3-3 scenario, and the reason the dry run evaluates every SIBLING and
    // not only the subject: a collision is a fact about a set.
    const a = rule('rule-a', { actions: [LABEL_STEP] });
    const b = rule('rule-b', { actions: [LABEL_STEP] });
    rules.getRule.mockResolvedValue(a);
    rules.listRulesByTrigger.mockResolvedValue([a, b]);

    const result = await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-a' });
    const subject = result.verdicts.find((v) => v.ruleId === 'rule-a');

    expect(subject?.matches).toBe(true);
    // Matched, and still refused. `wouldFire` is the sentence an operator arms on.
    expect(subject?.wouldFire).toBe(false);
    expect(subject?.blockedBy?.collidingRuleIds).toEqual(['rule-a', 'rule-b']);
    expect(subject?.blockedBy?.actions).toEqual(['dispatch-shipment']);
  });

  it('should not report a collision between two reversible rules', async () => {
    // Two emails are recoverable; two labels are not.
    const a = rule('rule-a', { actions: [EMAIL_STEP] });
    const b = rule('rule-b', { actions: [EMAIL_STEP] });
    rules.getRule.mockResolvedValue(a);
    rules.listRulesByTrigger.mockResolvedValue([a, b]);

    const result = await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-a' });

    expect(result.verdicts.every((v) => v.wouldFire)).toBe(true);
  });

  it('should report an unknown fact as unknown, not as a non-match', async () => {
    orders.getOrderRecord.mockResolvedValue(
      Object.assign(order(), { orderSnapshot: {} }) as OrderRecord
    );
    const subject = rule('rule-1', {
      conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }],
    });
    rules.getRule.mockResolvedValue(subject);
    rules.listRulesByTrigger.mockResolvedValue([subject]);

    const verdict = (await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-1' }))
      .verdicts[0];

    expect(verdict.conditionTraces[0].outcome).toBe('unknown');
    expect(verdict.nonFiringReason).toBe('condition-fact-unknown');
  });

  it('should report per-step availability so a green verdict never implies a step that cannot run', async () => {
    const subject = rule('rule-1', { actions: [LABEL_STEP] });
    rules.getRule.mockResolvedValue(subject);
    rules.listRulesByTrigger.mockResolvedValue([subject]);

    const verdict = (await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-1' }))
      .verdicts[0];

    expect(verdict.stepAvailability[0].availability).toBe('unavailable');
    expect(verdict.stepAvailability[0].reason).toContain('package presets');
  });

  it('should project only the evaluator facts — never the order snapshot', async () => {
    const subject = rule('rule-1');
    rules.getRule.mockResolvedValue(subject);
    rules.listRulesByTrigger.mockResolvedValue([subject]);

    const result = await service.evaluate({ orderId: 'ol_order_1', ruleId: 'rule-1' });

    // A diagnostics endpoint must not become a PII read under `OL_STORE_PII=true`.
    expect(Object.keys(result.facts).sort()).toEqual([
      'country',
      'currency',
      'occurredAt',
      'sourceConnectionId',
      'subjectId',
      'subjectKind',
      'totalGross',
    ]);
  });

  it('should 404 for an unknown order', async () => {
    orders.getOrderRecord.mockResolvedValue(null);
    await expect(service.evaluate({ orderId: 'nope', ruleId: 'rule-1' })).rejects.toThrow(
      NotFoundException
    );
  });

  it('should 404 for an unknown rule', async () => {
    rules.getRule.mockResolvedValue(null);
    await expect(service.evaluate({ orderId: 'ol_order_1', ruleId: 'nope' })).rejects.toThrow(
      NotFoundException
    );
  });
});
