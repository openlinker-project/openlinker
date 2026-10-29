/**
 * Order Edits Controller Tests (#3542)
 *
 * @module apps/api/src/orders/http
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RefundCeilingExceededException, type IOrderRecordService } from '@openlinker/core/orders';

import {
  OrderEditInvalidError,
  OrderEditNotFoundError,
  OrderEditRefusedError,
} from '../application/errors/order-edit.errors';
import type { IOrderEditService } from '../application/interfaces/order-edit.service.interface';
import type { OrderEditResult } from '../application/types/order-edit.types';
import { OrderEditsController } from './order-edits.controller';

const user = { id: 'user-1', role: 'admin' } as never;

const result: OrderEditResult = {
  dryRun: false,
  changeId: 'chg-1',
  view: {
    editedAt: '2026-10-26T10:00:00.000Z',
    address: null,
    lines: [],
    deliveryMethod: null,
    totals: null,
    discount: null,
    discountProposals: [],
    cod: null,
    unmatchedLineEdits: [],
    history: [],
  },
  stock: [{ orderLineId: 'l1', stockRestored: 'not-applicable', detail: null }],
};

describe('OrderEditsController (#3542)', () => {
  let edits: jest.Mocked<IOrderEditService>;
  let orderRecords: { getOrderRecord: jest.Mock };
  let controller: OrderEditsController;

  beforeEach(() => {
    edits = {
      editAddress: jest.fn().mockResolvedValue(result),
      editLines: jest.fn().mockResolvedValue(result),
      editDeliveryMethod: jest.fn().mockResolvedValue(result),
      editDiscount: jest.fn(),
      getEditsView: jest.fn(),
    };
    orderRecords = { getOrderRecord: jest.fn() };
    controller = new OrderEditsController(edits, orderRecords as unknown as IOrderRecordService);
  });

  it('should take the actor from the session and pass dryRun through, not into the address', async () => {
    await controller.editAddress(
      'ol_order_1',
      { address1: 'New 1', city: 'Krakow', postalCode: '30-001', country: 'PL', dryRun: true },
      user
    );

    expect(edits.editAddress).toHaveBeenCalledWith({
      internalOrderId: 'ol_order_1',
      actorUserId: 'user-1',
      dryRun: true,
      address: { address1: 'New 1', city: 'Krakow', postalCode: '30-001', country: 'PL' },
    });
  });

  it('should default dryRun and the acknowledgement to false on a lines edit', async () => {
    const response = await controller.editLines(
      'ol_order_1',
      { lines: [{ orderLineId: 'l1', quantity: 1 }] },
      user
    );

    expect(edits.editLines).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, acknowledgeAcceptedWork: false })
    );
    expect(response.stock[0].stockRestored).toBe('not-applicable');
  });

  it('should send an absent pickup point as null so the edit clears it', async () => {
    await controller.editDeliveryMethod('ol_order_1', { methodId: ' courier ' }, user);

    expect(edits.editDeliveryMethod).toHaveBeenCalledWith(
      expect.objectContaining({ methodId: 'courier', methodName: null, pickupPoint: null })
    );
  });

  it('should answer a refusal as a 409 that carries the machine code', async () => {
    edits.editLines.mockRejectedValue(new OrderEditRefusedError('ORDER_PACKED', 'packed'));

    const thrown = await controller
      .editLines('ol_order_1', { lines: [{ orderLineId: 'l1', quantity: 0 }] }, user)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toMatchObject({ error: 'ORDER_PACKED' });
  });

  it('should answer an unknown order or line as 404 and an unusable payload as 400', async () => {
    edits.editLines.mockRejectedValueOnce(new OrderEditNotFoundError('no line'));
    edits.editLines.mockRejectedValueOnce(new OrderEditInvalidError('twice'));
    const body = { lines: [{ orderLineId: 'l1', quantity: 0 }] };

    await expect(controller.editLines('o', body, user)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.editLines('o', body, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should 404 the history read for an order that does not exist', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(null);

    await expect(controller.getEdits('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('discount (#3543)', () => {
    const discountResult: OrderEditResult = {
      ...result,
      discount: {
        discount: null,
        paymentBranch: 'paid',
        amountToCollect: null,
        refundIntent: null,
        refundIntentFailed: false,
        correctionProposal: null,
        correctionUnavailableReason: null,
      },
    };

    it('should take the actor from the session and pass amount, percent, ack and dryRun through', async () => {
      edits.editDiscount.mockResolvedValue(discountResult);

      await controller.editDiscount(
        'ol_order_1',
        { amount: '12.50', acknowledgeAboveCeiling: true, dryRun: true },
        user
      );

      expect(edits.editDiscount).toHaveBeenCalledWith({
        internalOrderId: 'ol_order_1',
        actorUserId: 'user-1',
        dryRun: true,
        amount: '12.50',
        percent: null,
        acknowledgeAboveCeiling: true,
      });
    });

    it('should map an exceeded refund ceiling to 409 refund_ceiling_exceeded with the figures', async () => {
      edits.editDiscount.mockRejectedValue(
        new RefundCeilingExceededException('ol_order_1', '50.00', '45.00', '12.50', 'PLN')
      );

      await expect(controller.editDiscount('ol_order_1', { amount: '12.50' }, user)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'refund_ceiling_exceeded',
          ceiling: '50.00',
          alreadyRefunded: '45.00',
          requested: '12.50',
        }),
      });
    });

    it.each(['DISCOUNT_EXCEEDS_TOTAL', 'ORDER_HAS_FISCAL_RECEIPT', 'INVOICE_NOT_SETTLED'] as const)(
      'should map %s to a 409 carrying the code',
      async (code) => {
        edits.editDiscount.mockRejectedValue(new OrderEditRefusedError(code, 'no'));

        await expect(controller.editDiscount('ol_order_1', { amount: '1' }, user)).rejects.toMatchObject({
          response: expect.objectContaining({ error: code }),
        });
      }
    );

    it('should answer the spec shape: discount, both totals, amount to collect, refund intent, correction', async () => {
      edits.editDiscount.mockResolvedValue({
        ...discountResult,
        view: {
          ...result.view,
          totals: { currency: 'PLN', channelTotal: 50, total: 45, difference: 5, channelDiscountTotal: null, combinedDiscountTotal: null, taxRestated: false },
        },
      });

      const response = await controller.editDiscount('ol_order_1', { percent: 10 }, user);

      expect(response.totals).toEqual({ currency: 'PLN', channelTotal: 50, total: 45, difference: 5, channelDiscountTotal: null, combinedDiscountTotal: null });
      expect(response).toMatchObject({
        discount: null,
        amountToCollect: null,
        refundIntent: null,
        correctionProposal: null,
      });
    });
  });
});
