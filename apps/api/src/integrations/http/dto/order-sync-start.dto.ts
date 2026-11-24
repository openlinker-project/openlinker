/**
 * Order Sync Start DTO
 *
 * The operator's choice of where a new connection's order feed starts (#4228),
 * shared by the generic create request and the OAuth connect request.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderSyncStartModeValues,
  OrderSyncStartMode,
  OrderSyncStartOrderValues,
  OrderSyncStartOrder,
} from '@openlinker/core/sync';
import type { OrderSyncStart } from '@openlinker/core/sync';
import { ORDER_IMPORT_DATE_PATTERN } from './order-import.dto';

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
  @MaxLength(40)
  @Matches(ORDER_IMPORT_DATE_PATTERN, { message: 'from must be an ISO date or date-time' })
  from?: string;

  @ApiPropertyOptional({
    description:
      'Which end of the history is imported first, for modes "from" and "all": oldest-first (default) or newest-first. ' +
      'Newest-first needs an adapter that declares `orderWindowImport`; new orders keep flowing while the history is read. Ignored for "now".',
    enum: OrderSyncStartOrderValues,
    example: 'newest-first',
  })
  @IsOptional()
  @IsIn(OrderSyncStartOrderValues)
  order?: OrderSyncStartOrder;
}

/**
 * The DTO leaves `from` optional so a missing date stays a validation message;
 * `ConnectionService.create` re-validates the pair either way.
 */
export function toOrderSyncStart(dto: OrderSyncStartDto | undefined): OrderSyncStart | undefined {
  if (!dto) return undefined;
  const order = dto.order === 'newest-first' ? { order: dto.order } : {};
  if (dto.mode === 'now') return { mode: 'now' };
  return dto.mode === 'from'
    ? { mode: 'from', from: dto.from ?? '', ...order }
    : { mode: 'all', ...order };
}
