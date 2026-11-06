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
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN,
  type IBuyerEmailNotificationService,
} from '@openlinker/core/orders';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  SendBuyerEmailTestDto,
  SendBuyerEmailTestResponseDto,
} from './dto/send-buyer-email-test.dto';

/**
 * The 429 `error` code for a rate-limited test send. Upper-snake, the shape
 * `ORDER_ALREADY_ON_HOLD` uses, so the editor maps the code to its own copy
 * rather than showing the server's sentence. Mirrored verbatim in
 * `apps/web/src/features/buyer-emails/lib/buyer-email-test-error.ts`, held
 * identical by `scripts/check-buyer-email-mirror.mjs`.
 */
export const BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE = 'BUYER_EMAIL_TEST_RATE_LIMITED';

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
  @ApiResponse({
    status: 400,
    description: 'Not a single email address, or a template a marketplace connection does not send',
  })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({
    status: 429,
    description: 'Too many test emails from this user; `error` is BUYER_EMAIL_TEST_RATE_LIMITED',
  })
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
          throw codedHttpError(HttpStatus.NOT_FOUND, 'CONNECTION_NOT_FOUND', result.message, {
            connectionId: dto.connectionId,
          });
        case 'rate-limited':
          throw codedHttpError(
            HttpStatus.TOO_MANY_REQUESTS,
            BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE,
            result.message,
            undefined,
            // Kept for the clients that branch on `error` (#3555).
            { error: BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE }
          );
        case 'invalid-address':
          throw codedHttpError(
            HttpStatus.BAD_REQUEST,
            'BUYER_EMAIL_TEST_ADDRESS_INVALID',
            result.message
          );
        case 'template-not-allowed':
          throw codedHttpError(
            HttpStatus.BAD_REQUEST,
            'BUYER_EMAIL_TEMPLATE_NOT_ALLOWED',
            result.message,
            { templateKey: dto.templateKey }
          );
        default: {
          // A reason this controller does not map must never fall through to
          // `sent`: the email was refused, so answering 200 would be a lie.
          const unmapped: never = result.reason;
          throw codedHttpError(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'INTERNAL_ERROR',
            `Unmapped buyer email test refusal: ${String(unmapped)}`
          );
        }
      }
    }
    if (result.status === 'failed') {
      throw codedHttpError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'BUYER_EMAIL_TEST_SEND_FAILED',
        result.message
      );
    }
    return { status: 'sent' };
  }
}
