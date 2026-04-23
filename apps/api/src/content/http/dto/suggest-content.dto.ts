/**
 * Suggest Content DTO
 *
 * Request body for `POST /products/:id/content/suggest`. Carries the channel
 * key (or `null` for the master template), plus optional tone + operator
 * instructions forwarded into the prompt-template variables.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PromptTemplateChannelValues, type PromptTemplateChannel } from '@openlinker/core/ai';

export class SuggestContentDto {
  @ApiProperty({
    enum: PromptTemplateChannelValues,
    nullable: true,
    required: false,
    description: 'null = master (generic) template; otherwise a channel-specific one.',
  })
  @IsOptional()
  @IsIn(PromptTemplateChannelValues as unknown as string[])
  channel?: PromptTemplateChannel | null;

  @ApiProperty({ required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tone?: string;

  @ApiProperty({ required: false, maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  extraInstructions?: string;
}
