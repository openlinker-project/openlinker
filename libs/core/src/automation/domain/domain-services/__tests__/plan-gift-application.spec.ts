import { AutomationRule } from '../../entities/automation-rule.entity';
import type { AutomationGiftAction } from '../../types/automation-action.types';
import type { AutomationCondition } from '../../types/automation-condition.types';
import type { GiftPlanLine, GiftRuleContext } from '../../types/gift-rule.types';
import { evaluateAutomationRules } from '../evaluate-automation-rules';
import { planGiftApplication, sortGiftRules } from '../plan-gift-application';

const CREATED = new Date('2026-11-01T00:00:00.000Z');
const PLACED = new Date('2026-11-02T10:00:00.000Z');
const NOW = new Date('2026-11-02T10:05:00.000Z');

function giftAction(overrides: Partial<AutomationGiftAction> = {}): AutomationGiftAction {
  return {
    action: 'add-gift',
    productId: 'p-gift',
    variantId: 'v-gift',
    quantity: 1,
    perUnit: null,
    unitCap: null,
    skipIfPresent: true,
    doNotCombine: false,
    customerLimit: null,
    ...overrides,
  };
}

function rule(
  id: string,
  action: AutomationGiftAction,
  options: { conditions?: AutomationCondition[]; position?: number | null; createdAt?: Date } = {}
): AutomationRule {
  return new AutomationRule(
    id,
    `Rule ${id}`,
    'order.ingested',
    {},
    options.conditions ?? [],
    [action],
    `hash-${id}`,
    true,
    CREATED,
    null,
    null,
    null,
    options.createdAt ?? CREATED,
    CREATED,
    options.position ?? null
  );
}

const LINES: GiftPlanLine[] = [{ productId: 'p-book', variantId: 'v-book', quantity: 2, isGift: false }];

const OK_CONTEXT: GiftRuleContext = {
  state: null,
  unitsGiven: 0,
  customerUnits: 0,
  stock: { kind: 'known', available: 50 },
};

function plan(
  rules: AutomationRule[],
  contexts: Record<string, Partial<GiftRuleContext>> = {},
  extra: { lines?: GiftPlanLine[]; already?: string[]; components?: string[] } = {}
) {
  const ordered = sortGiftRules(rules);
  const evaluation = evaluateAutomationRules({
    trigger: 'order.ingested',
    facts: {
      subjectKind: 'order',
      subjectId: 'ol_order_1',
      occurredAt: PLACED,
      sourceConnectionId: 'c1',
      totalGross: 100,
      currency: 'PLN',
      lineProductIds: (extra.lines ?? LINES).map((l) => l.productId),
      lineVariantIds: (extra.lines ?? LINES).flatMap((l) => (l.variantId ? [l.variantId] : [])),
    },
    rules: ordered,
    now: NOW,
  });
  return planGiftApplication({
    rules: ordered,
    evaluations: evaluation.evaluations,
    alreadyAppliedRuleIds: new Set(extra.already ?? []),
    lines: extra.lines ?? LINES,
    ...(extra.components !== undefined && { componentProductIds: new Set(extra.components) }),
    contexts: new Map(
      ordered.map((r) => [r.id, { ...OK_CONTEXT, ...(contexts[r.id] ?? {}) }] as const)
    ),
  });
}

describe('sortGiftRules', () => {
  it('should put positioned rules first by position, then the rest by creation time', () => {
    const a = rule('a', giftAction(), { position: 2 });
    const b = rule('b', giftAction(), { position: 1 });
    const c = rule('c', giftAction(), { createdAt: new Date('2026-11-01T02:00:00Z') });
    const d = rule('d', giftAction(), { createdAt: new Date('2026-11-01T01:00:00Z') });
    expect(sortGiftRules([a, c, d, b]).map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('planGiftApplication', () => {
  it('should add the gift when the rule matches and nothing stops it', () => {
    const [outcome] = plan([rule('r1', giftAction({ quantity: 2 }))]);
    expect(outcome).toMatchObject({ applied: true, quantity: 2, reason: null });
  });

  it('should report the evaluator reason when a condition is not met', () => {
    const [outcome] = plan([
      rule('r1', giftAction(), {
        conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '500', currency: 'PLN' }],
      }),
    ]);
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'rule-not-matching',
      nonFiringReason: 'condition-not-met',
    });
  });

  it('should never apply a rule to an order placed before the rule was saved', () => {
    const late = rule('r1', giftAction(), { createdAt: new Date('2026-11-03T00:00:00Z') });
    const [outcome] = plan([late]);
    expect(outcome).toMatchObject({ applied: false, nonFiringReason: 'fact-precedes-rule' });
  });

  it('should apply only the first non-combinable rule that applies', () => {
    const first = rule('r1', giftAction({ doNotCombine: true }), { position: 1 });
    const second = rule('r2', giftAction({ productId: 'p-b', variantId: 'v-b' }), { position: 2 });
    const outcomes = plan([first, second]);
    expect(outcomes[0].applied).toBe(true);
    expect(outcomes[1]).toMatchObject({
      applied: false,
      reason: 'superseded-by-earlier-rule',
      supersededByRuleId: 'r1',
    });
  });

  it('should let a lower rule substitute when a non-combinable rule could not give its gift', () => {
    const first = rule('r1', giftAction({ doNotCombine: true }), { position: 1 });
    const second = rule('r2', giftAction({ productId: 'p-b', variantId: 'v-b' }), { position: 2 });
    const outcomes = plan([first, second], {
      r1: { stock: { kind: 'known', available: 0 } },
    });
    expect(outcomes[0]).toMatchObject({ applied: false, reason: 'gift-out-of-stock' });
    expect(outcomes[1].applied).toBe(true);
  });

  it('should let every matching rule fire when none is non-combinable', () => {
    const outcomes = plan([
      rule('r1', giftAction(), { position: 1 }),
      rule('r2', giftAction({ productId: 'p-b', variantId: 'v-b' }), { position: 2 }),
    ]);
    expect(outcomes.map((o) => o.applied)).toEqual([true, true]);
  });

  it('should treat an already-applied non-combinable rule as still stopping the rules below', () => {
    const first = rule('r1', giftAction({ doNotCombine: true }), { position: 1 });
    const second = rule('r2', giftAction({ productId: 'p-b', variantId: 'v-b' }), { position: 2 });
    const outcomes = plan([first, second], {}, { already: ['r1'] });
    expect(outcomes[0]).toMatchObject({ applied: true, alreadyApplied: true });
    expect(outcomes[1].reason).toBe('superseded-by-earlier-rule');
  });

  it('should skip the gift when its product is already in the order', () => {
    const [outcome] = plan([rule('r1', giftAction())], {}, {
      lines: [...LINES, { productId: 'p-gift', variantId: 'v-gift', quantity: 1, isGift: false }],
    });
    expect(outcome).toMatchObject({ applied: false, reason: 'gift-already-in-order' });
  });

  it('should skip the gift when a set in the order already contains its product (#3945)', () => {
    const [outcome] = plan([rule('r1', giftAction())], {}, { components: ['p-gift', 'p-other'] });
    expect(outcome).toMatchObject({ applied: false, reason: 'gift-already-in-order' });
  });

  it('should add the gift when the order sets do not contain its product (#3945)', () => {
    const [outcome] = plan([rule('r1', giftAction())], {}, { components: ['p-other'] });
    expect(outcome.applied).toBe(true);
  });

  it('should ignore an existing gift line when checking skip-if-present', () => {
    const [outcome] = plan([rule('r1', giftAction())], {}, {
      lines: [...LINES, { productId: 'p-gift', variantId: 'v-gift', quantity: 1, isGift: true }],
    });
    expect(outcome.applied).toBe(true);
  });

  it('should give one gift batch per N units up to the per-order maximum', () => {
    const perUnit = { productId: 'p-book', per: 2, maxPerOrder: 2 };
    const lines: GiftPlanLine[] = [{ productId: 'p-book', quantity: 9, isGift: false }];
    const [outcome] = plan([rule('r1', giftAction({ quantity: 3, perUnit }))], {}, { lines });
    expect(outcome).toMatchObject({ applied: true, quantity: 6 });
  });

  it('should name the threshold when there are too few units for one batch', () => {
    const perUnit = { productId: 'p-book', per: 3, maxPerOrder: null };
    const [outcome] = plan([rule('r1', giftAction({ perUnit }))]);
    expect(outcome).toMatchObject({ applied: false, reason: 'below-per-unit-threshold' });
  });

  it('should pause the rule when the unit cap would be exceeded', () => {
    const [outcome] = plan([rule('r1', giftAction({ unitCap: 10 }))], { r1: { unitsGiven: 10 } });
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'unit-cap-reached',
      stateChange: { kind: 'pause', reason: 'unit-cap' },
    });
  });

  it('should pause the rule right after the gift that reaches the cap', () => {
    const [outcome] = plan([rule('r1', giftAction({ unitCap: 10 }))], { r1: { unitsGiven: 9 } });
    expect(outcome).toMatchObject({
      applied: true,
      quantity: 1,
      stateChange: { kind: 'pause', reason: 'unit-cap' },
    });
  });

  it('should count units added by resuming toward the cap', () => {
    const state = { ruleId: 'r1', pausedReason: null, pausedAt: null, capExtension: 5 };
    const [outcome] = plan([rule('r1', giftAction({ unitCap: 10 }))], {
      r1: { unitsGiven: 10, state },
    });
    expect(outcome.applied).toBe(true);
  });

  it('should refuse while paused at the cap, until an explicit resume', () => {
    const state = { ruleId: 'r1', pausedReason: 'unit-cap' as const, pausedAt: NOW, capExtension: 0 };
    const [outcome] = plan([rule('r1', giftAction({ unitCap: 10 }))], { r1: { state } });
    expect(outcome).toMatchObject({ applied: false, reason: 'paused-unit-cap' });
  });

  it('should pause for stock when the gift is out of stock and carry the order on', () => {
    const [outcome] = plan([rule('r1', giftAction())], {
      r1: { stock: { kind: 'known', available: 0 } },
    });
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'gift-out-of-stock',
      stateChange: { kind: 'pause', reason: 'gift-out-of-stock' },
    });
  });

  it('should resume by itself when stock returns', () => {
    const state = {
      ruleId: 'r1',
      pausedReason: 'gift-out-of-stock' as const,
      pausedAt: NOW,
      capExtension: 0,
    };
    const [outcome] = plan([rule('r1', giftAction())], { r1: { state } });
    expect(outcome).toMatchObject({ applied: true, stateChange: { kind: 'clear-stock-pause' } });
  });

  it('should never read an unknown stock as zero or as plenty', () => {
    const [outcome] = plan([rule('r1', giftAction())], { r1: { stock: { kind: 'unknown' } } });
    expect(outcome).toMatchObject({ applied: false, reason: 'gift-stock-unknown', stateChange: null });
  });

  it('should refuse when the customer limit would be exceeded', () => {
    const [outcome] = plan([rule('r1', giftAction({ customerLimit: 1 }))], {
      r1: { customerUnits: 1 },
    });
    expect(outcome).toMatchObject({ applied: false, reason: 'customer-limit-reached' });
  });

  it('should not guess a customer limit when no customer was resolved', () => {
    const [outcome] = plan([rule('r1', giftAction({ customerLimit: 1 }))], {
      r1: { customerUnits: null },
    });
    expect(outcome).toMatchObject({ applied: false, reason: 'customer-unknown' });
  });

  it('should leave a rule that already gave its gift alone', () => {
    const [outcome] = plan([rule('r1', giftAction({ unitCap: 1 }))], { r1: { unitsGiven: 1 } }, {
      already: ['r1'],
    });
    expect(outcome).toMatchObject({ applied: true, alreadyApplied: true, stateChange: null });
  });
});
