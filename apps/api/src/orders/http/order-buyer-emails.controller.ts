/**
 * Order Buyer Emails Controller (#3554)
 *
 * Read-only: the automatic buyer emails an order produced (sent, suppressed with
 * its reason, or bounced), newest first, for the order timeline.
 *
 * @module apps/api/src/orders/http
 */
import { Controller, Get, HttpCode, HttpStatus, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN,
  type IBuyerEmailNotificationService,
} from '@openlinker/core/orders';
import { BuyerEmailDeliveryResponseDto } from './dto/buyer-email-delivery-response.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/:internalOrderId/buyer-emails')
export class OrderBuyerEmailsController {
  constructor(
    @Inject(BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN)
    private readonly service: IBuyerEmailNotificationService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "An order's automatic buyer emails (#3554)",
    description:
      'Newest first: each automatic buyer email attempt - sent, suppressed (with its reason) or ' +
      'bounced. Carries no recipient address.',
  })
  @ApiResponse({ status: 200, type: [BuyerEmailDeliveryResponseDto] })
  async list(
    @Param('internalOrderId') internalOrderId: string
  ): Promise<BuyerEmailDeliveryResponseDto[]> {
    const rows = await this.service.listForOrder(internalOrderId);
    return rows.map((row) => BuyerEmailDeliveryResponseDto.from(row));
  }
}
