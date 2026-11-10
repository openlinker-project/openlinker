import { Promotion } from '../../entities/promotion.entity';
import type { PromotionContext, PromotionOutcome } from '../../types/promotion-application.types';
import type { FreeGiftBenefit } from '../../types/promotion-benefit.types';
import type { PromotionCondition } from '../../types/promotion-condition.types';
import type { PromotionPlanLine } from '../../types/promotion-facts.types';
import { evaluatePromotions } from '../evaluate-promotions';
import { planPromotions, sortPromotions } from '../plan-promotions';

const CREATED = new Date('2026-11-01T00:00:00.000Z');
const PLACED = new Date('2026-11-02T10:00:00.000Z');
const NOW = new Date('2026-11-02T10:05:00.000Z');

interface PromotionOptions {
  conditions?: PromotionCondition[];
  position?: number;
  createdAt?: Date;
  combinable?: boolean;
  unitCap?: number | null;
  customerLimit?: number | null;
}

function gift(overrides: Partial<FreeGiftBenefit> = {}): FreeGiftBenefit {
  return {
    kind: 'free-gift',
    productId: 'p-gift',
    variantId: 'v-gift',
    quantity: 1,
    perUnit: null,
    skipIfPresent: true,
    ...overrides,
  };
}

function promotion(id: string, benefit: FreeGiftBenefit, options: PromotionOptions = {}): Promotion {
  return new Promotion(
    id,
    `Promotion ${id}`,
    true,
    options.position ?? 1,
    CREATED,
    null,
    options.conditions ?? [],
    benefit,
    options.combinable ?? true,
    { unitCap: options.unitCap ?? null, customerLimit: options.customerLimit ?? null },
    `hash-${id}`,
    options.createdAt ?? CREATED,
    CREATED
  );
}

const LINES: PromotionPlanLine[] = [
  { productId: 'p-book', variantId: 'v-book', quantity: 2, isGift: false },
];

const OK_CONTEXT: PromotionContext = {
  state: null,
  unitsGiven: 0,
  customerUnits: 0,
  stock: { kind: 'known', available: 50 },
};

function plan(
  promotions: Promotion[],
  contexts: Record<string, Partial<PromotionContext>> = {},
  extra: { lines?: PromotionPlanLine[]; already?: string[]; components?: string[] } = {}
): PromotionOutcome[] {
  const ordered = sortPromotions(promotions);
  const lines = extra.lines ?? LINES;
  const evaluation = evaluatePromotions({
    promotions: ordered,
    facts: {
      orderId: 'ol_order_1',
      occurredAt: PLACED,
      sourceConnectionId: 'c1',
      totalGross: 100,
      currency: 'PLN',
      lineProductIds: lines.map((l) => l.productId),
      lineVariantIds: lines.flatMap((l) => (l.variantId ? [l.variantId] : [])),
    },
    now: NOW,
  });
  return planPromotions({
    promotions: ordered,
    evaluations: evaluation.evaluations,
    alreadyAppliedPromotionIds: new Set(extra.already ?? []),
    lines,
    ...(extra.components !== undefined && { componentProductIds: new Set(extra.components) }),
    contexts: new Map(
      ordered.map((p) => [p.id, { ...OK_CONTEXT, ...(contexts[p.id] ?? {}) }] as const)
    ),
  });
}

describe('sortPromotions', () => {
  it('should order by position, then by creation time', () => {
    const a = promotion('a', gift(), { position: 2 });
    const b = promotion('b', gift(), { position: 1 });
    const c = promotion('c', gift(), { position: 3, createdAt: new Date('2026-11-01T02:00:00Z') });
    const d = promotion('d', gift(), { position: 3, createdAt: new Date('2026-11-01T01:00:00Z') });
    expect(sortPromotions([a, c, d, b]).map((p) => p.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('planPromotions', () => {
  it('should give the gift when the promotion matches and nothing stops it', () => {
    const [outcome] = plan([promotion('p1', gift({ quantity: 2 }))]);
    expect(outcome).toMatchObject({ applied: true, quantity: 2, reason: null });
  });

  it('should report the evaluator reason when a condition is not met', () => {
    const [outcome] = plan([
      promotion('p1', gift(), {
        conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '500', currency: 'PLN' }],
      }),
    ]);
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'rule-not-matching',
      nonFiringReason: 'condition-not-met',
    });
  });

  it('should never apply a promotion to an order placed before it was saved', () => {
    const late = promotion('p1', gift(), { createdAt: new Date('2026-11-03T00:00:00Z') });
    const [outcome] = plan([late]);
    expect(outcome).toMatchObject({ applied: false, nonFiringReason: 'fact-precedes-rule' });
  });

  it('should apply only the first non-combinable promotion that applies', () => {
    const first = promotion('p1', gift(), { combinable: false, position: 1 });
    const second = promotion('p2', gift({ productId: 'p-b', variantId: 'v-b' }), { position: 2 });
    const outcomes = plan([first, second]);
    expect(outcomes[0].applied).toBe(true);
    expect(outcomes[1]).toMatchObject({
      applied: false,
      reason: 'superseded-by-earlier-rule',
      supersededByPromotionId: 'p1',
    });
  });

  it('should let a lower promotion substitute when a non-combinable one could not give its gift', () => {
    const first = promotion('p1', gift(), { combinable: false, position: 1 });
    const second = promotion('p2', gift({ productId: 'p-b', variantId: 'v-b' }), { position: 2 });
    const outcomes = plan([first, second], { p1: { stock: { kind: 'known', available: 0 } } });
    expect(outcomes[0]).toMatchObject({ applied: false, reason: 'gift-out-of-stock' });
    expect(outcomes[1].applied).toBe(true);
  });

  it('should let every matching promotion fire when all are combinable', () => {
    const outcomes = plan([
      promotion('p1', gift(), { position: 1 }),
      promotion('p2', gift({ productId: 'p-b', variantId: 'v-b' }), { position: 2 }),
    ]);
    expect(outcomes.map((o) => o.applied)).toEqual([true, true]);
  });

  it('should treat an already-applied non-combinable promotion as still stopping those below', () => {
    const first = promotion('p1', gift(), { combinable: false, position: 1 });
    const second = promotion('p2', gift({ productId: 'p-b', variantId: 'v-b' }), { position: 2 });
    const outcomes = plan([first, second], {}, { already: ['p1'] });
    expect(outcomes[0]).toMatchObject({ applied: true, alreadyApplied: true });
    expect(outcomes[1].reason).toBe('superseded-by-earlier-rule');
  });

  it('should skip the gift when its product is already in the order', () => {
    const [outcome] = plan([promotion('p1', gift())], {}, {
      lines: [...LINES, { productId: 'p-gift', variantId: 'v-gift', quantity: 1, isGift: false }],
    });
    expect(outcome).toMatchObject({ applied: false, reason: 'gift-already-in-order' });
  });

  it('should skip the gift when a set in the order already contains its product', () => {
    const [outcome] = plan([promotion('p1', gift())], {}, { components: ['p-gift', 'p-other'] });
    expect(outcome).toMatchObject({ applied: false, reason: 'gift-already-in-order' });
  });

  it('should give the gift when the order sets do not contain its product', () => {
    const [outcome] = plan([promotion('p1', gift())], {}, { components: ['p-other'] });
    expect(outcome.applied).toBe(true);
  });

  it('should ignore an existing gift line when checking skip-if-present', () => {
    const [outcome] = plan([promotion('p1', gift())], {}, {
      lines: [...LINES, { productId: 'p-gift', variantId: 'v-gift', quantity: 1, isGift: true }],
    });
    expect(outcome.applied).toBe(true);
  });

  it('should give one gift batch per N units up to the per-order maximum', () => {
    const perUnit = { productId: 'p-book', per: 2, maxPerOrder: 2 };
    const lines: PromotionPlanLine[] = [{ productId: 'p-book', quantity: 9, isGift: false }];
    const [outcome] = plan([promotion('p1', gift({ quantity: 3, perUnit }))], {}, { lines });
    expect(outcome).toMatchObject({ applied: true, quantity: 6 });
  });

  it('should name the threshold when there are too few units for one batch', () => {
    const perUnit = { productId: 'p-book', per: 3, maxPerOrder: null };
    const [outcome] = plan([promotion('p1', gift({ perUnit }))]);
    expect(outcome).toMatchObject({ applied: false, reason: 'below-per-unit-threshold' });
  });

  it('should pause when the unit cap would be exceeded', () => {
    const [outcome] = plan([promotion('p1', gift(), { unitCap: 10 })], { p1: { unitsGiven: 10 } });
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'unit-cap-reached',
      stateChange: { kind: 'pause', reason: 'unit-cap' },
    });
  });

  it('should pause right after the gift that reaches the cap', () => {
    const [outcome] = plan([promotion('p1', gift(), { unitCap: 10 })], { p1: { unitsGiven: 9 } });
    expect(outcome).toMatchObject({
      applied: true,
      quantity: 1,
      stateChange: { kind: 'pause', reason: 'unit-cap' },
    });
  });

  it('should count units added by resuming toward the cap', () => {
    const state = { promotionId: 'p1', pausedReason: null, pausedAt: null, capExtension: 5 };
    const [outcome] = plan([promotion('p1', gift(), { unitCap: 10 })], {
      p1: { unitsGiven: 10, state },
    });
    expect(outcome.applied).toBe(true);
  });

  it('should refuse while paused at the cap, until an explicit resume', () => {
    const state = { promotionId: 'p1', pausedReason: 'unit-cap' as const, pausedAt: NOW, capExtension: 0 };
    const [outcome] = plan([promotion('p1', gift(), { unitCap: 10 })], { p1: { state } });
    expect(outcome).toMatchObject({ applied: false, reason: 'paused-unit-cap' });
  });

  it('should pause for stock when the gift is out of stock', () => {
    const [outcome] = plan([promotion('p1', gift())], { p1: { stock: { kind: 'known', available: 0 } } });
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'gift-out-of-stock',
      stateChange: { kind: 'pause', reason: 'gift-out-of-stock' },
    });
  });

  it('should resume by itself when stock returns', () => {
    const state = {
      promotionId: 'p1',
      pausedReason: 'gift-out-of-stock' as const,
      pausedAt: NOW,
      capExtension: 0,
    };
    const [outcome] = plan([promotion('p1', gift())], { p1: { state } });
    expect(outcome).toMatchObject({ applied: true, stateChange: { kind: 'clear-stock-pause' } });
  });

  it('should never read an unknown stock as zero or as plenty', () => {
    const [outcome] = plan([promotion('p1', gift())], { p1: { stock: { kind: 'unknown' } } });
    expect(outcome).toMatchObject({ applied: false, reason: 'gift-stock-unknown', stateChange: null });
  });

  it('should refuse when the customer limit would be exceeded', () => {
    const [outcome] = plan([promotion('p1', gift(), { customerLimit: 1 })], { p1: { customerUnits: 1 } });
    expect(outcome).toMatchObject({ applied: false, reason: 'customer-limit-reached' });
  });

  it('should not guess a customer limit when no customer was resolved', () => {
    const [outcome] = plan([promotion('p1', gift(), { customerLimit: 1 })], {
      p1: { customerUnits: null },
    });
    expect(outcome).toMatchObject({ applied: false, reason: 'customer-unknown' });
  });

  it('should leave a promotion that already gave its gift alone', () => {
    const [outcome] = plan([promotion('p1', gift(), { unitCap: 1 })], { p1: { unitsGiven: 1 } }, {
      already: ['p1'],
    });
    expect(outcome).toMatchObject({ applied: true, alreadyApplied: true, stateChange: null });
  });
});
