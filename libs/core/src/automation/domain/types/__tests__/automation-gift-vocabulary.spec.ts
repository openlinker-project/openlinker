import { AutomationGiftDocumentFormValues, isAutomationAction } from '../automation-action.types';
import { isAutomationCondition } from '../automation-condition.types';
import { isLegalAutomationConditionField, isLegalAutomationPair } from '../automation-legality.types';
import { evaluateAutomationRules } from '../../domain-services/evaluate-automation-rules';
import { AutomationRule } from '../../entities/automation-rule.entity';

const GIFT = {
  action: 'add-gift',
  productId: 'p',
  variantId: 'v',
  quantity: 1,
  perUnit: null,
  unitCap: null,
  skipIfPresent: true,
  doNotCombine: false,
  customerLimit: null,
};

describe('add-gift action', () => {
  it('should accept a well-formed gift', () => {
    expect(isAutomationAction(GIFT)).toBe(true);
    expect(isAutomationAction({ ...GIFT, documentForm: 'technical-cent' })).toBe(true);
    expect(
      isAutomationAction({ ...GIFT, perUnit: { productId: 'x', per: 2, maxPerOrder: null } })
    ).toBe(true);
  });

  it.each([
    ['a non-positive quantity', { ...GIFT, quantity: 0 }],
    ['a fractional cap', { ...GIFT, unitCap: 1.5 }],
    ['a missing option', { ...GIFT, skipIfPresent: undefined }],
    ['an unknown document form', { ...GIFT, documentForm: 'free' }],
    ['a per-unit block without a product', { ...GIFT, perUnit: { per: 1, maxPerOrder: null } }],
  ])('should refuse %s', (_name, value) => {
    expect(isAutomationAction(value)).toBe(false);
  });

  it('should be legal only on the order.ingested trigger', () => {
    expect(isLegalAutomationPair('order.ingested', 'add-gift')).toBe(true);
    expect(isLegalAutomationPair('order.received', 'add-gift')).toBe(false);
    expect(isLegalAutomationPair('order.ingested', 'send-email')).toBe(false);
  });

  it('should offer the gift conditions on the gift trigger and nowhere else', () => {
    expect(isLegalAutomationConditionField('order.ingested', 'containsProduct')).toBe(true);
    expect(isLegalAutomationConditionField('order.packed', 'containsProduct')).toBe(false);
  });

  it('should carry the same document forms as the order line gift', () => {
    expect([...AutomationGiftDocumentFormValues]).toEqual([
      'technical-cent',
      'priced-in',
      'show-zero',
      'omit',
    ]);
  });
});

describe('gift conditions', () => {
  const rule = (conditions: unknown[]): AutomationRule =>
    new AutomationRule(
      'r',
      'r',
      'order.ingested',
      {},
      conditions.filter(isAutomationCondition),
      [GIFT as never],
      'h',
      true,
      new Date('2026-01-01'),
      null,
      null,
      null,
      new Date('2026-01-01'),
      new Date('2026-01-01')
    );
  const run = (conditions: unknown[], facts: object) =>
    evaluateAutomationRules({
      trigger: 'order.ingested',
      facts: {
        subjectKind: 'order',
        subjectId: 'o',
        occurredAt: new Date('2026-02-01'),
        ...facts,
      },
      rules: [rule(conditions)],
      now: new Date('2026-02-01'),
    }).evaluations[0];

  it('should match containsProduct on a product or a variant id', () => {
    const cond = [{ field: 'containsProduct', op: 'eq', value: 'p1' }];
    expect(run(cond, { lineProductIds: ['p1'], lineVariantIds: [] }).matches).toBe(true);
    expect(run(cond, { lineProductIds: [], lineVariantIds: ['p1'] }).matches).toBe(true);
    expect(run(cond, { lineProductIds: ['p2'], lineVariantIds: [] }).matches).toBe(false);
  });

  it('should read containsProduct as unknown when the lines were not asserted', () => {
    const result = run([{ field: 'containsProduct', op: 'eq', value: 'p1' }], {});
    expect(result.nonFiringReason).toBe('condition-fact-unknown');
  });

  it('should match sourceConnectionIn against the channel list', () => {
    const cond = [{ field: 'sourceConnectionIn', op: 'in', values: ['c1', 'c2'] }];
    expect(run(cond, { sourceConnectionId: 'c2' }).matches).toBe(true);
    expect(run(cond, { sourceConnectionId: 'c9' }).matches).toBe(false);
  });

  it('should refuse an empty channel list', () => {
    expect(isAutomationCondition({ field: 'sourceConnectionIn', op: 'in', values: [] })).toBe(false);
  });
});
