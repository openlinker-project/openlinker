/**
 * Buyer Emails Controller (#3555)
 *
 * The template editor's test send. It sends the subject and body as typed,
 * with the connection's sender / reply-to for that template, to the address the
 * operator gives - never to a buyer and never recorded on an order. It ignores
 * the opt-in on purpose: testing a template before switching it on is the point.
 *
 * @module apps/api/src/orders/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN,
  type IBuyerEmailNotificationService,
} from '@openlinker/core/orders';
import {
  SendBuyerEmailTestDto,
  SendBuyerEmailTestResponseDto,
} from './dto/send-buyer-email-test.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('buyer-emails')
export class BuyerEmailsController {
  constructor(
    @Inject(BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN)
    private readonly service: IBuyerEmailNotificationService
  ) {}

  @Roles('admin')
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a buyer-email template to a test address (#3555)' })
  @ApiResponse({ status: 200, type: SendBuyerEmailTestResponseDto })
  @ApiResponse({ status: 400, description: 'Not a single email address' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 503, description: 'The email could not be sent' })
  async sendTest(@Body() dto: SendBuyerEmailTestDto): Promise<SendBuyerEmailTestResponseDto> {
    const result = await this.service.sendTest({
      connectionId: dto.connectionId,
      templateKey: dto.templateKey,
      to: dto.to.trim(),
      subject: dto.subject,
      text: dto.body,
    });
    if (result.status === 'refused') {
      throw result.reason === 'connection-not-found'
        ? new NotFoundException(result.message)
        : new BadRequestException(result.message);
    }
    if (result.status === 'failed') {
      throw new ServiceUnavailableException(result.message);
    }
    return { status: 'sent' };
  }
}
