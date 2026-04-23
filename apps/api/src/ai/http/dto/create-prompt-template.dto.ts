/**
 * Create Prompt Template DTO
 *
 * Request body for `POST /prompt-templates`. Starts a new draft for the
 * given `(key, channel)` pair; version is assigned server-side.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PromptTemplateChannelValues,
  type PromptTemplateChannel,
} from '@openlinker/core/ai';
import { PromptTemplateVariableDto } from './prompt-template-variable.dto';

const MAX_PROMPT_LENGTH = 65536;
const MAX_VARIABLES = 64;

export class CreatePromptTemplateDto {
  @ApiProperty({ example: 'offer.description.suggest', maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  key!: string;

  @ApiProperty({
    enum: PromptTemplateChannelValues,
    nullable: true,
    description: 'null = master (generic) template',
  })
  @IsOptional()
  @IsIn(PromptTemplateChannelValues as unknown as string[])
  channel!: PromptTemplateChannel | null;

  @ApiProperty({ maxLength: MAX_PROMPT_LENGTH })
  @IsString()
  @MaxLength(MAX_PROMPT_LENGTH)
  systemPrompt!: string;

  @ApiProperty({ maxLength: MAX_PROMPT_LENGTH })
  @IsString()
  @MaxLength(MAX_PROMPT_LENGTH)
  userPromptTemplate!: string;

  @ApiProperty({ type: [PromptTemplateVariableDto] })
  @IsArray()
  @ArrayMaxSize(MAX_VARIABLES)
  @ValidateNested({ each: true })
  @Type(() => PromptTemplateVariableDto)
  variables!: PromptTemplateVariableDto[];
}
