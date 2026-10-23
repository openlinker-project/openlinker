/**
 * Set Workspace Default Columns DTO (#3530, D32)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class SetWorkspaceDefaultColumnsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsString({ each: true })
  columns!: string[];
}
