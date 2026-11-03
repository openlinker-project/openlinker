/**
 * Buyer Emails Controller (#3555)
 *
 * The template editor's test send. It sends the subject and body it is given
 * (the editor sends its preview, variables already filled with sample values),
 * with the connection's sender / reply-to for that template, to the one
 * address the operator types. It ignores the opt-in on purpose: testing a
 * template before switching it on is the point. Nothing is recorded on any
 * order.
 *
 * The per-actor cap and the audit line live in
 * `IBuyerEmailNotificationService.sendTest`; this controller only maps its
 * answer onto HTTP.
 *
 * @module apps/api/src/orders/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN,
  type IBuyerEmailNotificationService,
} from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
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
  @ApiResponse({ status: 429, description: 'Too many test emails from this user; try again later' })
  @ApiResponse({ status: 503, description: 'The email could not be sent' })
  async sendTest(
    @Body() dto: SendBuyerEmailTestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<SendBuyerEmailTestResponseDto> {
    const result = await this.service.sendTest({
      actorUserId: user.id,
      connectionId: dto.connectionId,
      templateKey: dto.templateKey,
      to: dto.to.trim(),
      subject: dto.subject,
      text: dto.body,
    });
    if (result.status === 'refused') {
      switch (result.reason) {
        case 'connection-not-found':
          throw new NotFoundException(result.message);
        case 'rate-limited':
          throw new HttpException(result.message, HttpStatus.TOO_MANY_REQUESTS);
        case 'invalid-address':
          throw new BadRequestException(result.message);
      }
    }
    if (result.status === 'failed') {
      throw new ServiceUnavailableException(result.message);
    }
    return { status: 'sent' };
  }
}
