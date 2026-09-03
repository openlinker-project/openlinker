/**
 * Currency Rate Service
 *
 * Get-or-create against the shared `exchange_rates` registry, which is keyed by
 * `(source, pair, date)` rather than held per order.
 *
 * WHAT THE REGISTRY DOES AND DOES NOT ABSORB - the pre-fetch read is keyed on
 * the day each provider RESOLVES the candidate to, while the write is always
 * keyed on the day the source actually PUBLISHED for, and those are not
 * always the same day:
 *
 *  - Candidate IS a publication day (roughly 5 days in 7). The resolved day
 *    equals the candidate, so five hundred EUR orders carrying that
 *    candidate cost one provider call, not five hundred.
 *  - Candidate is NOT a publication day - a weekend or a holiday, roughly 2
 *    days in 7. The adapter walks back and the row lands under the earlier
 *    published date. As of #2777, a provider that declares the optional
 *    `resolveExpectedPublicationDay` (NBP and ECB both do) lets the pre-fetch
 *    read key on that earlier day directly, so the very first order under a
 *    given non-publication candidate still pays one provider call, but every
 *    later one - for that candidate, or any other candidate resolving to the
 *    same published day - hits the cache instead of repeating the walk-back.
 *    A provider that declares nothing keeps the pre-#2777 behaviour: the
 *    read stays keyed on the candidate, so the row it wants is never found
 *    and every order carrying that candidate pays a live call. The registry
 *    itself never writes a second row under a non-publication date - the
 *    write is always keyed on the source's own answer - so this changes only
 *    which key is READ, never what gets written (ADR-040 verifiability is
 *    untouched).
 *
 * It decides nothing about terminal-versus-retry policy: `RateUnsupportedPairError`
 * and `RateUnavailableTransientError` propagate unchanged, and the stamp
 * service maps them. Keeping the classification in one place is what stops the
 * two halves drifting apart.
 *
 * @module libs/core/src/currency/application/services
 * @implements {ICurrencyRateService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
  EXCHANGE_RATE_REPOSITORY_TOKEN,
} from '../../currency.tokens';
import {
  DuplicateExchangeRateError,
  RateUnsupportedPairError,
} from '../../domain/exceptions/exchange-rate.exception';
import { ExchangeRateProviderRegistryPort } from '../../domain/ports/exchange-rate-provider-registry.port';
import { ExchangeRateRepositoryPort } from '../../domain/ports/exchange-rate-repository.port';
import type { GetRateInput, StoredExchangeRate } from '../../domain/types/exchange-rate.types';
import type { ICurrencyRateService } from '../interfaces/currency-rate.service.interface';

@Injectable()
export class CurrencyRateService implements ICurrencyRateService {
  private readonly logger = new Logger(CurrencyRateService.name);

  constructor(
    @Inject(EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN)
    private readonly registry: ExchangeRateProviderRegistryPort,
    @Inject(EXCHANGE_RATE_REPOSITORY_TOKEN)
    private readonly repository: ExchangeRateRepositoryPort
  ) {}

  async getRateFor(input: GetRateInput): Promise<StoredExchangeRate> {
    // Throws the TERMINAL `UnregisteredExchangeRateSourceError` when the host
    // never registered `FxIntegrationModule` - a wiring fault, not a blip.
    const provider = this.registry.get(input.source);

    if (!provider.supports(input.from, input.to)) {
      // Fail on the first call rather than after a full walk-back: an
      // unsupported pair 404s on every day the adapter would try.
      throw new RateUnsupportedPairError(
        input.source,
        input.from,
        input.to,
        input.rateDate,
        `source '${input.source}' does not quote this pair`
      );
    }

    // ADR-046 probe-not-trust pattern (see description-format-resolution.ts):
    // an out-of-tree provider compiled against an older `libs/core` would
    // satisfy a widened type guard without implementing the method, so this
    // checks for the method itself rather than trusting the type.
    const expectedPublicationDay =
      typeof provider.resolveExpectedPublicationDay === 'function'
        ? provider.resolveExpectedPublicationDay(input.rateDate)
        : input.rateDate;

    const existing = await this.repository.findByKey({ ...input, rateDate: expectedPublicationDay });
    if (existing) {
      return existing;
    }

    const fetched = await provider.fetchRate({
      from: input.from,
      to: input.to,
      on: input.rateDate,
    });

    try {
      return await this.repository.insertIfAbsent(fetched);
    } catch (error) {
      if (error instanceof DuplicateExchangeRateError) {
        // Two shapes land here and both resolve the same way.
        //
        //  1. A genuine race - a concurrent caller inserted the same key first.
        //  2. `resolveExpectedPublicationDay` (or its absence) resolved a
        //     different day than the one the provider's own `fetchRate` walk-
        //     back landed on, so the row it wants already exists under
        //     `fetched.rateDate` while the pre-fetch read looked under a
        //     different key. Never a duplicate row and never a rate keyed to
        //     the wrong date - the row this re-read finds is now the one the
        //     NEXT caller's pre-fetch read will hit directly, per the file
        //     header.
        const winner = await this.repository.findByKey({
          source: fetched.source,
          from: fetched.from,
          to: fetched.to,
          rateDate: fetched.rateDate,
        });
        if (winner) {
          return winner;
        }
        this.logger.warn(
          `Exchange rate ${fetched.from}/${fetched.to} on ${fetched.rateDate} reported a duplicate ` +
            `from '${fetched.source}' but no row could be re-read; re-raising.`
        );
      }
      throw error;
    }
  }
}
