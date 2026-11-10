/**
 * PromotionsController specs (#3935)
 *
 * @module apps/api/src/promotions/http/__tests__
 */
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Promotion, type PromotionView } from '@openlinker/core/promotions';

import { EvaluatePromotionsDto, WritePromotionDto } from '../dto/promotion.dto';
import { PromotionsController } from '../promotions.controller';

const NOW = new Date('2026-11-05T00:00:00Z');

function promotion(id = 'p1'): Promotion {
  return new Promotion(
    id,
    'Free mug',
    true,
    1,
    new Date('2026-11-01'),
    null,
    [],
    {
      kind: 'free-gift',
      productId: 'p-gift',
      variantId: 'v-gift',
      quantity: 1,
      perUnit: null,
      skipIfPresent: true,
    },
    { mode: 'all' },
    { unitCap: 100, customerLimit: null },
    'hash',
    NOW,
    NOW
  );
}

function view(overrides: Partial<PromotionView> = {}): PromotionView {
  return { promotion: promotion(), state: null, unitsGiven: 3, effectiveCap: 100, ...overrides };
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Free mug',
    conditions: [{ field: 'containsProduct', op: 'eq', value: 'p-book' }],
    benefit: { kind: 'free-gift', productId: 'p-gift', variantId: 'v-gift', quantity: 1 },
    effectiveFrom: '2026-11-01',
    ...overrides,
  };
}

describe('PromotionsController', () => {
  let promotions: Record<string, jest.Mock>;
  let orderGifts: { previewForOrder: jest.Mock };
  let orders: { getOrderRecord: jest.Mock };
  let customers: { getProjection: jest.Mock };
  let applications: { findByPromotion: jest.Mock };
  let controller: PromotionsController;

  beforeEach(() => {
    promotions = {
      list: jest.fn().mockResolvedValue([view()]),
      get: jest.fn().mockResolvedValue(view()),
      create: jest.fn().mockResolvedValue(view()),
      update: jest.fn().mockResolvedValue(view()),
      delete: jest.fn().mockResolvedValue(undefined),
      reorder: jest.fn().mockResolvedValue([view()]),
      resumeAfterCap: jest.fn().mockResolvedValue(view()),
      buildDraft: jest.fn().mockReturnValue(promotion('draft')),
    };
    orderGifts = {
      previewForOrder: jest.fn().mockResolvedValue({ evaluatedAt: NOW, evaluations: [], outcomes: [] }),
    };
    orders = { getOrderRecord: jest.fn().mockResolvedValue({ internalOrderId: 'o1' }) };
    applications = {
      findByPromotion: jest.fn().mockResolvedValue([
        { id: 'a1', promotionId: 'p1', internalOrderId: 'o1', outcome: 'skipped', reason: 'customer-unknown', quantity: 0, createdAt: new Date('2026-01-02T00:00:00Z') },
        { id: 'a2', promotionId: 'p1', internalOrderId: 'o1', outcome: 'applied', reason: null, quantity: 1, createdAt: new Date('2026-01-03T00:00:00Z') },
      ]),
    };
    customers = { getProjection: jest.fn().mockResolvedValue({ internalCustomerId: 'ol_customer_1' }) };
    controller = new PromotionsController(
      promotions as never,
      orderGifts as never,
      orders as never,
      customers as never,
      applications as never
    );
  });

  it('should return the newest applications first with the order number', async () => {
    orders.getOrderRecord.mockResolvedValue({ internalOrderId: 'o1', orderNumber: 'AL-1' });

    const result = await controller.history('p1');

    expect(result.items.map((i) => [i.id, i.orderNumber, i.reasonCode])).toEqual([
      ['a2', 'AL-1', null],
      ['a1', 'AL-1', 'customer-unknown'],
    ]);
  });

  it('should list promotions with their ledger view and a derived status', async () => {
    const [row] = await controller.list();

    expect(row).toMatchObject({
      id: 'p1',
      benefit: { kind: 'free-gift' },
      combinesWith: { mode: 'all' },
      limits: { unitCap: 100, customerLimit: null },
      unitsGiven: 3,
      effectiveCap: 100,
    });
    expect(['active', 'scheduled', 'ended']).toContain(row.status);
  });

  it('should report a paused promotion with its reason', async () => {
    promotions.list.mockResolvedValue([
      view({ state: { promotionId: 'p1', pausedReason: 'unit-cap', pausedAt: NOW, capExtension: 0 } }),
    ]);

    const [row] = await controller.list();

    expect(row.pausedReason).toBe('unit-cap');
  });

  it('should pass the reorder list through and return the new list', async () => {
    const result = await controller.reorder({ promotionIds: ['p1'] });

    expect(promotions.reorder).toHaveBeenCalledWith(['p1']);
    expect(result).toHaveLength(1);
  });

  it('should answer 404 for a dry run against an unknown order', async () => {
    orders.getOrderRecord.mockResolvedValue(null);

    await expect(controller.evaluate({ orderId: 'nope' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should evaluate an unsaved draft beside the saved promotions and mark it as the subject', async () => {
    orderGifts.previewForOrder.mockResolvedValue({
      evaluatedAt: NOW,
      evaluations: [],
      outcomes: [
        {
          promotionId: 'draft',
          promotionName: 'Free mug',
          applied: false,
          alreadyApplied: false,
          quantity: 0,
          reason: 'gift-out-of-stock',
          nonFiringReason: null,
          supersededByPromotionId: null,
          stateChange: null,
        },
      ],
    });
    const dto = plainToInstance(WritePromotionDto, body());

    const result = await controller.evaluate({ orderId: 'o1', promotion: dto });

    expect(promotions.buildDraft).toHaveBeenCalled();
    expect(result.verdicts[0]).toMatchObject({ promotionId: 'draft', isSubject: true, wouldApply: false });
  });

  it('should report a promotion the ledger already granted as already-granted, not as one it would add', async () => {
    orderGifts.previewForOrder.mockResolvedValue({
      evaluatedAt: NOW,
      evaluations: [],
      outcomes: [
        {
          promotionId: 'p1',
          promotionName: 'Free mug',
          applied: true,
          alreadyApplied: true,
          quantity: 0,
          reason: null,
          nonFiringReason: null,
          supersededByPromotionId: null,
          stateChange: null,
        },
      ],
    });

    const result = await controller.evaluate({ orderId: 'o1', promotionId: 'p1' });

    expect(result.verdicts[0]).toMatchObject({ wouldApply: false, reason: 'already-granted' });
  });

  it('should answer 404 for a dry run with an unknown customer and preview nothing', async () => {
    customers.getProjection.mockResolvedValue(null);

    await expect(controller.evaluate({ orderId: 'o1', customerId: 'ghost' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(orderGifts.previewForOrder).not.toHaveBeenCalled();
  });

  it('should count the customer limit for the chosen customer and report it per verdict', async () => {
    orderGifts.previewForOrder.mockResolvedValue({
      evaluatedAt: NOW,
      evaluations: [],
      customerLimits: new Map([['p1', { limit: 2, usedByCustomer: 2 }]]),
      outcomes: [
        {
          promotionId: 'p1',
          promotionName: 'Free mug',
          applied: false,
          alreadyApplied: false,
          quantity: 0,
          reason: 'customer-limit-reached',
          nonFiringReason: null,
          supersededByPromotionId: null,
          stateChange: null,
        },
        {
          promotionId: 'p2',
          promotionName: 'No limit',
          applied: true,
          alreadyApplied: false,
          quantity: 1,
          reason: null,
          nonFiringReason: null,
          supersededByPromotionId: null,
          stateChange: null,
        },
      ],
    });

    const result = await controller.evaluate({ orderId: 'o1', customerId: 'ol_customer_1' });

    expect(orderGifts.previewForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'ol_customer_1' })
    );
    expect(result.verdicts[0].customerLimit).toEqual({ limit: 2, usedByCustomer: 2, wouldExceed: true });
    expect(result.verdicts[1].customerLimit).toBeNull();
  });

  it('should leave the order customer in charge when no customer is chosen', async () => {
    await controller.evaluate({ orderId: 'o1' });

    expect(orderGifts.previewForOrder).toHaveBeenCalledWith(
      expect.not.objectContaining({ customerId: expect.anything() })
    );
    expect(customers.getProjection).not.toHaveBeenCalled();
  });

  it('should delete through the service', async () => {
    await controller.remove('p1');

    expect(promotions.delete).toHaveBeenCalledWith('p1');
  });
});

describe('WritePromotionDto', () => {
  it('should accept a free-gift benefit and build the benefit with defaults', async () => {
    const dto = plainToInstance(WritePromotionDto, body());

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.toInput().benefit).toEqual({
      kind: 'free-gift',
      productId: 'p-gift',
      variantId: 'v-gift',
      quantity: 1,
      perUnit: null,
      skipIfPresent: true,
    });
    expect(dto.toInput().limits).toEqual({ unitCap: null, customerLimit: null });
  });

  it.each([
    ['an unknown benefit kind', { benefit: { kind: 'percent-off', quantity: 1 } }],
    ['a gift without a variant', { benefit: { kind: 'free-gift', productId: 'p', quantity: 1 } }],
    ['a non-positive quantity', { benefit: { kind: 'free-gift', productId: 'p', variantId: 'v', quantity: 0 } }],
    ['a missing name', { name: '' }],
    ['a fractional cap', { limits: { unitCap: 1.5 } }],
  ])('should refuse %s', async (_name, overrides) => {
    const dto = plainToInstance(WritePromotionDto, body(overrides));

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

describe('CombinesWithDto', () => {
  const check = async (combinesWith: unknown): Promise<number> =>
    (await validate(plainToInstance(WritePromotionDto, body({ combinesWith })))).length;
  const ID = '0b9f5f8e-5c1f-4f4e-9f0c-1a2b3c4d5e6f';

  it.each([[{ mode: 'all' }], [{ mode: 'none' }], [{ mode: 'selected', promotionIds: [ID] }]])(
    'should accept %j',
    async (value) => {
      expect(await check(value)).toBe(0);
    }
  );

  it.each([
    ['an unknown mode', { mode: 'some' }],
    ['selected without ids', { mode: 'selected' }],
    ['selected with a non-uuid id', { mode: 'selected', promotionIds: ['nope'] }],
    ['ids on mode all', { mode: 'all', promotionIds: [ID] }],
    ['ids on mode none', { mode: 'none', promotionIds: [ID] }],
  ])('should reject %s', async (_label, value) => {
    expect(await check(value)).toBeGreaterThan(0);
  });

  it('should build the combination for the service', () => {
    const dto = plainToInstance(WritePromotionDto, body({ combinesWith: { mode: 'selected', promotionIds: [ID] } }));

    expect(dto.toInput().combinesWith).toEqual({ mode: 'selected', promotionIds: [ID] });
  });
});

describe('EvaluatePromotionsDto', () => {
  it('should accept an optional customerId and reject an empty one', async () => {
    expect(await validate(plainToInstance(EvaluatePromotionsDto, { orderId: 'o1' }))).toHaveLength(0);
    expect(
      await validate(plainToInstance(EvaluatePromotionsDto, { orderId: 'o1', customerId: 'ol_customer_1' }))
    ).toHaveLength(0);
    expect(
      (await validate(plainToInstance(EvaluatePromotionsDto, { orderId: 'o1', customerId: '' }))).length
    ).toBeGreaterThan(0);
  });
});
