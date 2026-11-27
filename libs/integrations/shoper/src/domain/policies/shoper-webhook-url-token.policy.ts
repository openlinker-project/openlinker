/**
 * Shoper Webhook URL Token Policy
 *
 * Pure rule for the token OpenLinker puts in a Shoper delivery URL
 * (`?token=<urlToken>`). Shared by the webhook provisioner (which writes the
 * URL) and the inbound decoder (which checks it), so the two cannot drift.
 *
 * The per-connection secret is Shoper's SIGNING key (`x-webhook-sha1`). It must
 * not appear in the URL: the Shoper admin panel lists every webhook URL in plain
 * text, and the URL also lands in reverse-proxy / CDN / tunnel access logs, so a
 * URL carrying the secret hands anyone who reads it the means to forge a
 * correctly signed delivery. The URL therefore carries a one-way derivative of
 * the secret instead: knowing the URL token lets nobody compute the secret, while
 * the decoder, which holds the secret, recomputes the token to check it.
 *
 * @module libs/integrations/shoper/src/domain/policies
 */
import { createHmac } from 'node:crypto';

import { SHOPER_WEBHOOK_URL_TOKEN_LABEL } from '../types/shoper-webhook.types';

/** The URL token for a webhook secret: `hex(HMAC-SHA256(key = secret, message = label))`. */
export function deriveShoperWebhookUrlToken(secret: string): string {
  return createHmac('sha256', secret).update(SHOPER_WEBHOOK_URL_TOKEN_LABEL).digest('hex');
}
