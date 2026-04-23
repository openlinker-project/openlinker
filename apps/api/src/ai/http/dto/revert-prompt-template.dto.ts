/**
 * Revert Prompt Template DTO
 *
 * Request body for `POST /prompt-templates/revert`. Identifies a historical
 * version by its `(key, channel, version)` coordinates; the service inserts
 * a new draft cloning that version's content.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import {
  PromptTemplateChannelValues,
  type PromptTemplateChannel,
} from '@openlinker/core/ai';

export class RevertPromptTemplateDto {
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

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
