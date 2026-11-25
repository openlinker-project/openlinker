/**
 * Orders import run helpers (#4228)
 *
 * The one place that decides what a `marketplace.orders.import` job looks like
 * on the wire and how a run is told apart from the next one. Shared by the
 * ingestion service (the first-poll seed) and the manual import route, so the
 * two cannot drift on the dedupe key shape.
 *
 * Pure-rule exception (`docs/engineering-standards.md`): these functions ARE the
 * rule for the run id and the dedupe key.
 *
 * @module domain/types
 */

import { randomBytes } from 'node:crypto';
import type { MarketplaceOrdersImportPayloadV1 } from './marketplace-job-payloads.types';

const NONCE_RANDOM_LENGTH = 6;
const NONCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A short per-run token. Without it two runs that start from the same position
 * (a restart with an unchanged shop head) share a run id, so the dedupe key of
 * page 1 swallows the second run and the operator sees a success that did
 * nothing. A retry after a crash mints a new nonce too, which is harmless:
 * the per-order dedupe key makes a repeated chain idempotent.
 */
export function generateOrdersImportNonce(now: Date = new Date()): string {
  const bytes = randomBytes(NONCE_RANDOM_LENGTH);
  let random = '';
  for (const byte of bytes) {
    random += NONCE_ALPHABET[byte % NONCE_ALPHABET.length];
  }
  return `${now.getTime().toString(36)}${random}`;
}

/** The enqueue request of one import page; the dedupe key scopes it to a run and a page. */
export function buildOrdersImportRequest(
  connectionId: string,
  payload: MarketplaceOrdersImportPayloadV1
): {
  type: 'marketplace.orders.import';
  connectionId: string;
  payload: Record<string, unknown>;
  options: { dedupeKey: string };
} {
  return {
    type: 'marketplace.orders.import',
    connectionId,
    // Spread: an interface is not assignable to an index-signature type, its copy is.
    payload: { ...payload },
    options: {
      dedupeKey: `marketplace:${connectionId}:orders-import:${payload.runId}:${payload.page}`,
    },
  };
}
