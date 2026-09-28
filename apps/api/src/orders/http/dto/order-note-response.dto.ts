/**
 * Order Note Response DTO (#3531)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderNoteResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty()
  authorUserId!: string;

  @ApiProperty()
  authorUsername!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  showToPacker!: boolean;

  @ApiPropertyOptional({ nullable: true, description: '"edited" marker — null until first edit.' })
  editedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
