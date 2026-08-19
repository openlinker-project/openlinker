/**
 * Sales-Document Country Summary Response DTO (#2186)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SalesDocumentCountrySummary } from '@openlinker/core/sales-documents';

export class SalesDocumentCountrySummaryResponseDto {
  @ApiProperty({ description: "ISO 3166-1 alpha-2, or '*' for Rest of world" })
  country!: string;

  @ApiProperty()
  ruleCount!: number;

  @ApiProperty({ nullable: true })
  invoiceDefaultConnectionId!: string | null;

  @ApiProperty({ nullable: true })
  receiptDefaultConnectionId!: string | null;

  @ApiProperty({ nullable: true })
  acknowledgedNoDocumentAt!: string | null;

  static fromDomain(summary: SalesDocumentCountrySummary): SalesDocumentCountrySummaryResponseDto {
    const dto = new SalesDocumentCountrySummaryResponseDto();
    dto.country = summary.country;
    dto.ruleCount = summary.ruleCount;
    dto.invoiceDefaultConnectionId = summary.invoiceDefaultConnectionId;
    dto.receiptDefaultConnectionId = summary.receiptDefaultConnectionId;
    dto.acknowledgedNoDocumentAt = summary.acknowledgedNoDocumentAt;
    return dto;
  }
}
