/**
 * Subiekt Retry Classifier Adapter (#753)
 *
 * Implements `RetryClassifierPort` for Subiekt — answers the sync runner's "is
 * this error non-retryable?" for Subiekt's exception hierarchy. Registered
 * against `RetryClassifierRegistryService` in `createSubiektPlugin().register`
 * (mirrors `ErliRetryClassifierAdapter`). Without it the runner's default is
 * "retryable", which is fiscally unsafe for an `'indeterminate'` transport
 * failure (see below).
 *
 * Non-retryable (`true`) — the fiscal-safe DEFAULT for anything not proven safe:
 *   - `SubiektInvoiceRejectedError` — TERMINAL business rejection; the same
 *     input will be rejected again, so retrying burns capacity.
 *   - `SubiektUnsupportedDocumentTypeError` — TERMINAL caller contract
 *     violation; deterministic, never resolves on retry.
 *   - `SubiektConfigException` — deterministic config / SSRF-guard failure
 *     raised before any request leaves the client; re-throws every attempt.
 *   - `SubiektBridgeAuthError` — TERMINAL bridge auth/config failure (401/403);
 *     a retry with the same bad credentials fails identically, and re-issuing
 *     on a credential fix is a human action, not an auto-retry.
 *   - `SubiektBridgeTransportError` with `retryability === 'indeterminate'` —
 *     FISCAL-SAFETY PIVOT. The POST may have been received and acted on by the
 *     bridge, so an auto-retry risks DOUBLE-ISSUING a fiscal document. It is
 *     classified non-retryable until the bridge guarantees idempotency-key
 *     dedup (#752); only then may this branch flip.
 *   - anything unrecognized — for a fiscal issuance path the safe default is
 *     NON-RETRYABLE. We cannot prove an unknown throwable never reached Subiekt,
 *     so auto-retrying it risks a double-issued fiscal document.
 *
 * Retryable (`false`) — ONLY the proven-safe transport phase:
 *   - `SubiektBridgeTransportError` with `retryability === 'safe'` — the
 *     transport PROVED the request never left the host (connect-refused /
 *     DNS-failure), so a retry cannot double-issue.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { SubiektInvoiceRejectedError } from '../../domain/exceptions/subiekt-invoice-rejected.exception';
import { SubiektUnsupportedDocumentTypeError } from '../../domain/exceptions/subiekt-unsupported-document-type.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektBridgeTransportError } from '../../domain/exceptions/subiekt-bridge-transport.exception';

export class SubiektRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (cause instanceof SubiektBridgeTransportError) {
      // FISCAL-SAFETY PIVOT: ONLY a PROVEN-safe transport failure is retryable;
      // an 'indeterminate' one is non-retryable to avoid a double-issued
      // fiscal document (see the exception docblock and #752).
      return cause.retryability !== 'safe';
    }
    // Known-terminal Subiekt errors are non-retryable...
    if (
      cause instanceof SubiektInvoiceRejectedError ||
      cause instanceof SubiektUnsupportedDocumentTypeError ||
      cause instanceof SubiektConfigException ||
      cause instanceof SubiektBridgeAuthError
    ) {
      return true;
    }
    // ...and so is anything unrecognized: on a fiscal issuance path we cannot
    // prove an unknown throwable never reached Subiekt, so the safe default is
    // NON-RETRYABLE (never auto-retry into a possible double-issue).
    return true;
  }
}
