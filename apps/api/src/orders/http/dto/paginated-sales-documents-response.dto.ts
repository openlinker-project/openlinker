/**
 * Paginated Sales Documents Response DTO (#3306)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesDocumentListItemResponseDto } from './sales-document-list-item-response.dto';

export class PaginatedSalesDocumentsResponseDto {
  @ApiProperty({ type: [SalesDocumentListItemResponseDto] })
  items!: SalesDocumentListItemResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Opaque cursor for the next page. `null` means both sources are exhausted - there is no more ' +
      'data for this filter set.',
  })
  nextCursor!: string | null;
}
