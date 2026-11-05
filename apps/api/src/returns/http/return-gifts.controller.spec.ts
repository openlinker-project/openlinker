import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReturnGiftDecisionInvalidError } from '@openlinker/core/returns';
import { ReturnGiftsController } from './return-gifts.controller';

const USER = { id: 'u1' } as never;

function build(): {
  controller: ReturnGiftsController;
  decisions: { list: jest.Mock; decide: jest.Mock };
} {
  const returns = {
    getReturn: jest.fn().mockResolvedValue({ id: 'r1', internalOrderId: 'o1' }),
  };
  const decisions = { list: jest.fn().mockResolvedValue([]), decide: jest.fn().mockResolvedValue({}) };
  const orderRecords = {
    getOrderRecord: jest.fn().mockResolvedValue({
      currency: 'PLN',
      orderItems: [
        { id: 'paid', productId: 'p0', quantity: 1, price: 100 },
        {
          id: 'g1',
          productId: 'p1',
          variantId: 'v1',
          quantity: 2,
          price: 0,
          sku: 'SAMPLE',
          gift: { source: 'ol-rule' },
        },
      ],
    }),
  };
  const products = {
    getVariantsByIds: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1', sku: 'SAMPLE', price: 9.99 }]),
    getProductsByIds: jest.fn().mockResolvedValue([{ id: 'p1', price: 9.99 }]),
  };
  const controller = new ReturnGiftsController(
    returns as never,
    decisions as never,
    orderRecords as never,
    products as never
  );
  return { controller, decisions };
}

describe('ReturnGiftsController', () => {
  it('should list only the gift lines, undecided, with their standalone price', async () => {
    const { controller } = build();
    const result = await controller.list('r1');
    expect(result.gifts).toHaveLength(1);
    expect(result.gifts[0]).toMatchObject({
      giftLineId: 'g1',
      decision: null,
      standalonePriceGross: 19.98,
    });
    expect(result.refundDeductionGross).toBe(0);
  });

  it('should default a deduction to the gift standalone price', async () => {
    const { controller, decisions } = build();
    await controller.decide('r1', 'g1', { decision: 'deduct' }, USER);
    expect(decisions.decide).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'deduct', deductionGross: 19.98, actorUserId: 'u1' })
    );
  });

  it('should send no amount for keep', async () => {
    const { controller, decisions } = build();
    await controller.decide('r1', 'g1', { decision: 'keep', deductionGross: 5 }, USER);
    expect(decisions.decide).toHaveBeenCalledWith(expect.objectContaining({ deductionGross: null }));
  });

  it('should answer 404 for a line that is not a gift of the order', async () => {
    const { controller } = build();
    await expect(controller.decide('r1', 'paid', { decision: 'keep' }, USER)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('should map an invalid decision to 400', async () => {
    const { controller, decisions } = build();
    decisions.decide.mockRejectedValue(new ReturnGiftDecisionInvalidError('deduction-required'));
    await expect(controller.decide('r1', 'g1', { decision: 'deduct' }, USER)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
