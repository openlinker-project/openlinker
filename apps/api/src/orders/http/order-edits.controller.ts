/**
 * Order Edits Controller (#3542, D9)
 *
 * `POST /orders/:internalOrderId/edits/{address,lines,delivery-method,discount}` - the
 * operator's post-import edits, saved in OpenLinker only (the channel keeps its
 * original) - and `GET .../edits`, the order beside the channel's own record.
 *
 * Writes are `@Roles('admin')`, matching the holds and cancel precedent: they
 * change what an order will be shipped, documented and charged as. The acting
 * user is taken from the session, never the body.
 *
 * @module apps/api/src/orders/http
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  RefundCeilingExceededException,
  type IOrderRecordService,
} from '@openlinker/core/orders';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  OrderEditInvalidError,
  OrderEditNotFoundError,
  OrderEditRefusedError,
} from '../application/errors/order-edit.errors';
import {
  ORDER_EDIT_SERVICE_TOKEN,
  type IOrderEditService,
} from '../application/interfaces/order-edit.service.interface';
import {
  EditOrderAddressRequestDto,
  EditOrderDeliveryMethodRequestDto,
  EditOrderDiscountRequestDto,
  EditOrderLinesRequestDto,
} from './dto/edit-order-request.dto';
import {
  OrderDiscountResponseDto,
  OrderEditResponseDto,
  OrderEditsViewDto,
} from './dto/order-edit-response.dto';

const REFUSAL_CODES =
  'ORDER_ALREADY_CANCELLED | ORDER_ALREADY_SHIPPED | ORDER_AMENDMENT_IN_FLIGHT | ORDER_NOT_READY | ' +
  'ORDER_PACKED | LABEL_ALREADY_BOUGHT | SALES_DOCUMENT_ISSUED | QUANTITY_ONLY_DECREASES | ' +
  'QUANTITY_BELOW_FULFILLED | ORDER_WOULD_BE_EMPTY | EDIT_AFTER_HANDOFF | ORDER_WORK_ACCEPTED_NEEDS_ACK | LINE_PRICE_NOT_RESOLVABLE | ' +
  'ADDRESS_EDIT_NEEDS_PII_STORAGE | ORDER_EDIT_CONTENDED | NOTHING_CHANGED | DISCOUNT_EXCEEDS_TOTAL | ' +
  'ORDER_HAS_FISCAL_RECEIPT | INVOICE_NOT_SETTLED';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/:internalOrderId/edits')
export class OrderEditsController {
  constructor(
    @Inject(ORDER_EDIT_SERVICE_TOKEN)
    private readonly edits: IOrderEditService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({
    summary: 'The order beside the channel\'s own record of it',
    description:
      'Every edited figure given twice - what the channel reported and what the order is after the ' +
      'edit - plus the edit history. `null` for an order nobody has edited.',
  })
  @ApiResponse({ status: 200, type: OrderEditsViewDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getEdits(@Param('internalOrderId') internalOrderId: string): Promise<OrderEditsViewDto | null> {
    const record = await this.orderRecords.getOrderRecord(internalOrderId);
    if (!record) {
      throw new NotFoundException(`Order not found: ${internalOrderId}`);
    }
    return this.edits.getEditsView(record);
  }

  @Roles('admin')
  @Post('address')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the shipping address (saved in OpenLinker only)',
    description:
      'An OpenLinker-side amendment confirmed immediately: the label, the pack bench and routing read the ' +
      'new address at once, and a later poll of the same order never overwrites it. The sales channel keeps ' +
      'its original; nothing is written back. Refused once a label is bought or the order is packed, and ' +
      'when OpenLinker is set not to store buyer addresses. With `dryRun` nothing is saved.',
  })
  @ApiResponse({ status: 200, type: OrderEditResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid address' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: REFUSAL_CODES })
  async editAddress(
    @Param('internalOrderId') internalOrderId: string,
    @Body() dto: EditOrderAddressRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<OrderEditResponseDto> {
    try {
      const { dryRun, ...address } = dto;
      return OrderEditResponseDto.from(
        await this.edits.editAddress({
          internalOrderId,
          actorUserId: user.id,
          dryRun: dryRun === true,
          address,
        })
      );
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Roles('admin')
  @Post('lines')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lower line quantities (saved in OpenLinker only)',
    description:
      'Quantities can only go down: raising one is a new sale OpenLinker will not charge. The order total ' +
      'and any cash-on-delivery amount are restated so the lines still sum to it, a routed order\'s work ' +
      'object is narrowed (never rewritten or re-routed), its reservation is lowered, and the product ' +
      'master is given its stock back (`stock[].stockRestored`). The channel keeps its original and ' +
      'nothing is refunded. Refused once the order is packed or a sales document is issued. With ' +
      '`dryRun` nothing is saved.',
  })
  @ApiResponse({ status: 200, type: OrderEditResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid lines' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Order or order line not found' })
  @ApiResponse({ status: 409, description: REFUSAL_CODES })
  async editLines(
    @Param('internalOrderId') internalOrderId: string,
    @Body() dto: EditOrderLinesRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<OrderEditResponseDto> {
    try {
      return OrderEditResponseDto.from(
        await this.edits.editLines({
          internalOrderId,
          actorUserId: user.id,
          dryRun: dto.dryRun === true,
          lines: dto.lines.map((line) => ({ orderLineId: line.orderLineId, quantity: line.quantity })),
          acknowledgeAcceptedWork: dto.acknowledgeAcceptedWork === true,
        })
      );
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Roles('admin')
  @Post('delivery-method')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the delivery method (saved in OpenLinker only)',
    description:
      'Routing and the label read the new method and pickup point at once; the channel keeps its ' +
      'original. Shipping is not repriced. Refused once a label is bought or the order is packed. ' +
      'With `dryRun` nothing is saved.',
  })
  @ApiResponse({ status: 200, type: OrderEditResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid delivery method' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: REFUSAL_CODES })
  async editDeliveryMethod(
    @Param('internalOrderId') internalOrderId: string,
    @Body() dto: EditOrderDeliveryMethodRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<OrderEditResponseDto> {
    try {
      return OrderEditResponseDto.from(
        await this.edits.editDeliveryMethod({
          internalOrderId,
          actorUserId: user.id,
          dryRun: dto.dryRun === true,
          methodId: dto.methodId.trim(),
          methodName: dto.methodName?.trim() ? dto.methodName.trim() : null,
          pickupPoint:
            dto.pickupPoint === undefined
              ? null
              : {
                  id: dto.pickupPoint.id,
                  ...(dto.pickupPoint.name !== undefined && { name: dto.pickupPoint.name }),
                  ...(dto.pickupPoint.description !== undefined && {
                    description: dto.pickupPoint.description,
                  }),
                },
        })
      );
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Roles('admin')
  @Post('discount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Grant, replace or remove an order discount (a money event, saved in OpenLinker only)',
    description:
      'Exactly one of `amount` (decimal, order currency) or `percent` (of the goods value). One discount per ' +
      'order: a second REPLACES the first, `"0"` removes it. The channel keeps the price the buyer paid; ' +
      'documents, labels and the amount to collect read the discounted figures. Unpaid / cash-on-delivery: ' +
      'the amount to collect falls. Paid: a refund intent for the difference is opened (confirm it with ' +
      'POST /orders/:id/changes/:changeId/confirm once the seller refunded on the channel; refused above ' +
      'the order\'s refund ceiling unless `acknowledgeAboveCeiling`). An already issued invoice gets a ' +
      'correction proposal to confirm the same way. With `dryRun` nothing is saved.',
  })
  @ApiResponse({ status: 200, type: OrderDiscountResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid amount or percent' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({
    status: 409,
    description: REFUSAL_CODES + ' | refund_ceiling_exceeded (`code`, with ceiling / alreadyRefunded / requested / currency)',
  })
  async editDiscount(
    @Param('internalOrderId') internalOrderId: string,
    @Body() dto: EditOrderDiscountRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<OrderDiscountResponseDto> {
    try {
      return OrderDiscountResponseDto.from(
        await this.edits.editDiscount({
          internalOrderId,
          actorUserId: user.id,
          dryRun: dto.dryRun === true,
          amount: dto.amount ?? null,
          percent: dto.percent ?? null,
          acknowledgeAboveCeiling: dto.acknowledgeAboveCeiling === true,
        })
      );
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  /**
   * One mapping for every refusal the service models. The machine code travels
   * in `error` (the `ORDER_ALREADY_ON_HOLD` shape): several 409s here have
   * different remedies and a status code alone cannot tell the operator which
   * one they are in.
   */
  private toHttpException(error: unknown): unknown {
    if (error instanceof OrderEditRefusedError) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: error.code,
        message: error.message,
      });
    }
    if (error instanceof RefundCeilingExceededException) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: error.code,
        message: error.message,
        ceiling: error.ceiling,
        alreadyRefunded: error.alreadyRefunded,
        requested: error.requested,
        currency: error.currency,
      });
    }
    if (error instanceof OrderEditNotFoundError) {
      return new NotFoundException(error.message);
    }
    if (error instanceof OrderEditInvalidError) {
      return new BadRequestException(error.message);
    }
    return error;
  }
}
