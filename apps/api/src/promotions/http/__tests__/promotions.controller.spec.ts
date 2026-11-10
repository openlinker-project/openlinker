/**
 * PromotionsController specs (#3935)
 *
 * @module apps/api/src/promotions/http/__tests__
 */
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Promotion, type PromotionView } from '@openlinker/core/promotions';

import { WritePromotionDto } from '../dto/promotion.dto';
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
    true,
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
    controller = new PromotionsController(promotions as never, orderGifts as never, orders as never);
  });

  it('should list promotions with their ledger view and a derived status', async () => {
    const [row] = await controller.list();

    expect(row).toMatchObject({
      id: 'p1',
      benefit: { kind: 'free-gift' },
      combinable: true,
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
