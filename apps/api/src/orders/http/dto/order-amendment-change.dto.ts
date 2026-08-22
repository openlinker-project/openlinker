/**
 * Order Amendment Change DTO
 *
 * One source-side amendment OpenLinker observed on a re-ingestion (#2283).
 *
 * PII-free by construction, and that is the contract rather than an
 * implementation detail: line ids, SKUs and quantities are carried verbatim
 * (none is personal data), while an address change contributes only the NAMES of
 * the fields that moved. A before/after address would put buyer PII on a wire
 * shape with none of the `OL_STORE_PII` discipline the order snapshot has.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderAmendmentChangeKindValues,
  type OrderAmendmentChangeKind,
} from '@openlinker/core/orders';

export class OrderAmendmentChangeDto {
  @ApiProperty({ enum: OrderAmendmentChangeKindValues })
  kind!: OrderAmendmentChangeKind;

  @ApiPropertyOptional({ description: 'Source-native line id, for the line-grained kinds.' })
  lineId?: string;

  @ApiPropertyOptional({ description: 'Source-native SKU, when the source reported one.' })
  sku?: string;

  @ApiPropertyOptional({ description: 'Quantity before the amendment.' })
  fromQuantity?: number;

  @ApiPropertyOptional({ description: 'Quantity after the amendment.' })
  toQuantity?: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Names of the address fields that changed. Names only — the values are deliberately absent.',
  })
  fields?: string[];
}
