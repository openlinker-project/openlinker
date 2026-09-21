/**
 * Sales-Document List Item Response DTO (#3306)
 *
 * One row of `GET /sales-documents`. Reuses the per-kind `document` shape
 * `SalesDocumentViewResponseDto` already defines for the per-order projection
 * (`toRecordDto`) so an invoice/receipt is never described two different
 * ways depending on which endpoint answered.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type { SalesDocumentListItem } from '@openlinker/core/orders';
import {
  SalesDocumentInvoiceViewDto,
  SalesDocumentReceiptViewDto,
  toRecordDto,
} from './sales-document-view-response.dto';

export class SalesDocumentListAmountDto {
  @ApiProperty({ description: "The order's own native total." })
  value!: number;

  @ApiProperty({ description: 'ISO 4217 currency code, native to the order - never converted.' })
  currency!: string;
}

@ApiExtraModels(SalesDocumentInvoiceViewDto, SalesDocumentReceiptViewDto)
export class SalesDocumentListItemResponseDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(SalesDocumentInvoiceViewDto) },
      { $ref: getSchemaPath(SalesDocumentReceiptViewDto) },
    ],
  })
  document!: SalesDocumentInvoiceViewDto | SalesDocumentReceiptViewDto;

  @ApiPropertyOptional({
    type: SalesDocumentListAmountDto,
    nullable: true,
    description: "`null` when `order_records` carries no populated total for this order's order.",
  })
  amount!: SalesDocumentListAmountDto | null;

  @ApiProperty({
    description:
      'How many OTHER connections hold a record (of either kind) for this same order - the ' +
      'ADR-041 duplicate signal. `0` means this is the only record for its order.',
  })
  otherRecordCount!: number;
}

export function toSalesDocumentListItemDto(
  item: SalesDocumentListItem,
): SalesDocumentListItemResponseDto {
  return {
    orderId: item.orderId,
    connectionId: item.connectionId,
    document: toRecordDto(item.document),
    amount: item.amount,
    otherRecordCount: item.otherRecordCount,
  };
}
