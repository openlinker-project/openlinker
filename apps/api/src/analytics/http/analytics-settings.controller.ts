/**
 * Analytics Settings Controller
 *
 * HTTP surface for the `/analytics` display-settings singleton row (#2461,
 * mini-epic #2460, epic #2452 Phase 3): a display-currency override, the
 * rate-recomputation basis, and the backfilled-tax-rate Net Sales inclusion
 * opt-in.
 *
 * Endpoints:
 *
 *   GET /analytics/settings — `@Roles('admin', 'operator', 'viewer')`, not
 *                             `@AnyRole()`: every operator viewing the
 *                             dashboard needs to read the display preference
 *                             in effect, not just admins, but this is still
 *                             commercial analytics the #2413 route review
 *                             excludes `packer` from.
 *   PUT /analytics/settings — `@Roles('admin')`, mirroring
 *                             `AiProviderSettingsController` /
 *                             `CurrencySettingsController`: changing a
 *                             deployment-wide display preference is an admin
 *                             action.
 *
 * `GET` composes the singleton row with the system reporting currency
 * (`IReportingCurrencySettingsService.resolve()`, `@openlinker/core/currency`)
 * so `displayCurrency` in the response is always a resolved, usable value —
 * see `AnalyticsSettingsResponseDto` for why that composition happens here
 * rather than inside core `analytics`.
 *
 * None of the three fields is ever written back onto `order_records` — see
 * the controller's own spec for the guard test.
 *
 * @module apps/api/src/analytics/http
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  type IAnalyticsDisplaySettingsService,
} from '@openlinker/core/analytics';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AnalyticsSettingsResponseDto } from './dto/analytics-settings-response.dto';
import { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsSettingsController {
  constructor(
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IAnalyticsDisplaySettingsService,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrency: IReportingCurrencySettingsService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('settings')
  @ApiOperation({
    summary:
      'Read the analytics display settings: display-currency override (resolved + provenance), rate basis, and the backfilled-tax-rate Net Sales opt-in. Open to any authenticated user.',
  })
  @ApiResponse({ status: 200, type: AnalyticsSettingsResponseDto })
  async get(@Res({ passthrough: true }) res: Response): Promise<AnalyticsSettingsResponseDto> {
    res.setHeader('Cache-Control', 'no-store');

    const [view, resolvedReportingCurrency] = await Promise.all([
      this.settings.getSettings(),
      this.reportingCurrency.resolve(),
    ]);

    return AnalyticsSettingsResponseDto.fromView({ view, resolvedReportingCurrency });
  }

  @Roles('admin')
  @Put('settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Update the analytics display settings. Read-time preferences only — never writes to order_records.',
  })
  @ApiResponse({ status: 204, description: 'Settings updated' })
  @ApiResponse({ status: 400, description: 'Validation failure (unsupported currency code, etc.)' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async update(
    @Body() dto: UpdateAnalyticsSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    await this.settings.updateSettings(
      {
        displayCurrency: dto.displayCurrency,
        rateBasis: dto.rateBasis,
        includeBackfilledTaxRatesInNetSales: dto.includeBackfilledTaxRatesInNetSales,
        netGrossBasis: dto.netGrossBasis,
      },
      user?.id
    );
  }
}
