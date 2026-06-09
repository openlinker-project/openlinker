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
import type { IWebhookAuthService } from '../interfaces/webhook-auth.service.interface';
import { WebhookAuthenticationException } from '../errors/webhook-authentication.exception';
import { WebhookReplayException } from '../errors/webhook-replay.exception';
import { Logger } from '@openlinker/shared/logging';

/**
 * Replay-window bounds (#711). The window is the maximum clock-skew tolerated
 * between sender and receiver before a webhook is rejected. Tighter is more
 * secure; too tight breaks legitimate webhooks under NTP drift or load-balancer
 * delays. The 120s default is the conservative midpoint for unknown OSS-launch
 * topologies; operators with stable clock-sync can tighten via the env var.
 */
const DEFAULT_SKEW_WINDOW_MS = 120 * 1000; // 120 seconds
const MIN_SKEW_WINDOW_MS = 1 * 1000; // 1 second — below would reject legitimate traffic
const MAX_SKEW_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — pre-#711 default; the safety ceiling

function resolveSkewWindowMs(envValue: string | undefined, logger: Logger): number {
  if (envValue === undefined) {
    return DEFAULT_SKEW_WINDOW_MS;
  }
  const parsed = Number.parseInt(envValue, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warn(
      `OL_WEBHOOK_SKEW_WINDOW_MS="${envValue}" is not a positive integer; falling back to default ${DEFAULT_SKEW_WINDOW_MS}ms.`
    );
    return DEFAULT_SKEW_WINDOW_MS;
  }
  if (parsed < MIN_SKEW_WINDOW_MS) {
    logger.warn(
      `OL_WEBHOOK_SKEW_WINDOW_MS=${parsed} below floor; clamping to ${MIN_SKEW_WINDOW_MS}ms.`
    );
    return MIN_SKEW_WINDOW_MS;
  }
  if (parsed > MAX_SKEW_WINDOW_MS) {
    logger.warn(
      `OL_WEBHOOK_SKEW_WINDOW_MS=${parsed} above ceiling; clamping to ${MAX_SKEW_WINDOW_MS}ms.`
    );
    return MAX_SKEW_WINDOW_MS;
  }
  return parsed;
}

@Injectable()
export class WebhookAuthService implements IWebhookAuthService {
  private readonly logger = new Logger(WebhookAuthService.name);
  private readonly DEFAULT_SKEW_WINDOW_MS: number;

  constructor(
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly secretProvider: WebhookSecretProviderPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort
  ) {
    this.DEFAULT_SKEW_WINDOW_MS = resolveSkewWindowMs(
      process.env.OL_WEBHOOK_SKEW_WINDOW_MS,
      this.logger
    );
  }

  /**
   * Provider-agnostic connection gate (ADR-021): the connection must exist, be
   * active, and its `platformType` must match the URL `provider`. Extracted out
   * of `verifySignature` so the host runs it for every provider before handing
   * off to that provider's decoder. Throws `WebhookAuthenticationException`.
   */
  async assertConnectionUsable(provider: string, connectionId: string): Promise<void> {
    const connection = await this.connectionPort.get(connectionId);
    if (connection.status !== 'active') {
      throw new WebhookAuthenticationException(
        `Connection ${connectionId} is not active (status: ${connection.status})`,
        provider,
        connectionId
      );
    }
    if (connection.platformType !== provider) {
      throw new WebhookAuthenticationException(
        `Provider mismatch: expected ${connection.platformType}, got ${provider}`,
        provider,
        connectionId
      );
    }
  }

  /** Resolve the per-connection webhook shared secret (handed to the decoder). */
  async getSecret(provider: string, connectionId: string): Promise<string> {
    return this.secretProvider.getSecret(provider, connectionId);
  }

  async verifySignature(
    provider: string,
    connectionId: string,
    timestamp: string,
    rawBody: Buffer,
    signature: string
  ): Promise<boolean> {
    try {
      // Validate signature format: sha256=<hex>
      if (!signature.startsWith('sha256=')) {
        throw new WebhookAuthenticationException(
          `Invalid signature format. Expected 'sha256=<hex>', got: ${signature.substring(0, 20)}...`,
          provider,
          connectionId
        );
      }

      const signatureHex = signature.substring(7); // Remove 'sha256=' prefix

      // Validate hex format
      if (!/^[0-9a-f]{64}$/i.test(signatureHex)) {
        throw new WebhookAuthenticationException(
          'Invalid signature format. Expected 64-character hex string',
          provider,
          connectionId
        );
      }

      // Validate connection exists, is active, and matches the provider.
      await this.assertConnectionUsable(provider, connectionId);

      // Get webhook secret
      const secret = await this.secretProvider.getSecret(provider, connectionId);

      // Build signed payload: timestamp + '.' + rawBody
      const signedPayload = Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), rawBody]);

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
        error instanceof Error ? error.stack : String(error)
      );

      throw new WebhookAuthenticationException(
        `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        provider,
        connectionId
      );
    }
  }

  validateTimestamp(
    timestamp: string,
    skewWindowMs: number = this.DEFAULT_SKEW_WINDOW_MS
  ): boolean {
    // Validate timestamp format (should be numeric string), then delegate the
    // window check to the normalized-ms path so both the OL-string and the
    // per-provider epoch-ms callers share one replay rule (ADR-021).
    const timestampNum = Number.parseInt(timestamp, 10);
    if (Number.isNaN(timestampNum) || timestampNum <= 0) {
      throw new WebhookReplayException(
        `Invalid timestamp format: ${timestamp}`,
        timestamp,
        skewWindowMs
      );
    }
    this.validateTimestampMs(timestampNum, skewWindowMs);
    return true;
  }

  /**
   * Replay-window check on an already-normalized epoch-ms timestamp (ADR-021).
   * The per-provider decoder returns this from `verify` (it owns the provider's
   * timestamp header/format); the host applies the shared window here. Throws
   * `WebhookReplayException` when outside the window.
   */
  validateTimestampMs(
    timestampMs: number,
    skewWindowMs: number = this.DEFAULT_SKEW_WINDOW_MS
  ): void {
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      throw new WebhookReplayException(
        `Invalid timestamp: ${timestampMs}`,
        String(timestampMs),
        skewWindowMs
      );
    }
    const timeDiff = Math.abs(Date.now() - timestampMs);
    if (timeDiff > skewWindowMs) {
      throw new WebhookReplayException(
        `Timestamp outside allowed window. Difference: ${timeDiff}ms, allowed: ±${skewWindowMs}ms`,
        String(timestampMs),
        skewWindowMs
      );
    }
  }
}
