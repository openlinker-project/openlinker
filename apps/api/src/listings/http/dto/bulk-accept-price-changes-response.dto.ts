/**
 * Bulk Accept Price Changes Response DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { BulkAcceptResult } from '@openlinker/core/listings';

export class BulkAcceptPriceChangesResponseDto {
  @ApiProperty({ description: 'The bulk_offer_creation_batches row id — poll it via the existing batch-progress endpoint.' })
  batchId!: string;

  @ApiProperty()
  totalCount!: number;

  static fromDomain(result: BulkAcceptResult): BulkAcceptPriceChangesResponseDto {
    const dto = new BulkAcceptPriceChangesResponseDto();
    dto.batchId = result.batchId;
    dto.totalCount = result.totalCount;
    return dto;
  }
}
