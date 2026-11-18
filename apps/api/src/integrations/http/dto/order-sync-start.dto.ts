/**
 * Order Sync Start DTO
 *
 * The operator's choice of where a new connection's order feed starts (#4228),
 * shared by the generic create request and the OAuth connect request.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsIn, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderSyncStartModeValues, OrderSyncStartMode } from '@openlinker/core/sync';
import type { OrderSyncStart } from '@openlinker/core/sync';

/**
 * Where a new connection's order feed starts (#4228). `from` is required when
 * `mode` is `from` and ignored otherwise; whether the adapter supports the mode,
 * and whether the date is in range, is decided by `ConnectionService.create`,
 * which knows the adapter and answers 400 with the supported modes.
 */
export class OrderSyncStartDto {
  @ApiProperty({
    description:
      'now = only orders placed from now on (default); from = orders since a date (adapters that filter by date, e.g. PrestaShop, WooCommerce); all = the whole order history',
    enum: OrderSyncStartModeValues,
    example: 'from',
  })
  @IsIn(OrderSyncStartModeValues)
  mode!: OrderSyncStartMode;

  @ApiPropertyOptional({
    description:
      'Required when mode is "from": an ISO date (YYYY-MM-DD) or ISO date-time, not in the future and not older than 5 years.',
    example: '2026-10-01',
  })
  @ValidateIf((o: OrderSyncStartDto) => o.mode === 'from')
  @IsString()
  @IsNotEmpty()
  from?: string;
}

/**
 * The DTO leaves `from` optional so a missing date stays a validation message;
 * `ConnectionService.create` re-validates the pair either way.
 */
export function toOrderSyncStart(dto: OrderSyncStartDto | undefined): OrderSyncStart | undefined {
  if (!dto) return undefined;
  return dto.mode === 'from' ? { mode: 'from', from: dto.from ?? '' } : { mode: dto.mode };
}
