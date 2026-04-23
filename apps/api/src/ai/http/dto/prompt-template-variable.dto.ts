/**
 * Prompt Template Variable DTO
 *
 * Nested DTO used inside create/update payloads to describe the declared
 * variables of a template. Validated with `class-validator`.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PromptTemplateVariableTypeValues,
  type PromptTemplateVariableType,
} from '@openlinker/core/ai';

export class PromptTemplateVariableDto {
  @ApiProperty({ example: 'product.name', maxLength: 128 })
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiProperty({ enum: PromptTemplateVariableTypeValues })
  @IsIn(PromptTemplateVariableTypeValues as unknown as string[])
  type!: PromptTemplateVariableType;

  @ApiProperty({ default: false })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ required: false, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}
