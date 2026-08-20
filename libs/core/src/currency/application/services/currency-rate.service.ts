/**
 * Currency Rate Service
 *
 * Get-or-create against the shared `exchange_rates` registry, which is keyed by
 * `(source, pair, date)` rather than held per order.
 *
 * WHAT THE REGISTRY DOES AND DOES NOT ABSORB - the pre-fetch read is keyed on
 * the CANDIDATE day the caller asked for, while the write is keyed on the day
 * the source actually PUBLISHED for, and those are not always the same day:
 *
 *  - Candidate IS a publication day (roughly 5 days in 7). The two keys
 *    coincide, so five hundred EUR orders carrying that candidate cost one
 *    provider call, not five hundred.
 *  - Candidate is NOT a publication day - a weekend or a holiday, roughly 2
 *    days in 7. The adapter walks back and the row lands under the earlier
 *    published date. Nothing is ever written under the candidate, so the
 *    pre-fetch read misses forever and EVERY order carrying that candidate
 *    makes a live provider call. The insert is then absorbed as a duplicate.
 *
 * The second case is a real, recurring cost, not a rounding error, and it is
 * accepted deliberately: the registry stores PUBLISHED rates, so writing a
 * second row under a non-publication date would record a rate the source never
 * published for that day - a figure an operator could not verify against any
 * table, in the one place whose whole purpose is to be verifiable. Memoising
 * the candidate-to-published-date mapping needs its own persisted table and
 * belongs to the persistence phase (#2124); it is not folded in here, where
 * nothing else changes behaviour.
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

    const existing = await this.repository.findByKey(input);
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
        //  2. The provider resolved the CANDIDATE day onto an earlier published
        //     day (a weekend or holiday candidate), so the row it wants already
        //     exists under that earlier date while the pre-fetch read looked
        //     under the candidate. Never a duplicate row and never a rate keyed
        //     to the wrong date - but note the cost is one provider call per
        //     ORDER carrying such a candidate, not one per candidate day: no
        //     row is ever written under the candidate, so the pre-fetch read
        //     goes on missing. See the file header for why that is accepted
        //     and where memoising it belongs (#2124).
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
