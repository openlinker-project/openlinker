/**
 * Order Bulk Actions Controller Tests (#3545)
 *
 * @module apps/api/src/orders/http
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import type { IOrderRecordService } from '@openlinker/core/orders';
import {
  OrderCancellationNotFoundError,
  OrderCancellationRefusedError,
} from '../application/errors/order-cancellation.errors';
import type { IOrderCancellationService } from '../application/interfaces/order-cancellation.service.interface';
import type { CancelOrderResult } from '../application/types/order-cancellation.types';
import { BulkCancelOrdersRequestDto, BulkOrderIdsRequestDto } from './dto/bulk-order-actions.dto';
import { OrderBulkActionsController } from './order-bulk-actions.controller';

const user = { id: 'user-1', role: 'admin' } as never;

const cancelled = (overrides: Partial<CancelOrderResult> = {}): CancelOrderResult => ({
  status: 'cancelled',
  changeId: 'chg-1',
  cancelledAt: new Date(),
  participants: [],
  otherParticipantsRelayFailed: false,
  voidedShipmentIds: [],
  cancelledWorkIds: [],
  stockRestoreEnqueued: false,
  correctionProposal: null,
  correctionUnavailableReason: null,
  ...overrides,
});

describe('OrderBulkActionsController (#3545)', () => {
  let cancellation: { cancelOrder: jest.Mock };
  let records: { getOrderRecord: jest.Mock; markBuyerNoteRead: jest.Mock };
  let controller: OrderBulkActionsController;

  beforeEach(() => {
    cancellation = { cancelOrder: jest.fn() };
    records = { getOrderRecord: jest.fn(), markBuyerNoteRead: jest.fn() };
    controller = new OrderBulkActionsController(
      cancellation as unknown as IOrderCancellationService,
      records as unknown as IOrderRecordService
    );
  });

  describe('bulkCancel', () => {
    it('should map mixed outcomes per row and keep going after a throwing row', async () => {
      cancellation.cancelOrder
        .mockResolvedValueOnce(cancelled())
        .mockResolvedValueOnce(cancelled({ status: 'pending' }))
        .mockResolvedValueOnce(
          cancelled({
            correctionProposal: {
              changeId: 'chg-9',
              invoiceRecordId: 'inv',
              documentNumber: null,
              currency: 'PLN',
              lines: [],
            },
          })
        )
        .mockRejectedValueOnce(
          new OrderCancellationRefusedError('ORDER_ALREADY_SHIPPED', 'Already shipped.')
        )
        .mockRejectedValueOnce(new OrderCancellationNotFoundError('nope'))
        .mockRejectedValueOnce(new Error('connection string postgres://secret'))
        .mockResolvedValueOnce(cancelled());

      const res = await controller.bulkCancel(
        { orderIds: ['a', 'b', 'c', 'd', 'e', 'g', 'h'], reason: 'buyer-request' as never },
        user
      );

      expect(res.results.map((r) => r.outcome)).toEqual([
        'cancelled',
        'pending',
        'correction-proposed',
        'refused',
        'failed',
        'failed',
        'cancelled',
      ]);
      expect(res.results[2].correctionProposalChangeId).toBe('chg-9');
      expect(res.results[3]).toMatchObject({ code: 'ORDER_ALREADY_SHIPPED', reason: 'Already shipped.' });
      expect(res.results[4].code).toBe('ORDER_NOT_FOUND');
      expect(JSON.stringify(res)).not.toContain('postgres://');
      expect(res).toMatchObject({
        total: 7,
        cancelled: 2,
        pending: 1,
        correctionProposed: 1,
        refused: 1,
        failed: 2,
      });
    });

    it('should dedupe ids, pass one reason, the trimmed note and the actor to every call', async () => {
      cancellation.cancelOrder.mockResolvedValue(cancelled());

      const res = await controller.bulkCancel(
        {
          orderIds: ['a', 'a', 'b'],
          reason: 'other' as never,
          note: '  stock gone ',
          acknowledgeAcceptedWork: true,
        },
        user
      );

      expect(res.total).toBe(2);
      expect(cancellation.cancelOrder).toHaveBeenCalledTimes(2);
      expect(cancellation.cancelOrder).toHaveBeenCalledWith({
        internalOrderId: 'a',
        reason: 'other',
        note: 'stock gone',
        acknowledgeAcceptedWork: true,
        actorUserId: 'user-1',
      });
    });

    it('should refuse the whole batch with 400 when reason is other and the note is missing', async () => {
      await expect(
        controller.bulkCancel({ orderIds: ['a'], reason: 'other' as never }, user)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cancellation.cancelOrder).not.toHaveBeenCalled();
    });
  });

  describe('cancel warnings (B-24)', () => {
    it('should keep outcome cancelled but add machine warnings for hidden side effects (B-24)', async () => {
      cancellation.cancelOrder.mockResolvedValue(
        cancelled({
          participants: [
            { connectionId: 'erli', role: 'source', effect: 'stock-restored-only', detail: null },
            { connectionId: 'shop', role: 'destination', effect: 'refused', detail: null },
          ],
          otherParticipantsRelayFailed: true,
          correctionUnavailableReason: 'no-line-snapshot',
          stockRestoreEnqueued: false,
        })
      );

      const res = await controller.bulkCancel({ orderIds: ['a'], reason: 'buyer-request' as never }, user);

      expect(res.results[0].outcome).toBe('cancelled');
      expect(res.results[0].warnings).toEqual([
        'stock-restored-only:erli',
        'destination-not-notified',
        'correction-unavailable:no-line-snapshot',
        'stock-restore-not-queued',
      ]);
    });

    it('should count pending separately from cancelled (B-24)', async () => {
      cancellation.cancelOrder.mockResolvedValue(cancelled({ status: 'pending' }));
      const res = await controller.bulkCancel({ orderIds: ['a'], reason: 'buyer-request' as never }, user);
      expect(res).toMatchObject({ cancelled: 0, pending: 1 });
    });
  });

  it('should answer one 400 when reason is other and the note is whitespace only (B-15)', async () => {
    await expect(
      controller.bulkCancel({ orderIds: ['a', 'b'], reason: 'other' as never, note: '   ' }, user)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cancellation.cancelOrder).not.toHaveBeenCalled();
  });

  describe('bulkMarkBuyerNoteRead', () => {
    it('should report marked, already-read, no-note, not-found and failed per row', async () => {
      records.getOrderRecord
        .mockResolvedValueOnce({ hasBuyerNote: true, buyerNoteReadAt: null })
        .mockResolvedValueOnce({ hasBuyerNote: true, buyerNoteReadAt: new Date() })
        .mockResolvedValueOnce({ hasBuyerNote: false, buyerNoteReadAt: null })
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ hasBuyerNote: true, buyerNoteReadAt: null });
      records.markBuyerNoteRead.mockResolvedValue({});

      const res = await controller.bulkMarkBuyerNoteRead(
        { orderIds: ['a', 'b', 'c', 'd', 'e', 'f', 'a'] },
        user
      );

      expect(res.results.map((r) => r.outcome)).toEqual([
        'marked',
        'already-read',
        'no-note',
        'not-found',
        'failed',
        'marked',
      ]);
      expect(res).toMatchObject({ total: 6, marked: 2, alreadyRead: 1, noNote: 1, notFound: 1, failed: 1 });
      expect(records.markBuyerNoteRead).toHaveBeenCalledTimes(2);
      expect(records.markBuyerNoteRead).toHaveBeenCalledWith('a', 'user-1');
    });
  });

  describe('request DTOs', () => {
    it('should reject an empty list and a list over 100', async () => {
      const empty = plainToInstance(BulkOrderIdsRequestDto, { orderIds: [] });
      const big = plainToInstance(BulkCancelOrdersRequestDto, {
        orderIds: Array.from({ length: 101 }, (_, i) => `o${i}`),
        reason: 'other',
        note: 'x',
      });
      expect((await validate(empty)).length).toBeGreaterThan(0);
      expect((await validate(big)).length).toBeGreaterThan(0);
    });
  });

  describe('roles', () => {
    it('should keep cancel admin-only and buyer-note read admin/operator', () => {
      const roles = (name: keyof OrderBulkActionsController): unknown =>
        Reflect.getMetadata('roles', OrderBulkActionsController.prototype[name]);
      expect(roles('bulkCancel')).toEqual(['admin']);
      expect(roles('bulkMarkBuyerNoteRead')).toEqual(['admin', 'operator']);
    });
  });
});
