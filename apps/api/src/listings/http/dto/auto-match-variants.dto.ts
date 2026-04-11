/**
 * Auto-Match Variants DTOs
 *
 * Request and response DTOs for the auto-match variants endpoint.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class AutoMatchVariantsRequestDto {
  @ApiPropertyOptional({ description: 'When true, return results without persisting mappings', default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class AutoMatchVariantsResponseDto {
  @ApiProperty({ description: 'Job ID for the enqueued auto-match job' })
  jobId!: string;
}
