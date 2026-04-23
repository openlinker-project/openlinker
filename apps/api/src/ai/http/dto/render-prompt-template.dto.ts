/**
 * Render Prompt Template DTO
 *
 * Request body for `POST /prompt-templates/:id/render` (admin preview). Carries
 * the caller-supplied variable values as an opaque JSON object — the declared
 * variables drive validation semantics at render time, not class-validator.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class RenderPromptTemplateDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Values used to substitute declared variables. Keys match variable names (dotted paths supported).',
  })
  @IsObject()
  values!: Record<string, unknown>;
}
