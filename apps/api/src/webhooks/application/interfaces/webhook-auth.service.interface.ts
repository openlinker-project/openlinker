/**
 * Webhook Authentication Service Interface
 *
 * Defines the contract for webhook signature verification and replay protection.
 * Implemented by WebhookAuthService to provide authentication capabilities for
 * inbound webhook requests.
 *
 * @module apps/api/src/webhooks/application/interfaces
 * @see {@link WebhookAuthService} for the implementation
 */

export interface IWebhookAuthService {
  /**
   * Provider-agnostic connection gate (ADR-021): the connection must exist, be
   * active, and its `platformType` must match the URL `provider`. The host runs
   * this for every provider before handing off to that provider's decoder.
   *
   * @throws WebhookAuthenticationException if the connection is missing/inactive
   *   or the provider doesn't match
   */
  assertConnectionUsable(provider: string, connectionId: string): Promise<void>;

  /** Resolve the per-connection webhook shared secret (handed to the decoder). */
  getSecret(provider: string, connectionId: string): Promise<string>;

  /**
   * Replay-window check on an already-normalized epoch-ms timestamp (ADR-021).
   * The per-provider decoder owns the provider's timestamp header/format and
   * returns the normalized value from `verify`; the host applies the shared
   * window here.
   *
   * @throws WebhookReplayException if the timestamp is outside the allowed window
   */
  validateTimestampMs(timestampMs: number, skewWindowMs?: number): void;
}

