/**
 * Connection payment methods response DTO (#3774)
 *
 * Wire shape of `GET /connections/:connectionId/payment-methods/observed`.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethodResolutionValues, PaymentMethodValues } from '@openlinker/core/orders';
import type { PaymentMethod, PaymentMethodResolution } from '@openlinker/core/orders';
import {
  PaymentMethodMapSupportValues,
  type ConnectionPaymentMethodsView,
  type PaymentMethodMapSupport,
} from '../../application/types/connection-payment-methods.types';

export class ObservedPaymentMethodItemDto {
  @ApiProperty({ description: 'Native payment identifier, trimmed and lower-cased.' })
  sourcePaymentMethod!: string;

  @ApiProperty({ description: 'Orders carrying it inside the window.' })
  orderCount!: number;

  @ApiProperty({ type: String, format: 'date-time', description: 'Newest order carrying it.' })
  lastSeenAt!: string;

  @ApiProperty({
    enum: PaymentMethodValues,
    nullable: true,
    description: 'What the platform itself says. Null unless `mapSupport` is `supported`.',
  })
  platformMethod!: PaymentMethod | null;

  @ApiProperty({
    enum: PaymentMethodValues,
    nullable: true,
    description: "What the operator's map says. Null unless supported and mapped.",
  })
  operatorMethod!: PaymentMethod | null;

  @ApiProperty({
    enum: PaymentMethodValues,
    nullable: true,
    description: 'What ingestion would write. Null unless `mapSupport` is `supported`.',
  })
  resolvedMethod!: PaymentMethod | null;

  @ApiProperty({
    enum: PaymentMethodResolutionValues,
    nullable: true,
    description: 'Who decided `resolvedMethod`. Null unless `mapSupport` is `supported`.',
  })
  resolvedBy!: PaymentMethodResolution | null;
}

export class ConnectionPaymentMethodsResponseDto {
  @ApiProperty({
    enum: PaymentMethodMapSupportValues,
    description:
      '`supported` - the integration honours the map. `unsupported` - it ignores it. ' +
      '`unknown` - the connection could not be asked; not the same as unsupported.',
  })
  mapSupport!: PaymentMethodMapSupport;

  @ApiProperty({ description: 'Look-back window the observed identifiers cover, in days.' })
  windowDays!: number;

  @ApiProperty({ type: [ObservedPaymentMethodItemDto] })
  items!: ObservedPaymentMethodItemDto[];
}

export function toConnectionPaymentMethodsDto(
  view: ConnectionPaymentMethodsView
): ConnectionPaymentMethodsResponseDto {
  return {
    mapSupport: view.mapSupport,
    windowDays: view.windowDays,
    items: view.items.map((item) => ({
      ...item,
      lastSeenAt: item.lastSeenAt.toISOString(),
    })),
  };
}
