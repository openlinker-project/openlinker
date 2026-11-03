/**
 * Deterministic Document-Token Policy
 *
 * THE reason `FiscalRegistrationLocator` is implementable against this vendor.
 *
 * The vendor's only document read is `GET /documents/{documentToken}/status` -
 * a PATH key. It publishes no search by order id, by merchant document id or by
 * idempotency key, so after an indeterminate call an integrator that let the
 * vendor mint the token holds nothing to look the registration up by, which is
 * precisely the state ADR-042 decision 7 says must never be resolved by a blind
 * resend.
 *
 * `CreateDocumentPayload.documentToken` is an OPTIONAL caller-supplied UUIDv4.
 * So the adapter derives it - and the `transactionToken` the vendor then also
 * requires - from `(connectionId, idempotencyKey)`. Same inputs, same token,
 * forever: a later `locateByQuery({ idempotencyKey })` re-derives the token and
 * reads the real outcome straight from the vendor.
 *
 * Derivation is a namespaced SHA-256 digest shaped into the UUID text form with
 * the version and variant bits set. It is NOT a cryptographic commitment and
 * carries no secret - it only has to be deterministic, collision-resistant
 * across connections, and syntactically a UUIDv4.
 *
 * TWO KEYS, TWO JOBS (and why the second is NOT the token). The vendor dedupes
 * on two separate things:
 *
 *   - the `documentToken` in the BODY: one document per token, ever. A create
 *     under a token it already holds is refused with `errorCode: 118`, which the
 *     adapters resolve by reading that document. THIS is the exactly-once
 *     guarantee - one sale, one token, one document - and it stays stable per
 *     sale across every attempt.
 *   - the `Idempotency-Key` HEADER: a request-replay guard. Repeating a key with
 *     the same body replays the first answer; repeating it with a DIFFERENT body
 *     is refused with `422`. The vendor remembers the key even when the first
 *     request was REFUSED, so a header equal to the token turned every
 *     corrected retry after a rejection into a `422` - observed live, where
 *     fixing a refused seller tax number could never succeed on that record.
 *
 * So the header is derived from the token PLUS a digest of the exact body
 * ({@link deriveRequestIdempotencyKey}): a transport-level retry of one request
 * replays under the same key (same body), while a corrected request is a new
 * request under a new key and still meets the token's own guard. Nothing about
 * exactly-once moved - it never rested on the header, which cannot see a
 * document created by an earlier request under a different key anyway.
 *
 * Pure - no I/O beyond `node:crypto`'s synchronous hash.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */
import { createHash } from 'node:crypto';

/**
 * Namespaces keep the two tokens distinct for one registration. The vendor
 * rejects a document whose token collides with an existing one, and a
 * transaction may legitimately carry several documents, so they must not be
 * derived from the same digest.
 */
const DOCUMENT_NAMESPACE = 'openlinker:eparagony:document:v1';
const TRANSACTION_NAMESPACE = 'openlinker:eparagony:transaction:v1';
const REQUEST_NAMESPACE = 'openlinker:eparagony:request:v1';

/** Stable `documentToken` for one (connection, idempotency key) registration. */
export function deriveDocumentToken(connectionId: string, idempotencyKey: string): string {
  return deriveUuid(DOCUMENT_NAMESPACE, connectionId, idempotencyKey);
}

/** Stable `transactionToken` for the same registration. */
export function deriveTransactionToken(connectionId: string, idempotencyKey: string): string {
  return deriveUuid(TRANSACTION_NAMESPACE, connectionId, idempotencyKey);
}

/**
 * The vendor `Idempotency-Key` header for ONE create request: the document's
 * token plus a digest of the exact body sent. UUID-shaped, so it satisfies the
 * vendor's `/^[0-9A-Za-z_-]+$/` header rule. See the module header for why it
 * must differ from the token.
 *
 * `JSON.stringify` is the body's own serialisation and the mappers build each
 * body in a fixed key order, so the same request always digests the same; were
 * that ever to drift, the cost is only a fresh key, which the token still
 * guards.
 */
export function deriveRequestIdempotencyKey(documentToken: string, body: unknown): string {
  const bodyDigest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return deriveUuid(REQUEST_NAMESPACE, documentToken, bodyDigest);
}

function deriveUuid(namespace: string, first: string, second: string): string {
  // A NUL byte separates the parts so no pair of inputs can be re-segmented
  // into a different pair with the same concatenation.
  const digest = createHash('sha256').update(`${namespace}\0${first}\0${second}`).digest();

  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  // RFC 4122: version 4 in the high nibble of byte 6, variant 10xx in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
