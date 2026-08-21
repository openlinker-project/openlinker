/**
 * Sales-Document Threshold Response DTO (#2170)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SalesDocumentThreshold } from '@openlinker/core/sales-documents';

export class SalesDocumentThresholdResponseDto {
  @ApiProperty()
  ref!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  comparisonOp!: string;

  @ApiProperty()
  versionEffectiveFrom!: string;

  @ApiProperty({ nullable: true })
  versionEffectiveTo!: string | null;

  static fromDomain(threshold: SalesDocumentThreshold): SalesDocumentThresholdResponseDto {
    const dto = new SalesDocumentThresholdResponseDto();
    dto.ref = threshold.ref;
    dto.amount = threshold.amount;
    dto.currency = threshold.currency;
    dto.comparisonOp = threshold.comparisonOp;
    dto.versionEffectiveFrom = threshold.versionEffectiveFrom.toISOString().slice(0, 10);
    dto.versionEffectiveTo = threshold.versionEffectiveTo
      ? threshold.versionEffectiveTo.toISOString().slice(0, 10)
      : null;
    return dto;
  }
}
