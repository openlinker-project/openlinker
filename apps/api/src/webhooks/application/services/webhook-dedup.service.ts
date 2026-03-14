/**
 * Webhook Deduplication Service
 *
 * Implements two-phase deduplication to prevent lost events and ensure
 * idempotent webhook processing. Uses Redis with two-phase approach:
 * 1. "processing" state (short TTL) - marks event as in-flight
 * 2. "done" state (long TTL) - marks event as successfully processed
 *
 * This approach prevents lost events if publish fails after marking as processing.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookDedupService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { RedisClientType } from 'redis';
import { IWebhookDedupService } from '../interfaces/webhook-dedup.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class WebhookDedupService implements IWebhookDedupService {
  private readonly logger = new Logger(WebhookDedupService.name);
  private readonly DEFAULT_PROCESSING_TTL = 60; // 60 seconds
  private readonly DEFAULT_DONE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
  ) {}

  private getDedupKey(provider: string, connectionId: string, eventId: string): string {
    return `webhook:${provider}:${connectionId}:${eventId}`;
  }

  async markProcessing(
    provider: string,
    connectionId: string,
    eventId: string,
    ttlSeconds: number = this.DEFAULT_PROCESSING_TTL,
  ): Promise<boolean> {
    const key = this.getDedupKey(provider, connectionId, eventId);

    try {
      // SET key "processing" NX EX ttlSeconds
      // NX = only set if key doesn't exist
      // Returns "OK" if set, null if key already exists
      const result = await this.redisClient.set(key, 'processing', {
        NX: true,
        EX: ttlSeconds,
      });

      if (result === 'OK') {
        this.logger.debug(`Marked webhook as processing: ${provider}:${connectionId}:${eventId}`);
        return true; // New event
      }

      // Key already exists - check current value
      const currentValue = await this.redisClient.get(key);
      if (currentValue === 'processing') {
        this.logger.debug(`Webhook already processing: ${provider}:${connectionId}:${eventId}`);
      } else if (currentValue === 'done') {
        this.logger.debug(`Webhook already processed: ${provider}:${connectionId}:${eventId}`);
      }

      return false; // Duplicate event
    } catch (error) {
      this.logger.error(
        `Failed to mark webhook as processing: ${provider}:${connectionId}:${eventId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async markDone(
    provider: string,
    connectionId: string,
    eventId: string,
    ttlSeconds: number = this.DEFAULT_DONE_TTL,
  ): Promise<void> {
    const key = this.getDedupKey(provider, connectionId, eventId);

    try {
      // SET key "done" XX EX ttlSeconds
      // XX = only set if key exists (should be in "processing" state)
      // Returns "OK" if set, null if key doesn't exist
      const result = await this.redisClient.set(key, 'done', {
        XX: true,
        EX: ttlSeconds,
      });

      if (result === 'OK') {
        this.logger.debug(`Marked webhook as done: ${provider}:${connectionId}:${eventId}`);
      } else {
        // Key doesn't exist - this shouldn't happen if markProcessing was called first
        this.logger.warn(
          `Attempted to mark done but key doesn't exist: ${provider}:${connectionId}:${eventId}`,
        );
        // Still set it as done (might have expired or been cleared)
        await this.redisClient.set(key, 'done', {
          EX: ttlSeconds,
        });
      }
    } catch (error) {
      // Non-fatal: log but don't throw (per plan requirements)
      this.logger.warn(
        `Failed to mark webhook as done (non-fatal): ${provider}:${connectionId}:${eventId}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Don't throw - event is already published, this is just cleanup
    }
  }

  async clearProcessing(
    provider: string,
    connectionId: string,
    eventId: string,
  ): Promise<void> {
    const key = this.getDedupKey(provider, connectionId, eventId);

    try {
      await this.redisClient.del(key);
      this.logger.debug(`Cleared processing marker: ${provider}:${connectionId}:${eventId}`);
    } catch (error) {
      this.logger.error(
        `Failed to clear processing marker: ${provider}:${connectionId}:${eventId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}






