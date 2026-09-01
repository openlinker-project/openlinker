/**
 * Sales Analytics Query DTO
 *
 * Query parameters for `GET /analytics/sales` (#1987). Unlike
 * `OrderHealthSummaryQueryDto`'s optional date pair, `from`/`to` are
 * **required** here — a sales query without a range is not a meaningful
 * request.
 *
 * `displayCurrency` / `rateBasis` (#2459, ADR-064) are the display-currency
 * override axis: both optional, and omitting `displayCurrency` leaves the
 * response byte-identical to the pre-#2459 shape — the controller never even
 * calls `IDisplayCurrencyConversionService` when it's absent. Unlike
 * `SetReportingCurrencyDto.reportingCurrency` (which deliberately stays a bare
 * `@IsString()` because ITS selectable set is narrowed at runtime by which
 * providers are registered), `displayCurrency` is validated directly against
 * `SUPPORTED_REPORTING_CURRENCIES` at the DTO layer — a display override has
 * no such runtime narrowing, so the class-validator decorator IS the whole
 * gate (400 on violation, never a deeper 422).
 *
 * @module apps/api/src/analytics/http/dto
 */
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SUPPORTED_REPORTING_CURRENCIES } from '@openlinker/core/currency';
import {
  DISPLAY_CURRENCY_RATE_BASIS_VALUES,
  type DisplayCurrencyRateBasis,
} from '@openlinker/core/orders';

export class SalesAnalyticsQueryDto {
  @ApiProperty({ description: 'Range start, inclusive (ISO 8601). Bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Range end, exclusive (ISO 8601). Bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow to a single source connection (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;

  @ApiPropertyOptional({
    description:
      `Convert headline/channel revenue into this ISO-4217 currency instead of the ` +
      `stamped reporting currency. Restricted to ${SUPPORTED_REPORTING_CURRENCIES.join(', ')} ` +
      `— the currencies OpenLinker can report in today. Omit for the pre-#2459 response shape.`,
    enum: SUPPORTED_REPORTING_CURRENCIES,
    example: 'PLN',
  })
  @IsOptional()
  @IsIn(SUPPORTED_REPORTING_CURRENCIES)
  displayCurrency?: string;

  @ApiPropertyOptional({
    description:
      "Conversion rate basis, only meaningful when displayCurrency is set. 'current-rate' " +
      '(default) groups each native-currency bucket already read by the aggregation and ' +
      "converts each group at today's rate. 'order-date' instead takes the already-stamped " +
      'reporting-currency total and applies a single current rate to the whole figure.',
    enum: DISPLAY_CURRENCY_RATE_BASIS_VALUES,
    default: 'current-rate',
  })
  @IsOptional()
  @IsIn(DISPLAY_CURRENCY_RATE_BASIS_VALUES)
  rateBasis?: DisplayCurrencyRateBasis;
}
