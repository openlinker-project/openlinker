/**
 * Delivery Country Facts Response DTOs (#3907, ADR-079 decision 8)
 *
 * Wire shape of what one connection's recent orders say about each delivery
 * country. Carries no buyer data: the example is labels, amounts and rates.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class DeliveryCountryExampleLineDto {
  @ApiProperty({ example: 'Blue T-shirt' })
  name!: string;

  @ApiProperty({ example: 49.99, description: 'Line total, gross.' })
  gross!: number;

  @ApiProperty({ type: String, nullable: true, example: '23', description: 'Rate code, or null when none.' })
  rate!: string | null;
}

export class DeliveryCountryExampleDto {
  @ApiProperty({ type: [DeliveryCountryExampleLineDto] })
  lines!: DeliveryCountryExampleLineDto[];

  @ApiProperty({ type: Number, nullable: true, example: 12.99, description: 'Shipping as the order reports it.' })
  delivery!: number | null;
}

export class DeliveryCountryFactDto {
  @ApiProperty({ example: 'PL' })
  country!: string;

  @ApiProperty({ example: 47, description: 'Orders delivered to that country in the window.' })
  orders30d!: number;

  @ApiProperty({ type: [String], example: ['23', '8'], description: 'Line rate codes seen, most frequent first.' })
  ratesSeen!: string[];

  @ApiProperty({ type: String, nullable: true, example: 'PLN', description: 'Most frequent order currency.' })
  currency!: string | null;

  @ApiProperty({ type: DeliveryCountryExampleDto, nullable: true, description: 'Latest ready order, anonymised.' })
  example!: DeliveryCountryExampleDto | null;
}

export class DeliveryCountryFactsResponseDto {
  @ApiProperty({ example: 30 })
  windowDays!: number;

  @ApiProperty({ type: [DeliveryCountryFactDto], description: 'Most orders first, at most 20 countries.' })
  countries!: DeliveryCountryFactDto[];
}
