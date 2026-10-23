/**
 * Mark Pre-Rollout Era Response DTO
 *
 * Response shape for `POST /orders/:internalOrderId/test-fixtures/mark-pre-rollout-era` (#2855).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class MarkPreRolloutEraResponseDto {
  @ApiProperty({
    description:
      'true if this call changed the row; false if it already carried taxRateEra=\'pre-rollout\'',
    example: true,
  })
  applied!: boolean;
}
