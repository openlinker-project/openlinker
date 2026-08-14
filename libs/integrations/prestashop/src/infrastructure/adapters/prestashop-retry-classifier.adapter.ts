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
 *   - `PrestashopConversionRateUnknownException` - the shop's currency
 *     configuration cannot state the order currency's rate against the shop
 *     default (#2102). Same shape as the tax-rate case: the reads succeeded and
 *     reported unusable data, and an operator has to fix the shop's currency
 *     setup before any attempt can differ.
 *
 * Retryable, deliberately left out (return `false`):
 *   - `PrestashopApiException` — a failed CALL, including the transport failure
 *     of the very same tax-rate or currency read (5xx / timeout / connection
 *     reset). These
 *     do fix themselves and MUST keep their retries. This is why an unresolvable
 *     tax rate raises two different classes rather than one class with a flag:
 *     the class IS the retry decision.
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
import { PrestashopConversionRateUnknownException } from '../../domain/exceptions/prestashop-conversion-rate-unknown.exception';
import { PrestashopTaxRateUnknownException } from '../../domain/exceptions/prestashop-tax-rate-unknown.exception';

export class PrestashopRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof PrestashopTaxRateUnknownException ||
      cause instanceof PrestashopConversionRateUnknownException
    );
  }
}
