/**
 * Exchange Rates Controller
 *
 * Read-only REST surface for the `exchange_rates` registry (#2778). OpenLinker
 * persists every rate it uses specifically so a financial figure can be
 * verified (ADR-040) — this is the one endpoint that makes that audit trail
 * reachable.
 *
 *   GET /currency/rates?from=&to=&date=   - the stored row, or 404
 *
 * Two properties are load-bearing:
 *
 *  - **It is a READ of the registry, never a fetch.** The controller consumes
 *    `IExchangeRateLookupService.findRate` (a pure `findByKey` passthrough) —
 *    never `ICurrencyRateService.getRateFor`, whose get-or-create semantics
 *    would let an HTTP caller mint registry rows and spend the deployment's
 *    provider budget.
 *  - **Not `@Roles('admin')`.** Unlike `/currency-settings` (which writes a
 *    deployment-wide setting), this is the evidence behind a figure any
 *    operator can already see on `/analytics`. Gated by the global
 *    `JwtAuthGuard` only.
 *
 * The 422 body is REWRAPPED, never `ReportingCurrencyUnsupportedError.message`
 * verbatim: that message is worded for `/currency-settings` ("Reporting
 * currency '…' is not supported"), a question about a deployment-wide
 * setting. This endpoint asks about a RATE — the caller supplied `to` to look
 * up a published quote, not to choose how the deployment reports — so the
 * body here names the rate question instead ("No registered publisher quotes
 * '…'"), built from the exception's own `submitted` / `supportedCurrencies`
 * fields.
 *
 * @module apps/api/src/currency/http
 */
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN,
  ReportingCurrencyUnsupportedError,
  resolveRateSource,
  type ExchangeRateSource,
  type IExchangeRateLookupService,
} from '@openlinker/core/currency';
import { ExchangeRateResponseDto } from './dto/exchange-rate-response.dto';
import { GetExchangeRateDto } from './dto/get-exchange-rate.dto';

@ApiTags('currency')
@ApiBearerAuth()
@Controller('currency/rates')
export class ExchangeRatesController {
  constructor(
    @Inject(EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN)
    private readonly lookup: IExchangeRateLookupService
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Read one stored exchange rate — never fetches, never writes.',
    description:
      'Analytics provenance only; never a statutory/fiscal conversion rate (ADR-040).',
  })
  @ApiResponse({ status: 200, type: ExchangeRateResponseDto })
  @ApiResponse({ status: 404, description: 'No rate is stored under this key.' })
  @ApiResponse({
    status: 422,
    description: 'No registered publisher quotes `to` — this asks about a rate, not a setting.',
  })
  async getRate(@Query() query: GetExchangeRateDto): Promise<ExchangeRateResponseDto> {
    // `to` decides the publisher, exactly as every other caller in the repo
    // resolves it (`OrderFxStampService`, `DisplayCurrencyConversionService`)
    // — never `from`.
    const source = this.resolveSource(query.to);
    const stored = await this.lookup.findRate({
      source,
      from: query.from,
      to: query.to,
      rateDate: query.date,
    });

    if (!stored) {
      throw new NotFoundException(
        `No exchange rate stored for ${query.from}->${query.to} on ${query.date}`
      );
    }

    return ExchangeRateResponseDto.fromDomain(stored);
  }

  private resolveSource(to: string): ExchangeRateSource {
    try {
      return resolveRateSource(to);
    } catch (error) {
      if (error instanceof ReportingCurrencyUnsupportedError) {
        // `ReportingCurrencyUnsupportedError.message` is worded for the
        // `/currency-settings` write path ("Reporting currency '…' is not
        // supported") — correct there, but this caller asked about a RATE,
        // not a deployment-wide setting, so it is rewrapped here rather than
        // reusing the shared message verbatim.
        throw new UnprocessableEntityException(
          `No registered publisher quotes '${error.submitted}'; publishers serve: ` +
            `[${error.supportedCurrencies.join(', ') || '<none>'}]`
        );
      }
      throw error;
    }
  }
}
