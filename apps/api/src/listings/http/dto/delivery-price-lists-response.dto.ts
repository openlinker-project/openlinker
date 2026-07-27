/**
 * Delivery Price Lists Response DTO (#1530)
 *
 * Response shape for `GET /listings/connections/:connectionId/delivery-price-lists`.
 * Swagger-decorated mirror of `DeliveryPriceList[]` from `@openlinker/core/listings`,
 * wrapped under `deliveryPriceLists`.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class DeliveryPriceListDto {
  @ApiProperty({ description: 'Platform-native delivery price list id' })
  id!: string;

  @ApiProperty({ description: 'Unique delivery price list name (operator-facing label)' })
  name!: string;
}

export class DeliveryPriceListsResponseDto {
  @ApiProperty({ type: [DeliveryPriceListDto] })
  deliveryPriceLists!: DeliveryPriceListDto[];
}
