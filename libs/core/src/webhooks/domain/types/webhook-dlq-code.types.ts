/**
 * Webhook dead-letter codes (#3866)
 *
 * Why a verified webhook was dead-lettered at ingress (#2280), as a stable code
 * the frontend renders in the operator's language (ADR-081). The English
 * `dlqReason` keeps the detail (the adapter key, the translator's own error,
 * the ungated domains) for developers; it starts with the code followed by a
 * colon, which is how rows written before the code existed are read back.
 *
 * @module libs/core/src/webhooks/domain/types
 */

export const WebhookDlqCodeValues = [
  /** The connection was deleted or disabled. */
  'connection-unavailable',
  /** The connection's plugin decodes no webhooks (poll-only). */
  'no-translator',
  /** The plugin's translator threw on this payload. */
  'translator-threw',
  /** The translator recognised nothing in this payload. */
  'undecodable',
  /** Every change in the payload needs a capability the connection has not enabled. */
  'ungated',
] as const;

export type WebhookDlqCode = (typeof WebhookDlqCodeValues)[number];

export function isWebhookDlqCode(value: unknown): value is WebhookDlqCode {
  return typeof value === 'string' && (WebhookDlqCodeValues as readonly string[]).includes(value);
}

/**
 * The code a stored `dlqReason` starts with (`<code>: <detail>`), or `null` for
 * an absent reason or one whose prefix this build does not know.
 */
export function readWebhookDlqCode(reason: string | null | undefined): WebhookDlqCode | null {
  if (typeof reason !== 'string') return null;
  const separator = reason.indexOf(':');
  const prefix = (separator < 0 ? reason : reason.slice(0, separator)).trim();
  return isWebhookDlqCode(prefix) ? prefix : null;
}
