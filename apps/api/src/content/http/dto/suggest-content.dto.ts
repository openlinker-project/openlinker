/**
 * Suggest Content DTO
 *
 * Request body for `POST /products/:id/content/suggest`. Carries the channel
 * key (or `null` for the master template), plus optional tone + operator
 * instructions forwarded into the prompt-template variables.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PromptTemplateChannel } from '@openlinker/core/ai';

export class SuggestContentDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Optional channel scoping. Matches `connection.platformType` for ' +
      'channel-specific templates (e.g. "allegro"). Null/omitted resolves ' +
      'to the master template. Open-world per #580 — channel is opaque at ' +
      'the AI layer; the same string axis as `platformType`.',
    example: 'allegro',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
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
