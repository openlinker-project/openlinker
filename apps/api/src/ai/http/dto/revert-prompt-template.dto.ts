/**
 * Revert Prompt Template DTO
 *
 * Request body for `POST /prompt-templates/revert`. Identifies a historical
 * version by its `(key, channel, version)` coordinates; the service inserts
 * a new draft cloning that version's content.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { PromptTemplateChannel } from '@openlinker/core/ai';

export class RevertPromptTemplateDto {
  @ApiProperty({ example: 'offer.description.suggest', maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  key!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'null = master (generic) template; otherwise a channel-specific one. ' +
      'Channel is an open-world string axis (#580) matching `connection.platformType`.',
    example: 'allegro',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  channel!: PromptTemplateChannel | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
