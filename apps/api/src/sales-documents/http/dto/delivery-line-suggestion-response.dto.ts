/**
 * Delivery-Line Suggestion Response DTOs (#3907, ADR-079 decision 8)
 *
 * Wire shape of the curated delivery-line suggestions. Class names are unique
 * across the API because Swagger keys schemas by class name.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class DeliveryLineSuggestionSourceDto {
  @ApiProperty({ example: 'VAT rate follows the goods' })
  term!: string;

  @ApiProperty({ description: 'What the cited source says, in plain words.' })
  text!: string;
}

export class DeliveryLineSuggestionDto {
  @ApiProperty({ example: 'PL', description: 'ISO 3166-1 alpha-2, upper case.' })
  country!: string;

  @ApiProperty({ example: 'Koszt dostawy' })
  defaultName!: string;

  @ApiProperty({ type: [String] })
  nameSuggestions!: string[];

  @ApiProperty({
    enum: ['goods', 'fixed'],
    description: '`goods`: the delivery follows the VAT rate of the goods it ships with.',
  })
  rateMode!: 'goods' | 'fixed';

  @ApiProperty({ description: 'Whether the delivery line is left off when delivery is free.' })
  omitFreeDelivery!: boolean;

  @ApiProperty({ type: [DeliveryLineSuggestionSourceDto] })
  sources!: DeliveryLineSuggestionSourceDto[];

  @ApiProperty({ example: 'Dz.U. 2024 poz. 1654 (isap.sejm.gov.pl)' })
  sourceLabel!: string;

  @ApiProperty({ example: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001654' })
  sourceUrl!: string;

  @ApiProperty({ example: 'Suggested settings, not legal advice. Check them with your accountant.' })
  disclaimer!: string;
}

export class DeliveryLineSuggestionsResponseDto {
  @ApiProperty({ type: [DeliveryLineSuggestionDto] })
  suggestions!: DeliveryLineSuggestionDto[];
}
