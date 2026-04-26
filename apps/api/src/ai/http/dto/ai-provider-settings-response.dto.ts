/**
 * AI Provider Settings Response DTO
 *
 * Response body for `GET /ai-provider-settings`. Reports the active
 * provider, whether a key is currently resolvable, and where the key
 * resolves from (`db | env | none`). The DTO has no `apiKey` field —
 * the value never leaves the server.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  AiProviderKeySource,
  AiProviderKeySourceValues,
  AiProviderSettingsView,
  AiProvider,
  AiProviderValues,
} from '@openlinker/core/ai';

export class AiProviderSettingsResponseDto {
  @ApiProperty({
    enum: AiProviderValues,
    description: 'Active provider read from `OL_AI_PROVIDER` (default: `anthropic`).',
  })
  provider!: AiProvider;

  @ApiProperty({
    description: 'True when an API key is currently resolvable for the active provider.',
  })
  configured!: boolean;

  @ApiProperty({
    enum: AiProviderKeySourceValues,
    description:
      'Where the key resolves from. `db` wins over `env` when both are set; `none` when neither is set.',
  })
  source!: AiProviderKeySource;

  static fromView(view: AiProviderSettingsView): AiProviderSettingsResponseDto {
    const dto = new AiProviderSettingsResponseDto();
    dto.provider = view.provider;
    dto.configured = view.configured;
    dto.source = view.source;
    return dto;
  }
}
