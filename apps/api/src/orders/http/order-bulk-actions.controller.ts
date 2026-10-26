/**
 * Order Bulk Actions Controller (#3545, D11/D37/D38)
 *
 * The bulk actions of the orders list that are not tag assignment: cancel and
 * mark-buyer-note-read. Each fans out SEQUENTIALLY over the single-order
 * primitive (no parallel bulk pipeline), reports a per-row outcome and never
 * aborts the batch: a refusal is a `refused` row, an unexpected throw a `failed`
 * row with a PII-free reason. Roles match the single-order routes.
 *
 * Declared before `OrdersController` in `OrdersModule`: its
 * `POST :internalOrderId/cancel` would otherwise swallow `POST /orders/bulk/cancel`.
 *
 * @module apps/api/src/orders/http
 */
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Logger } from '@openlinker/shared/logging';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ORDER_CANCELLATION_SERVICE_TOKEN,
  type IOrderCancellationService,
} from '../application/interfaces/order-cancellation.service.interface';
import {
  CancelCorrectionFailedError,
  OrderCancellationNoteRequiredError,
  OrderCancellationNotFoundError,
  OrderCancellationRefusedError,
} from '../application/errors/order-cancellation.errors';
import { dedupeOrderIds, unexpectedRowFailure } from './bulk-row-result';
import type {
  BulkBuyerNoteReadResultDto,
  BulkCancelOrderResultDto} from './dto/bulk-order-actions.dto';
import {
  BulkBuyerNoteReadResponseDto,
  BulkCancelOrdersRequestDto,
  BulkCancelOrdersResponseDto,
  BulkOrderIdsRequestDto,
} from './dto/bulk-order-actions.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/bulk')
export class OrderBulkActionsController {
  private readonly logger = new Logger(OrderBulkActionsController.name);

  constructor(
    @Inject(ORDER_CANCELLATION_SERVICE_TOKEN)
    private readonly orderCancellation: IOrderCancellationService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  @Roles('admin')
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel several orders at the operator\'s request',
    description:
      'Runs the SAME single-order cancel (`POST /orders/:id/cancel`: its gates, per-order lock and ' +
      'channel proposal) once per order, sequentially, with ONE reason for the batch. Never ' +
      'all-or-nothing: each row reports `cancelled`, `pending`, `correction-proposed`, `refused` ' +
      '(with the single-order 409 machine `code`) or `failed`. At most 100 order ids.',
  })
  @ApiResponse({ status: 200, type: BulkCancelOrdersResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error, or a note is missing for `other`' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async bulkCancel(
    @Body() dto: BulkCancelOrdersRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BulkCancelOrdersResponseDto> {
    const note = dto.note?.trim() ? dto.note.trim() : null;
    // Batch-level, so refuse once instead of repeating the same 400 as N rows.
    if (dto.reason === 'other' && note === null) {
      throw new BadRequestException(new OrderCancellationNoteRequiredError().message);
    }

    const results: BulkCancelOrderResultDto[] = [];
    for (const orderId of dedupeOrderIds(dto.orderIds)) {
      results.push(
        await this.cancelOne(orderId, dto, note, user.id)
      );
    }
    const count = (outcome: BulkCancelOrderResultDto['outcome']): number =>
      results.filter((r) => r.outcome === outcome).length;
    return {
      total: results.length,
      cancelled: count('cancelled'),
      pending: count('pending'),
      correctionProposed: count('correction-proposed'),
      refused: count('refused'),
      failed: count('failed'),
      results,
    };
  }

  @Roles('admin', 'operator')
  @Post('buyer-note/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark several orders\' buyer notes read',
    description:
      'Runs the single-order mark-read (`POST /orders/:id/buyer-note/read`) per order. An order ' +
      'without a buyer note is `no-note` (skipped), an already-read one `already-read` (the first ' +
      'reader is never overwritten). At most 100 order ids.',
  })
  @ApiResponse({ status: 200, type: BulkBuyerNoteReadResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async bulkMarkBuyerNoteRead(
    @Body() dto: BulkOrderIdsRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BulkBuyerNoteReadResponseDto> {
    const results: BulkBuyerNoteReadResultDto[] = [];
    for (const orderId of dedupeOrderIds(dto.orderIds)) {
      results.push(await this.markOne(orderId, user.id));
    }
    const count = (outcome: BulkBuyerNoteReadResultDto['outcome']): number =>
      results.filter((r) => r.outcome === outcome).length;
    return {
      total: results.length,
      marked: count('marked'),
      alreadyRead: count('already-read'),
      noNote: count('no-note'),
      notFound: count('not-found'),
      failed: count('failed'),
      results,
    };
  }

  /** Never throws: every branch is a row outcome so one order cannot stop the batch. */
  private async cancelOne(
    orderId: string,
    dto: BulkCancelOrdersRequestDto,
    note: string | null,
    actorUserId: string
  ): Promise<BulkCancelOrderResultDto> {
    try {
      const result = await this.orderCancellation.cancelOrder({
        internalOrderId: orderId,
        reason: dto.reason,
        note,
        acknowledgeAcceptedWork: dto.acknowledgeAcceptedWork === true,
        actorUserId,
      });
      if (result.status === 'pending') {
        return { orderId, outcome: 'pending' };
      }
      if (result.correctionProposal) {
        return {
          orderId,
          outcome: 'correction-proposed',
          correctionProposalChangeId: result.correctionProposal.changeId,
        };
      }
      return { orderId, outcome: 'cancelled' };
    } catch (error) {
      if (error instanceof OrderCancellationRefusedError) {
        return { orderId, outcome: 'refused', code: error.code, reason: error.message };
      }
      if (error instanceof OrderCancellationNotFoundError) {
        return { orderId, outcome: 'failed', code: 'ORDER_NOT_FOUND', reason: 'Order not found.' };
      }
      if (error instanceof CancelCorrectionFailedError) {
        // The provider's own message is not passed on; the code is enough to act on.
        return {
          orderId,
          outcome: 'failed',
          code: 'CORRECTION_FAILED',
          reason: 'The credit correction failed; the change stays open.',
        };
      }
      return {
        orderId,
        outcome: 'failed',
        reason: unexpectedRowFailure(this.logger, 'cancel', orderId, error),
      };
    }
  }

  private async markOne(orderId: string, userId: string): Promise<BulkBuyerNoteReadResultDto> {
    try {
      const record = await this.orderRecordService.getOrderRecord(orderId);
      if (!record) {
        return { orderId, outcome: 'not-found' };
      }
      if (!record.hasBuyerNote) {
        return { orderId, outcome: 'no-note' };
      }
      if (record.buyerNoteReadAt !== null) {
        return { orderId, outcome: 'already-read' };
      }
      await this.orderRecordService.markBuyerNoteRead(orderId, userId);
      return { orderId, outcome: 'marked' };
    } catch (error) {
      return {
        orderId,
        outcome: 'failed',
        reason: unexpectedRowFailure(this.logger, 'buyer-note read', orderId, error),
      };
    }
  }
}
