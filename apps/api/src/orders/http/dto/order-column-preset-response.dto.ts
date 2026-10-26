/**
 * Order Column Preset Response DTO (#3530)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderColumnPresetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null marks the single workspace-default row (D32), never a personal preset.',
  })
  userId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  columns!: string[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
