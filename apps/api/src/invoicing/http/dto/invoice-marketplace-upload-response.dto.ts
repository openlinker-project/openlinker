/**
 * Invoice Marketplace Upload Response DTO (#3549)
 *
 * Where attaching an issued document to its marketplace order stands, one entry
 * per marketplace connection. Carries codes only - never a provider message,
 * which can hold order data.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  InvoiceMarketplaceUploadFailureCodeValues,
  InvoiceMarketplaceUploadStatusValues,
  type InvoiceMarketplaceUpload,
  type InvoiceMarketplaceUploadFailureCode,
  type InvoiceMarketplaceUploadStatus,
} from '@openlinker/core/orders';

export class InvoiceMarketplaceUploadEntryDto {
  @ApiProperty({ type: String })
  targetConnectionId!: string;

  @ApiProperty({ enum: InvoiceMarketplaceUploadStatusValues })
  status!: InvoiceMarketplaceUploadStatus;

  @ApiProperty({ enum: InvoiceMarketplaceUploadFailureCodeValues, nullable: true })
  lastFailureCode!: InvoiceMarketplaceUploadFailureCode | null;

  @ApiProperty({ type: Number })
  attempts!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  uploadedAt!: string | null;
}

export class InvoiceMarketplaceUploadResponseDto {
  @ApiProperty({ type: String })
  invoiceId!: string;

  @ApiProperty({ type: [InvoiceMarketplaceUploadEntryDto] })
  uploads!: InvoiceMarketplaceUploadEntryDto[];

  static fromDomain(
    invoiceId: string,
    rows: InvoiceMarketplaceUpload[],
  ): InvoiceMarketplaceUploadResponseDto {
    const dto = new InvoiceMarketplaceUploadResponseDto();
    dto.invoiceId = invoiceId;
    dto.uploads = rows.map((row) => ({
      targetConnectionId: row.targetConnectionId,
      status: row.status,
      lastFailureCode: row.lastFailureCode,
      attempts: row.attempts,
      uploadedAt: row.uploadedAt === null ? null : row.uploadedAt.toISOString(),
    }));
    return dto;
  }
}
