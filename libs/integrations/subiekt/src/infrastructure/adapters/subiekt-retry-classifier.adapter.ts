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
 * This classifier recognises ONLY Subiekt-owned exception types. The sync
 * runner aggregates every plugin's classifier OR-across-all with no platform
 * scoping (`RetryClassifierRegistryService.isNonRetryable`), so a catch-all
 * `return true` here would mark EVERY sibling plugin's transient error (a failed
 * Allegro 5xx, an Erli network blip, a PrestaShop timeout) non-retryable. We
 * therefore mirror `ErliRetryClassifierAdapter` / `AllegroRetryClassifierAdapter`
 * and return `false` for anything we do not own. The fiscal-safe "unknown ->
 * non-retryable" intent is preserved LOCALLY: `SubiektInvoicingAdapter`
 * wraps genuinely-unknown throwables into a Subiekt-typed `'indeterminate'`
 * `SubiektBridgeTransportError`, which this classifier then recognises.
 *
 * Non-retryable (`true`) — the fiscal-safe default for our OWN proven-terminal
 * and not-proven-safe errors:
 *   - `SubiektInvoiceRejectedError` — TERMINAL business rejection; the same
 *     input will be rejected again, so retrying burns capacity.
 *   - `SubiektUnsupportedDocumentTypeError` — TERMINAL caller contract
 *     violation; deterministic, never resolves on retry.
 *   - `SubiektConfigException` — deterministic config / SSRF-guard failure
 *     raised before any request leaves the client; re-throws every attempt.
 *   - `SubiektOrderProductMappingException` — the product has no Subiekt
 *     catalogue mapping on this connection; retrying re-reads the same
 *     `identifier_mappings` row and gets the same answer.
 *   - `SubiektOrderKeyMissingException` — the request carried no order key, so
 *     the create cannot be serialized or deduped and is refused.
 *   - `SubiektNetPricedOrderException` — the order's source reports net line
 *     prices, which is a property of the order; every retry refuses again.
 *   - `SubiektRejectedError` — the bridge's own business refusal, raw. It
 *     reaches the runner unwrapped from every adapter that does not translate
 *     it, and a retry re-asks a question whose answer lives in the Subiekt
 *     database.
 *   - `SubiektBridgeAuthError` — TERMINAL bridge auth/config failure (401/403);
 *     a retry with the same bad credentials fails identically, and re-issuing
 *     on a credential fix is a human action, not an auto-retry.
 *   - `SubiektBridgeTransportError` with `retryability === 'indeterminate'` —
 *     FISCAL-SAFETY PIVOT. The POST may have been received and acted on by the
 *     bridge, so an auto-retry risks DOUBLE-ISSUING a fiscal document. It is
 *     classified non-retryable until the bridge guarantees idempotency-key
 *     dedup (#752); only then may this branch flip.
 *
 * Retryable (`false`):
 *   - `SubiektBridgeTransportError` with `retryability === 'safe'` — the
 *     transport PROVED the request never left the host (connect-refused /
 *     DNS-failure), so a retry cannot double-issue.
 *   - anything NOT Subiekt-owned — another plugin owns it; we abstain so the
 *     runner's OR-aggregation isn't polluted by a foreign catch-all.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { SubiektInvoiceRejectedError } from '../../domain/exceptions/subiekt-invoice-rejected.exception';
import { SubiektUnsupportedDocumentTypeError } from '../../domain/exceptions/subiekt-unsupported-document-type.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { SubiektOrderProductMappingException } from '../../domain/exceptions/subiekt-order-product-mapping.exception';
import { SubiektNetPricedOrderException } from '../../domain/exceptions/subiekt-net-priced-order.exception';
import { SubiektOrderKeyMissingException } from '../../domain/exceptions/subiekt-order-key-missing.exception';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektBridgeTransportError } from '../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektRejectedError } from '../../bridge/subiekt-bridge.errors';

export class SubiektRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (cause instanceof SubiektBridgeTransportError) {
      // FISCAL-SAFETY PIVOT: ONLY a PROVEN-safe transport failure is retryable;
      // an 'indeterminate' one is non-retryable to avoid a double-issued
      // fiscal document (see the exception docblock and #752).
      return cause.retryability !== 'safe';
    }
    // Known-terminal Subiekt errors are non-retryable.
    if (
      cause instanceof SubiektInvoiceRejectedError ||
      cause instanceof SubiektUnsupportedDocumentTypeError ||
      cause instanceof SubiektConfigException ||
      cause instanceof SubiektBridgeAuthError ||
      // A product with no Subiekt catalogue mapping on this connection is a
      // CONFIGURATION fact, not a transient one: every retry re-runs the same
      // `identifier_mappings` lookup and gets the same answer, so without this
      // the order spent the full ladder (~10 attempts, backing off to 6h) over
      // roughly two days before dead-lettering — turning "this product isn't
      // mapped" into a silent two-day disappearance. Terminal instead, so the
      // operator sees a failed job naming the product straight away.
      cause instanceof SubiektOrderProductMappingException ||
      // The source's tax treatment is a property of the order itself, so every
      // retry re-reads the same value and reaches the same refusal.
      cause instanceof SubiektNetPricedOrderException ||
      // A request that arrived with no order key will arrive with none on
      // every retry, and creating without one is what the refusal exists to
      // prevent - so spending the ladder here would end in a dead job having
      // risked nothing and proved nothing.
      cause instanceof SubiektOrderKeyMissingException ||
      // #3365 review: the RAW bridge refusal, which reaches the runner
      // unwrapped from every path that does not translate it. The invoicing
      // adapter maps it to `SubiektInvoiceRejectedError` (listed above) and is
      // therefore covered, but the product, inventory and order-processor
      // adapters catch it only to test for specific conditions and let anything
      // else propagate as-is - so a plain business refusal ("towar nie
      // istnieje", "dokument zablokowany") spent the full ladder, ~10 attempts
      // backing off to 6h, re-asking a question whose answer is a property of
      // the Subiekt database. It is terminal by definition: the bridge answered,
      // and it answered no.
      cause instanceof SubiektRejectedError
    ) {
      return true;
    }
    // Anything we do not own belongs to another plugin: abstain (`false`). The
    // runner OR-aggregates classifiers with no platform scoping, so a catch-all
    // `true` here would turn sibling plugins' transient errors terminal. The
    // fiscal-safe "unknown -> non-retryable" default is enforced upstream:
    // SubiektInvoicingAdapter wraps unknown throwables into a Subiekt-typed
    // 'indeterminate' SubiektBridgeTransportError, handled above.
    return false;
  }
}
