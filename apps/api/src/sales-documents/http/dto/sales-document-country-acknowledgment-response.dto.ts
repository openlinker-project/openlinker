/**
 * Sales-Document Country Acknowledgment Response DTO (#2186)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SalesDocumentCountryAcknowledgment } from '@openlinker/core/sales-documents';

export class SalesDocumentCountryAcknowledgmentResponseDto {
  @ApiProperty({ description: "ISO 3166-1 alpha-2, or '*' for Rest of world" })
  country!: string;

  @ApiProperty()
  acknowledgedAt!: string;

  static fromDomain(
    acknowledgment: SalesDocumentCountryAcknowledgment,
  ): SalesDocumentCountryAcknowledgmentResponseDto {
    const dto = new SalesDocumentCountryAcknowledgmentResponseDto();
    dto.country = acknowledgment.country;
    dto.acknowledgedAt = acknowledgment.acknowledgedAt.toISOString();
    return dto;
  }
}
