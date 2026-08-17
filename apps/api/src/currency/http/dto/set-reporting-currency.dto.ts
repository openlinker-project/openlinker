/**
 * Set Reporting Currency DTO
 *
 * Request body for `PUT /currency-settings/reporting-currency`. The path sits
 * on the parent resource because an operator is choosing the currency the whole
 * deployment reports in, not editing a field on one row - matching
 * `PUT /ai-provider-settings/active`.
 *
 * `@IsString()` rather than `@IsIn(SUPPORTED_REPORTING_CURRENCIES)` on purpose:
 * the selectable set is narrowed at runtime by which rate providers are
 * registered, so the authoritative gate lives in
 * `ReportingCurrencySettingsService` (shape -> 400, reachability -> 422). A DTO
 * enum here would answer 400 for a well-formed-but-unreachable code and lose
 * that distinction.
 *
 * @module apps/api/src/currency/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SUPPORTED_REPORTING_CURRENCIES } from '@openlinker/core/currency';

export class SetReportingCurrencyDto {
  @ApiProperty({
    description: `ISO-4217 code to report in. Currently shippable: ${SUPPORTED_REPORTING_CURRENCIES.join(', ')}, narrowed further by the registered rate providers.`,
    example: 'PLN',
  })
  @IsString()
  @IsNotEmpty()
  reportingCurrency!: string;

  @ApiPropertyOptional({
    description:
      'The operator saw a non-empty `uncoverableCurrencies` advisory and chose to proceed. Recorded on the audit log line; it never gates the write, because the advisory warns and never blocks.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeCoverageGaps?: boolean;
}
