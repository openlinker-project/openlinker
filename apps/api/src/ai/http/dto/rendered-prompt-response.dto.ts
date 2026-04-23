/**
 * Rendered Prompt Response DTO
 *
 * Wire shape returned by the preview endpoint — the substituted
 * system + user prompt pair plus the template id + version that produced
 * them (for UI provenance display).
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { RenderedPrompt } from '@openlinker/core/ai';

export class RenderedPromptResponseDto {
  @ApiProperty() templateId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() systemPrompt!: string;
  @ApiProperty() userPrompt!: string;

  static fromDomain(rendered: RenderedPrompt): RenderedPromptResponseDto {
    const dto = new RenderedPromptResponseDto();
    dto.templateId = rendered.templateId;
    dto.version = rendered.version;
    dto.systemPrompt = rendered.systemPrompt;
    dto.userPrompt = rendered.userPrompt;
    return dto;
  }
}
