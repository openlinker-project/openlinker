/**
 * Archive Prompt Template DTO
 *
 * Request body for `POST /prompt-templates/:id/archive`. The body is
 * usually empty (`{}`) for the routine archive case (drafts and stale
 * published rows that have a replacement). `force` is only required to
 * archive a `published` row that is the only published version for its
 * `(key, channel)` pair — see #489.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ArchivePromptTemplateDto {
  @ApiPropertyOptional({
    description:
      'Bypass the "no other published version" guard. Required when archiving the only published row for a (key, channel) pair — the suggestion service will then have no template to render until a replacement is published.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
