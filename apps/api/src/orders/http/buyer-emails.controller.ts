/**
 * Buyer Emails Controller (#3555)
 *
 * The template editor's test send. It sends the subject and body it is given
 * (the editor sends its preview, variables already filled with sample values),
 * with the connection's sender / reply-to for that template, to the address the
 * operator gives - never to a buyer and never recorded on an order. It ignores
 * the opt-in on purpose: testing a template before switching it on is the point.
 *
 * Each call is a real outbound send through the operator's mailer, so it is
 * capped per user (a fixed window on the shared cache, the shape
 * `EmailConfirmationService.enforceRateLimit` uses): a stuck button or a script
 * must not burn the sender's reputation. Best-effort, not atomic - it is a
 * brake, not a security boundary.
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
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared/cache';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN,
  type IBuyerEmailNotificationService,
} from '@openlinker/core/orders';
import {
  SendBuyerEmailTestDto,
  SendBuyerEmailTestResponseDto,
} from './dto/send-buyer-email-test.dto';

/** Test sends allowed per user within one window. */
export const BUYER_EMAIL_TEST_SEND_LIMIT = 10;
/** Length of the rate-limit window, in seconds. */
export const BUYER_EMAIL_TEST_SEND_WINDOW_SECONDS = 600;

@ApiBearerAuth()
@ApiTags('orders')
@Controller('buyer-emails')
export class BuyerEmailsController {
  constructor(
    @Inject(BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN)
    private readonly service: IBuyerEmailNotificationService,
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache: CachePort
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
    await this.enforceTestSendLimit(user.id);
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

  private async enforceTestSendLimit(userId: string): Promise<void> {
    const key = `buyer-emails:test-send:${userId}`;
    const count = (await this.cache.get<number>(key)) ?? 0;
    if (count >= BUYER_EMAIL_TEST_SEND_LIMIT) {
      throw new HttpException(
        `Too many test emails. Try again in ${BUYER_EMAIL_TEST_SEND_WINDOW_SECONDS / 60} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    await this.cache.set(key, count + 1, BUYER_EMAIL_TEST_SEND_WINDOW_SECONDS);
  }
}
