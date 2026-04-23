/**
 * Suggestion Response DTO
 *
 * Wire shape for `POST /products/:id/content/suggest`. Carries the AI's
 * suggested text plus correlation metadata (request id, template version,
 * token usage) so the FE can show the diff and backend logs can be joined.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SuggestionResult } from '@openlinker/core/content';

class SuggestionUsageDto {
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() cachedInputTokens!: number;
}

export class SuggestionResponseDto {
  @ApiProperty() suggestion!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() templateKey!: string;
  @ApiProperty() templateVersion!: number;
  @ApiProperty({ nullable: true }) templateChannel!: string | null;
  @ApiProperty() modelUsed!: string;
  @ApiProperty() latencyMs!: number;
  @ApiProperty({ type: SuggestionUsageDto }) usage!: SuggestionUsageDto;

  static fromDomain(result: SuggestionResult): SuggestionResponseDto {
    const dto = new SuggestionResponseDto();
    dto.suggestion = result.suggestion;
    dto.requestId = result.requestId;
    dto.templateKey = result.templateKey;
    dto.templateVersion = result.templateVersion;
    dto.templateChannel = result.templateChannel;
    dto.modelUsed = result.modelUsed;
    dto.latencyMs = result.latencyMs;
    dto.usage = result.usage;
    return dto;
  }
}
