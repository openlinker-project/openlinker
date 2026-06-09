/**
 * Webhook Controller
 *
 * HTTP REST API endpoints for webhook ingestion. Handles inbound webhook
 * requests from external systems (e.g., PrestaShop), validates signatures,
 * performs deduplication, and publishes events to the event bus.
 *
 * @module apps/api/src/webhooks/http
 */
import {
  Controller,
  Post,
  Param,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiHeader } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { WebhookService } from '../application/services/webhook.service';
import { RequestWithRawBody } from './middleware/raw-body.middleware';
import { WebhookAuthenticationException } from '../application/errors/webhook-authentication.exception';
import { WebhookReplayException } from '../application/errors/webhook-replay.exception';
import { WebhookDecodeException } from '../application/errors/webhook-decode.exception';
import { Logger } from '@openlinker/shared/logging';

@Public()
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly MAX_BODY_SIZE = 256 * 1024; // 256KB

  constructor(
    private readonly webhookService: WebhookService,
  ) {}

  @Post(':provider/:connectionId')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Receive inbound webhook from external system' })
  @ApiParam({ name: 'provider', description: 'Provider identifier (e.g., "prestashop")', example: 'prestashop' })
  @ApiParam({ name: 'connectionId', description: 'Connection identifier (UUID)', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiHeader({ name: 'X-OpenLinker-Timestamp', description: 'Unix timestamp in milliseconds', required: true })
  @ApiHeader({ name: 'X-OpenLinker-Signature', description: 'HMAC SHA256 signature (format: sha256=<hex>)', required: true })
  @ApiResponse({ status: 202, description: 'Webhook accepted and queued for processing' })
  @ApiResponse({ status: 400, description: 'Invalid request payload or malformed data' })
  @ApiResponse({ status: 401, description: 'Invalid signature or timestamp out of window' })
  @ApiResponse({ status: 404, description: 'Connection not found or disabled' })
  @ApiResponse({ status: 413, description: 'Request payload too large' })
  async receiveWebhook(
    @Param('provider') provider: string,
    @Param('connectionId') connectionId: string,
    @Headers() headers: Record<string, string>,
    @Req() req: RequestWithRawBody,
  ): Promise<void> {
    // No `@Body() WebhookRequestDto` — the body shape is the provider's, not
    // OL's (ADR-021). The per-provider decoder (resolved in WebhookService)
    // verifies + parses the raw bytes; the host OL-module default decoder still
    // validates the WebhookRequestDto envelope for OL-enveloped providers.
    // Get raw body from request (set by express.json() verify hook in main.ts)
    const rawBody = req.rawBody;

    if (!rawBody) {
      this.logger.warn(`Raw body not available: provider=${provider}, connectionId=${connectionId}`);
      throw new BadRequestException('Raw body not available for signature verification');
    }

    // Validate request size
    if (rawBody.length > this.MAX_BODY_SIZE) {
      this.logger.warn(
        `Request body too large: provider=${provider}, connectionId=${connectionId}, size=${rawBody.length}`,
      );
      throw new PayloadTooLargeException(
        `Request body exceeds maximum size of ${this.MAX_BODY_SIZE} bytes. Actual size: ${rawBody.length} bytes`,
      );
    }

    // Validate provider and connectionId format
    if (!provider || !/^[a-z]+$/.test(provider)) {
      throw new BadRequestException('Invalid provider format. Must be lowercase letters only.');
    }

    if (!connectionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId)) {
      throw new BadRequestException('Invalid connectionId format. Must be a valid UUID.');
    }

    try {
      await this.webhookService.processWebhook(provider, connectionId, rawBody, headers);
    } catch (error) {
      // Map domain exceptions to HTTP exceptions
      if (error instanceof WebhookDecodeException) {
        // Authentic request, unusable body (decoder `reject`) → 400.
        this.logger.warn(
          `Webhook body decode failed: provider=${provider}, connectionId=${connectionId}`,
          error.message,
        );
        throw new BadRequestException(error.message);
      }

      if (error instanceof WebhookAuthenticationException) {
        this.logger.warn(
          `Webhook authentication failed: provider=${provider}, connectionId=${connectionId}`,
          error.message,
        );
        throw new UnauthorizedException(error.message);
      }

      if (error instanceof WebhookReplayException) {
        this.logger.warn(
          `Webhook replay detected: provider=${provider}, connectionId=${connectionId}`,
          error.message,
        );
        throw new UnauthorizedException(error.message);
      }

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('disabled')) {
          throw new NotFoundException(error.message);
        }
        if (error.message.includes('signature') || error.message.includes('authentication')) {
          throw new UnauthorizedException(error.message);
        }
        if (error.message.includes('replay') || error.message.includes('timestamp')) {
          throw new UnauthorizedException(error.message);
        }
      }

      // Re-throw unknown errors
      this.logger.error(
        `Unexpected error processing webhook: provider=${provider}, connectionId=${connectionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}

