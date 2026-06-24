/**
 * Subiekt Transport Retryability (#753)
 *
 * The fiscal-safety classification of a bridge transport failure. Lives in a
 * dedicated `*.types.ts` (per engineering-standards) because it is shared by
 * the transport exception, the HTTP client, and the invoicing adapter:
 *   - `'safe'`:          the transport PROVED the request never left the host
 *                        (connect-refused / DNS-failure). Auto-retry cannot
 *                        double-issue a fiscal document. Assigned ONLY for
 *                        `ECONNREFUSED` / `ENOTFOUND` / `EAI_AGAIN`.
 *   - `'indeterminate'`: the POST may have been received and acted on by the
 *                        bridge (timeout, connection-reset, undici errors, 5xx,
 *                        or any unrecognised code). The fiscal-safe DEFAULT —
 *                        NEVER auto-retry until the bridge guarantees
 *                        idempotency-key dedup (#752).
 *
 * @module libs/integrations/subiekt/src/domain/types
 */

export type SubiektTransportRetryability = 'safe' | 'indeterminate';
