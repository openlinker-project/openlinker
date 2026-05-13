/**
 * Webhook Authentication Service
 *
 * Implements webhook signature verification and replay protection. Validates
 * HMAC SHA256 signatures and enforces timestamp-based replay protection to
 * prevent replay attacks.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookAuthService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import { WEBHOOK_SECRET_PROVIDER_TOKEN } from '@openlinker/core/integrations';
import { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import { IWebhookAuthService } from '../interfaces/webhook-auth.service.interface';
import { WebhookAuthenticationException } from '../errors/webhook-authentication.exception';
import { WebhookReplayException } from '../errors/webhook-replay.exception';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class WebhookAuthService implements IWebhookAuthService {
  private readonly logger = new Logger(WebhookAuthService.name);
  private readonly DEFAULT_SKEW_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly secretProvider: WebhookSecretProviderPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
  ) {}

  async verifySignature(
    provider: string,
    connectionId: string,
    timestamp: string,
    rawBody: Buffer,
    signature: string,
  ): Promise<boolean> {
    try {
      // Validate signature format: sha256=<hex>
      if (!signature.startsWith('sha256=')) {
        throw new WebhookAuthenticationException(
          `Invalid signature format. Expected 'sha256=<hex>', got: ${signature.substring(0, 20)}...`,
          provider,
          connectionId,
        );
      }

      const signatureHex = signature.substring(7); // Remove 'sha256=' prefix

      // Validate hex format
      if (!/^[0-9a-f]{64}$/i.test(signatureHex)) {
        throw new WebhookAuthenticationException(
          'Invalid signature format. Expected 64-character hex string',
          provider,
          connectionId,
        );
      }

      // Validate connection exists and is active (fail fast before HMAC)
      const connection = await this.connectionPort.get(connectionId);
      if (connection.status !== 'active') {
        throw new WebhookAuthenticationException(
          `Connection ${connectionId} is not active (status: ${connection.status})`,
          provider,
          connectionId,
        );
      }

      // Validate provider matches connection platformType
      if (connection.platformType !== provider) {
        throw new WebhookAuthenticationException(
          `Provider mismatch: expected ${connection.platformType}, got ${provider}`,
          provider,
          connectionId,
        );
      }

      // Get webhook secret
      const secret = await this.secretProvider.getSecret(provider, connectionId);

      // Build signed payload: timestamp + '.' + rawBody
      const signedPayload = Buffer.concat([
        Buffer.from(timestamp),
        Buffer.from('.'),
        rawBody,
      ]);

      // Compute expected signature
      const hmac = createHmac('sha256', secret);
      hmac.update(signedPayload);
      const expectedSignature = hmac.digest('hex');

      // Constant-time comparison to prevent timing attacks
      const providedSignatureBuffer = Buffer.from(signatureHex, 'hex');
      const expectedSignatureBuffer = Buffer.from(expectedSignature, 'hex');

      // Ensure buffers are same length (should always be 32 bytes for SHA256)
      if (providedSignatureBuffer.length !== expectedSignatureBuffer.length) {
        this.logger.warn(`Signature length mismatch for ${provider}:${connectionId}`);
        return false;
      }

      const isValid = timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer);

      if (!isValid) {
        this.logger.warn(`Invalid signature for webhook ${provider}:${connectionId}`);
      }

      return isValid;
    } catch (error) {
      if (error instanceof WebhookAuthenticationException) {
        throw error;
      }

      this.logger.error(
        `Signature verification error for ${provider}:${connectionId}`,
        error instanceof Error ? error.stack : String(error),
      );

      throw new WebhookAuthenticationException(
        `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        provider,
        connectionId,
      );
    }
  }

  validateTimestamp(timestamp: string, skewWindowMs: number = this.DEFAULT_SKEW_WINDOW_MS): boolean {
    try {
      // Validate timestamp format (should be numeric string)
      const timestampNum = Number.parseInt(timestamp, 10);
      if (Number.isNaN(timestampNum) || timestampNum <= 0) {
        throw new WebhookReplayException(
          `Invalid timestamp format: ${timestamp}`,
          timestamp,
          skewWindowMs,
        );
      }

      // Get current time
      const now = Date.now();
      const timestampMs = timestampNum;

      // Calculate time difference
      const timeDiff = Math.abs(now - timestampMs);

      // Check if within skew window
      if (timeDiff > skewWindowMs) {
        throw new WebhookReplayException(
          `Timestamp outside allowed window. Difference: ${timeDiff}ms, allowed: ±${skewWindowMs}ms`,
          timestamp,
          skewWindowMs,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof WebhookReplayException) {
        throw error;
      }

      throw new WebhookReplayException(
        `Timestamp validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp,
        skewWindowMs,
      );
    }
  }
}
