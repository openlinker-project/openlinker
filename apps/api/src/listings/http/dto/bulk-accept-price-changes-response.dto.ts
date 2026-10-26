/**
 * Bulk Accept Price Changes Response DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { BulkAcceptResult } from '@openlinker/core/listings';
import type { PriceSyncModeOverrideOutcome } from '../../application/services/price-sync-mode-override.service.interface';

export class OptInResultDto {
  @ApiProperty() destinationConnectionId!: string;
  @ApiProperty() sourceConnectionId!: string;
  @ApiProperty({
    description:
      'Whether this pair was actually flipped into automatic mode — false on a lock miss or a #2610 validation failure (#3162 re-review, IMPORTANT).',
  })
  applied!: boolean;
}

export class BulkAcceptPriceChangesResponseDto {
  @ApiProperty({ description: 'The bulk_offer_creation_batches row id — poll it via the existing batch-progress endpoint.' })
  batchId!: string;

  @ApiProperty()
  totalCount!: number;

  @ApiProperty({
    type: [OptInResultDto],
    description:
      'One entry per de-duplicated (destination, source) pair that requested `optInAutomatic`, reporting whether the flip was actually applied (#3162 re-review, IMPORTANT — previously discarded entirely).',
  })
  optInResults!: OptInResultDto[];

  static fromDomain(
    result: BulkAcceptResult,
    optInResults: readonly PriceSyncModeOverrideOutcome[]
  ): BulkAcceptPriceChangesResponseDto {
    const dto = new BulkAcceptPriceChangesResponseDto();
    dto.batchId = result.batchId;
    dto.totalCount = result.totalCount;
    dto.optInResults = optInResults.map((outcome) => ({ ...outcome }));
    return dto;
  }
}
