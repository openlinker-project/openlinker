/**
 * Update Prompt Template DTO
 *
 * Request body for `PATCH /prompt-templates/:id`. All fields optional so
 * the caller can patch a subset of the draft content; the service rejects
 * the call if the target row is not a draft.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PromptTemplateVariableDto } from './prompt-template-variable.dto';

const MAX_PROMPT_LENGTH = 65536;
const MAX_VARIABLES = 64;

export class UpdatePromptTemplateDto {
  @ApiProperty({ required: false, maxLength: MAX_PROMPT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PROMPT_LENGTH)
  systemPrompt?: string;

  @ApiProperty({ required: false, maxLength: MAX_PROMPT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PROMPT_LENGTH)
  userPromptTemplate?: string;

  @ApiProperty({ required: false, type: [PromptTemplateVariableDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_VARIABLES)
  @ValidateNested({ each: true })
  @Type(() => PromptTemplateVariableDto)
  variables?: PromptTemplateVariableDto[];
}
