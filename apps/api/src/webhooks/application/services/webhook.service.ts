/**
 * Webhook Service
 *
 * Orchestrates the complete webhook processing flow including signature verification,
 * deduplication, and event publishing. Coordinates between WebhookAuthService,
 * WebhookDedupService, and WebhookEventPublisher to process inbound webhooks.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { IWebhookService } from '../interfaces/webhook.service.interface';
import { WebhookAuthService } from './webhook-auth.service';
import { WebhookDedupService } from './webhook-dedup.service';
import { WebhookEventPublisher } from './webhook-event-publisher.service';
import { InboundWebhookEvent } from '@openlinker/core/events/domain/types/inbound-webhook-event.types';
import { WebhookRequestDto } from '../../http/dto/webhook-request.dto';
import { Logger } from '@openlinker/shared/logging';
import {
  WebhookDeliveryRepositoryPort,
  WebhookDeliveryUpsertInput,
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
} from '@openlinker/core/webhooks';

@Injectable()
export class WebhookService implements IWebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly authService: WebhookAuthService,
    private readonly dedupService: WebhookDedupService,
    private readonly eventPublisher: WebhookEventPublisher,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY_TOKEN)
    private readonly deliveryRepository: WebhookDeliveryRepositoryPort,
  ) {}

  private async recordDelivery(input: WebhookDeliveryUpsertInput): Promise<void> {
    try {
      await this.deliveryRepository.upsert(input);
    } catch (error) {
      this.logger.warn(
        `Failed to record webhook delivery (non-fatal): provider=${input.provider}, connectionId=${input.connectionId}, eventId=${input.eventId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async processWebhook(
    provider: string,
    connectionId: string,
    request: WebhookRequestDto,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<void> {
    const correlationId = request.eventId; // Use eventId as correlation ID

    this.logger.log(
      `Processing webhook: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}, eventType=${request.eventType}`,
    );

    const receivedAt = new Date();
    const baseDelivery: WebhookDeliveryUpsertInput = {
      eventId: request.eventId,
      provider,
      connectionId,
      eventType: request.eventType ?? null,
      objectType: request.object?.type ?? null,
      externalId: request.object?.externalId ?? null,
      receivedAt,
      payload: request.payload as Record<string, unknown>,
    };
    await this.recordDelivery({ ...baseDelivery, status: 'received' });

    const timestamp = headers['x-openlinker-timestamp'] || headers['X-OpenLinker-Timestamp'];
    const signature = headers['x-openlinker-signature'] || headers['X-OpenLinker-Signature'];

    if (!timestamp) {
      this.logger.warn(`Missing X-OpenLinker-Timestamp header: provider=${provider}, connectionId=${connectionId}`);
      await this.recordDelivery({ ...baseDelivery, status: 'rejected', rejectionReason: 'missing_timestamp_header' });
      throw new Error('Missing X-OpenLinker-Timestamp header');
    }

    if (!signature) {
      this.logger.warn(`Missing X-OpenLinker-Signature header: provider=${provider}, connectionId=${connectionId}`);
      await this.recordDelivery({ ...baseDelivery, status: 'rejected', rejectionReason: 'missing_signature_header' });
      throw new Error('Missing X-OpenLinker-Signature header');
    }

    // Step 1: Validate timestamp (replay protection) - fail fast before HMAC
    try {
      this.authService.validateTimestamp(timestamp);
    } catch (error) {
      this.logger.warn(
        `Timestamp validation failed: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
        error instanceof Error ? error.message : String(error),
      );
      await this.recordDelivery({ ...baseDelivery, status: 'rejected', rejectionReason: 'stale_timestamp' });
      throw error;
    }

    // Step 2: Verify signature
    const isValid = await this.authService.verifySignature(
      provider,
      connectionId,
      timestamp,
      rawBody,
      signature,
    );

    if (!isValid) {
      this.logger.error(
        `Invalid webhook signature: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
      );
      await this.recordDelivery({
        ...baseDelivery,
        signatureValid: false,
        status: 'rejected',
        rejectionReason: 'invalid_signature',
      });
      throw new Error('Invalid webhook signature');
    }

    this.logger.debug(`Signature verified: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`);

    // Step 3: Check deduplication (mark as processing)
    const isNew = await this.dedupService.markProcessing(provider, connectionId, request.eventId);

    if (!isNew) {
      // Duplicate event - already processing or done
      this.logger.warn(
        `Duplicate webhook event detected: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
      );
      await this.recordDelivery({
        ...baseDelivery,
        signatureValid: true,
        dedupResult: 'duplicate',
      });
      return; // Return 202 (already accepted)
    }

    try {
      // Step 4: Build inbound webhook event
      const event: InboundWebhookEvent = {
        eventId: request.eventId,
        provider,
        connectionId,
        eventType: request.eventType,
        occurredAt: request.occurredAt,
        receivedAt: new Date().toISOString(),
        objectType: request.object.type,
        externalId: request.object.externalId,
        payload: request.payload,
      };

      // Step 5: Publish event to event bus
      const messageId = await this.eventPublisher.publishInboundWebhook(event);
      this.logger.log(
        `Published webhook event: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}, messageId=${messageId}`,
      );
      await this.recordDelivery({
        ...baseDelivery,
        signatureValid: true,
        dedupResult: 'new',
        status: 'published',
        publishedMessageId: messageId,
      });

      // Step 6: Mark as done (non-fatal if it fails)
      try {
        await this.dedupService.markDone(provider, connectionId, request.eventId);
      } catch (markDoneError) {
        // Non-fatal: log but don't fail the request
        this.logger.warn(
          `Failed to mark webhook as done (non-fatal): provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
          markDoneError instanceof Error ? markDoneError.message : String(markDoneError),
        );
      }
    } catch (error) {
      // Publish failed - clear processing marker to allow retries
      try {
        await this.dedupService.clearProcessing(provider, connectionId, request.eventId);
      } catch (clearError) {
        this.logger.error(
          `Failed to clear processing marker: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
          clearError instanceof Error ? clearError.stack : String(clearError),
        );
      }

      this.logger.error(
        `Failed to process webhook: provider=${provider}, connectionId=${connectionId}, eventId=${correlationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.recordDelivery({
        ...baseDelivery,
        signatureValid: true,
        dedupResult: 'new',
        status: 'failed',
        rejectionReason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });

      throw error;
    }
  }
}

