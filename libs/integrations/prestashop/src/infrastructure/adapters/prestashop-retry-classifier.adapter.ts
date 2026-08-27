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
 * Kept deliberately narrow: the registry ORs every registered classifier's
 * answer, so a broad `instanceof PrestashopApiException` rule here would make
 * transient PrestaShop failures terminal across every PrestaShop job type, not
 * just the order path.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { PrestashopTaxRateUnknownException } from '../../domain/exceptions/prestashop-tax-rate-unknown.exception';
import { PrestashopCurrencyUnknownException } from '../../domain/exceptions/prestashop-currency-unknown.exception';
import { PrestashopInvalidFilterException } from '../../domain/exceptions/prestashop-invalid-filter.exception';
import { PrestashopTruncatedReadException } from '../../domain/exceptions/prestashop-truncated-read.exception';

export class PrestashopRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof PrestashopTaxRateUnknownException ||
      cause instanceof PrestashopCurrencyUnknownException ||
      cause instanceof PrestashopInvalidFilterException ||
      cause instanceof PrestashopTruncatedReadException
    );
  }
}
