/**
 * Webhook Authentication Service
 *
 * The host-side auth helpers for inbound webhook ingestion (ADR-021): the
 * provider-agnostic connection gate (`assertConnectionUsable`), per-connection
 * secret resolution (`getSecret`), and the shared replay-window check
 * (`validateTimestampMs`). Signature verification itself lives in each
 * provider's `InboundWebhookDecoderPort` (the OL-HMAC default in
 * `DefaultWebhookDecoder`), which this service feeds the secret.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookAuthService}
 */
import { Injectable, Inject } from '@nestjs/common';
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
   * active, and its `platformType` must match the URL `provider`. The host runs
   * it for every provider before handing off to that provider's decoder
   * (which owns signature verification). Throws `WebhookAuthenticationException`.
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
