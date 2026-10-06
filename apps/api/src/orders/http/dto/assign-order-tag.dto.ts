/**
 * Assign Order Tag DTO (#3532)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AssignOrderTagDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tagId!: string;
}
