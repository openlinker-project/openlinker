/**
 * Currency Settings Controller
 *
 * Admin-only REST surface for the system-level reporting currency (ADR-040) -
 * the one value in the FX design an operator has to be able to choose, because
 * the built-in default CONVERTS: a deployment that never opens this surface
 * reports a PLN order through an ECB-inverted quote.
 *
 * Endpoints:
 *
 *   GET /currency-settings                      - resolved value + provenance
 *                                                 + advisory + stamped counts
 *   PUT /currency-settings/reporting-currency    - save an operator's choice (204)
 *
 * Naming and shape mirror `/ai-provider-settings` + `PUT .../active`, down to
 * the `withDomainExceptionMapping` boundary split: the ISO-shape failure is a
 * malformed request (400) while an unreachable-but-well-formed code is
 * unsatisfiable (422, message carrying the set that would be accepted).
 *
 * THE TWO CROSS-CONTEXT FACTS ARE COMPOSED HERE. The coverage advisory needs
 * the order-native currencies this deployment has ingested and the era-split
 * warning needs the stamped-row counts; both live in `orders`. Composing two
 * contexts is legal in the interfaces layer, and doing it in the core currency
 * service instead would create a `currency -> orders` edge and cost that
 * context its leaf property.
 *
 * @module apps/api/src/currency/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  assessCoverage,
  DEFAULT_FX_RATE_RULE,
  EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
  InvalidReportingCurrencyError,
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  ReportingCurrencyUnsupportedError,
  resolveRateSource,
  type ExchangeRateProviderPort,
  type ExchangeRateProviderRegistryPort,
  type ExchangeRateSource,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import { ORDER_FX_READ_SERVICE_TOKEN, type IOrderFxReadService } from '@openlinker/core/orders';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CurrencySettingsResponseDto,
  ReportingCurrencyCoverageDto,
} from './dto/currency-settings-response.dto';
import { SetReportingCurrencyDto } from './dto/set-reporting-currency.dto';

@ApiBearerAuth()
@ApiTags('currency-settings')
@Controller('currency-settings')
export class CurrencySettingsController {
  constructor(
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IReportingCurrencySettingsService,
    @Inject(EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN)
    private readonly providers: ExchangeRateProviderRegistryPort,
    @Inject(ORDER_FX_READ_SERVICE_TOKEN)
    private readonly orderFxReads: IOrderFxReadService
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({
    summary:
      'Read the reporting-currency settings view: resolved value, its provenance, the selectable set, the coverage advisory per candidate, and the already-stamped row counts',
  })
  @ApiResponse({ status: 200, type: CurrencySettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(@Res({ passthrough: true }) res: Response): Promise<CurrencySettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');

    const [view, observedCurrencies, stampedOrders] = await Promise.all([
      this.settings.getView(),
      this.orderFxReads.listDistinctNativeCurrencies(),
      this.orderFxReads.countStampedByReportingCurrency(),
    ]);

    return CurrencySettingsResponseDto.fromView({
      view,
      rateSource: this.resolveSourceKey(view.reportingCurrency),
      rateDateRule: DEFAULT_FX_RATE_RULE,
      stampedOrders,
      coverage: view.supportedCurrencies.map((candidate) =>
        this.buildCoverage(candidate, observedCurrencies)
      ),
    });
  }

  @Roles('admin')
  @Put('reporting-currency')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Set the reporting currency - forward-only. Already-stamped orders keep the currency they were stamped in, so a change splits history into eras rather than restating it.',
  })
  @ApiResponse({ status: 204, description: 'Reporting currency saved' })
  @ApiResponse({ status: 400, description: 'Not an ISO-4217-shaped currency code' })
  @ApiResponse({
    status: 422,
    description: 'Well-formed but unreachable code; the message carries the supported set',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async setReportingCurrency(
    @Body() dto: SetReportingCurrencyDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.withDomainExceptionMapping(() =>
      this.settings.setReportingCurrency(dto.reportingCurrency, user?.id ?? null, {
        acknowledgeCoverageGaps: dto.acknowledgeCoverageGaps === true,
      })
    );
  }

  /**
   * The advisory for one candidate. With no registered provider the gaps are
   * reported as EMPTY together with `rateSource: null`, so a consumer can tell
   * "nothing is uncoverable" apart from "this could not be assessed" - the
   * observed set is still reported either way.
   */
  private buildCoverage(
    candidate: string,
    observedCurrencies: readonly string[]
  ): ReportingCurrencyCoverageDto {
    const provider = this.resolveProvider(candidate);

    if (!provider) {
      return ReportingCurrencyCoverageDto.fromCoverage(
        {
          reportingCurrency: candidate,
          observedCurrencies: [...new Set(observedCurrencies)],
          uncoverableCurrencies: [],
        },
        null
      );
    }

    return ReportingCurrencyCoverageDto.fromCoverage(
      assessCoverage(candidate, observedCurrencies, provider),
      this.resolveSourceKey(candidate)
    );
  }

  /**
   * Which publisher serves this currency, or `null` when it has none. A read
   * surface must never 500 over a resolved value it merely reports - the env
   * rung already ignores an unsupported code, and a settings row written before
   * a mapping changed has to stay readable.
   */
  private resolveSourceKey(reportingCurrency: string): ExchangeRateSource | null {
    try {
      return resolveRateSource(reportingCurrency);
    } catch {
      return null;
    }
  }

  private resolveProvider(reportingCurrency: string): ExchangeRateProviderPort | null {
    const source = this.resolveSourceKey(reportingCurrency);
    if (source === null) {
      return null;
    }
    // `has` first: `get` throws on an unregistered source, and a host that has
    // not registered the fx providers must still be able to READ the setting.
    return this.providers.has(source) ? this.providers.get(source) : null;
  }

  private async withDomainExceptionMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof InvalidReportingCurrencyError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof ReportingCurrencyUnsupportedError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}
