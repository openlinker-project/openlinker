/**
 * PrestaShop Retry Classifier Adapter
 *
 * Implements `RetryClassifierPort` (#581) for the PrestaShop platform — answers
 * the worker runner's "is this error non-retryable?" question for PrestaShop's
 * own exception hierarchy. Self-registered by `createPrestashopPlugin().register`
 * against `RetryClassifierRegistryService`, alongside the adapter factory and
 * connection tester. Until #2052 the package registered none, so every
 * PrestaShop failure was retryable by default.
 *
 * Non-retryable (return `true`):
 *   - `PrestashopTaxRateUnknownException` — the shop's tax record is incomplete
 *     (a tax carrying no rate, or an unusable one). The reads SUCCEEDED and
 *     reported unusable data, so every retry re-reads the same record and fails
 *     identically; burning five attempts with backoff only delays the moment an
 *     operator sees the message that tells them what to fix.
 *   - `PrestashopCurrencyUnknownException` (#2139) - the order's currency cannot
 *     be denominated at the destination: the source order carries no currency
 *     code, the shop has no currency row for its ISO code, or the matching row's
 *     id is unusable. Same reasoning as above - nothing about the order or the
 *     shop changes between attempts, so the answer is identical every time.
 *   - `PrestashopInvalidFilterException` (#2616) - a custom filter key the
 *     WebService cannot express. Every key in the package is a source literal,
 *     so the malformed key is a programming error that re-sends unchanged: the
 *     retry ladder can only delay the report by its full backoff.
 *   - `PrestashopTruncatedReadException` (#2608) - a paged collection read filled
 *     its whole page budget without reaching the end. The collection does not
 *     shrink because a job retried, so every attempt reads the same pages and
 *     refuses identically; the operator needs the message, not the backoff.
 *   - `PrestashopPackFilterIgnoredException` (#2598) - the pack component stock
 *     read answered a shape its OR filter cannot produce. The shop parses the
 *     same filter the same way on every attempt, so retrying only delays the
 *     report.
 *
 * Neither of the first two reaches this classifier on the shipped ORDER-CREATE
 * path today, so the "attempts" above describe what retrying would cost, not what
 * currently happens: `OrderSyncService` reduces a per-destination `createOrder`
 * rejection to its message under `Promise.allSettled`, and `OrderIngestionService`
 * records that message without rethrowing - the job succeeds and the runner never
 * asks. Both registrations are kept because the classification is correct by
 * construction and is already right for the day the failure does propagate; the
 * value they carry unconditionally is on the message, not on the retry count.
 * `PrestashopInvalidFilterException` is different: it is raised by the query
 * builder on EVERY PrestaShop read, so it does propagate out of a job today.
 *
 * Retryable, deliberately left out (return `false`):
 *   - `PrestashopApiException` — a failed CALL, including the transport failure
 *     of the very same tax-rate or `GET /currencies` read (5xx / timeout /
 *     connection reset). These do fix themselves and MUST keep their retries.
 *     This is why an unresolvable tax rate or currency raises two different
 *     classes rather than one class with a flag: the class IS the retry decision.
 *   - `PrestashopAuthenticationException` — routed through the separate
 *     auth-failure classifier (#819 / ADR-008), which flips the connection to
 *     `needs_reauth`; classifying it here as well would pre-empt that path.
 *   - Anything not recognized — default-retryable.
 *
 * Deferred rather than retried (#2613) - `getRetryDeferral` reports a
 * penalty-free requeue, so the attempt counter does not move and a long
 * outage cannot walk a job to `dead`:
 *   - `429` - the shop is throttling US. The client has already spent its own
 *     internal retries on it, so a further attempt penalty would double-count
 *     the same fact. `Retry-After` wins when the shop sent one, floored so a
 *     deferral can never come back sooner than the runner's own first backoff
 *     would have. PrestaShop core sends no such header; a fronting proxy does.
 *   - `503` - the shop is unavailable for reasons that have nothing to do with
 *     our rate. A maintenance window used to burn every attempt of every job
 *     touching that shop, so a twenty-minute upgrade moved live work to `dead`
 *     while nothing was broken. It waits instead, on a longer delay than a
 *     throttle since maintenance is measured in minutes, not seconds.
 *
 * Both stay RETRYABLE - `isNonRetryable` still answers `false` for them, so
 * nothing here can terminalise a transient failure. The two codes are told
 * apart in the job record by the deferral reason the runner prefixes onto the
 * persisted error, which is what makes a maintenance window readable as such.
 * The accepted cost is that a shop returning 503 forever never reaches `dead`;
 * that is the same property the pre-existing `RateLimitTimeoutError` requeue
 * has, and the alternative - a budget - kills exactly the jobs an operator
 * wants waiting for the shop to come back.
 *
 * Kept deliberately narrow: the registry ORs every registered classifier's
 * answer, so a broad `instanceof PrestashopApiException` rule here would make
 * transient PrestaShop failures terminal across every PrestaShop job type, not
 * just the order path.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort, RetryDeferral } from '@openlinker/core/sync';
import { PrestashopApiException } from '../../domain/exceptions/prestashop-api.exception';
import { PrestashopTaxRateUnknownException } from '../../domain/exceptions/prestashop-tax-rate-unknown.exception';
import { PrestashopCurrencyUnknownException } from '../../domain/exceptions/prestashop-currency-unknown.exception';
import { PrestashopOrderStateUnresolvedException } from '../../domain/exceptions/prestashop-order-state-unresolved.exception';
import { PrestashopInvalidFilterException } from '../../domain/exceptions/prestashop-invalid-filter.exception';
import { PrestashopTruncatedReadException } from '../../domain/exceptions/prestashop-truncated-read.exception';
import { PrestashopPackFilterIgnoredException } from '../../domain/exceptions/prestashop-pack-filter-ignored.exception';

/**
 * Floor on any deferral, matching the runner's first backoff step - so routing
 * a code through the penalty-free path can never make it retry FASTER than it
 * did before this classification existed.
 */
const MIN_DEFERRAL_SECONDS = 30;

/** Used when the shop throttled us but named no wait of its own. */
const THROTTLE_DEFAULT_DEFERRAL_SECONDS = 60;

/** A maintenance window is measured in minutes, so a 503 waits longer than a throttle. */
const UNAVAILABLE_DEFERRAL_SECONDS = 300;

export class PrestashopRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof PrestashopTaxRateUnknownException ||
      cause instanceof PrestashopCurrencyUnknownException ||
      // No state on the shop means the requested status (#2607). Retrying
      // cannot add one; only an operator can.
      cause instanceof PrestashopOrderStateUnresolvedException ||
      cause instanceof PrestashopInvalidFilterException ||
      cause instanceof PrestashopTruncatedReadException ||
      cause instanceof PrestashopPackFilterIgnoredException
    );
  }

  getRetryDeferral(cause: unknown): RetryDeferral | null {
    if (!(cause instanceof PrestashopApiException)) {
      return null;
    }

    if (cause.statusCode === 429) {
      return {
        delaySeconds: Math.max(
          cause.retryAfterSeconds ?? THROTTLE_DEFAULT_DEFERRAL_SECONDS,
          MIN_DEFERRAL_SECONDS
        ),
        reason: 'shop rate-limited the request (429)',
      };
    }

    if (cause.statusCode === 503) {
      return {
        delaySeconds: Math.max(
          cause.retryAfterSeconds ?? UNAVAILABLE_DEFERRAL_SECONDS,
          MIN_DEFERRAL_SECONDS
        ),
        reason: 'shop unavailable (503)',
      };
    }

    return null;
  }
}
