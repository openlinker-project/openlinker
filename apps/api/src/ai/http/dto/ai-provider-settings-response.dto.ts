/**
 * AI Provider Settings Response DTO
 *
 * Response body for `GET /ai-provider-settings`. Reports the currently
 * active provider, when/who last switched it, and the per-provider key
 * status. The DTO has no `apiKey` field — keys never leave the server.
 *
 * @module apps/api/src/ai/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  AiProviderKeySource,
  AiProviderKeySourceValues,
  AiProvider,
  AiProviderValues,
  type AiProviderSettingsView,
} from '@openlinker/core/ai';
import type { MultiProviderSettingsView } from '@openlinker/core/ai/application/services/ai-provider-active-settings.service.interface';

export class AiProviderRowDto {
  @ApiProperty({ enum: AiProviderValues })
  provider!: AiProvider;

  @ApiProperty({ description: 'True when an API key is currently resolvable for this provider.' })
  configured!: boolean;

  @ApiProperty({
    enum: AiProviderKeySourceValues,
    description:
      'Where the key resolves from. `db` wins over `env` when both are set; `none` when neither is set.',
  })
  source!: AiProviderKeySource;

  static fromView(view: AiProviderSettingsView): AiProviderRowDto {
    const dto = new AiProviderRowDto();
    dto.provider = view.provider;
    dto.configured = view.configured;
    dto.source = view.source;
    return dto;
  }
}

export class AiProviderSettingsResponseDto {
  @ApiProperty({
    enum: AiProviderValues,
    description:
      'Currently active provider. `AI_COMPLETION_PORT_TOKEN` routes every completion to this provider.',
  })
  activeProvider!: AiProvider;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'When the active selection was last changed. `null` on first-boot env-fallback resolution.',
  })
  activeUpdatedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who last changed the active selection. `null` on env-fallback resolution.',
  })
  activeUpdatedBy!: string | null;

  @ApiProperty({ type: [AiProviderRowDto] })
  providers!: AiProviderRowDto[];

  static fromView(view: MultiProviderSettingsView): AiProviderSettingsResponseDto {
    const dto = new AiProviderSettingsResponseDto();
    dto.activeProvider = view.activeProvider;
    dto.activeUpdatedAt = view.activeUpdatedAt ? view.activeUpdatedAt.toISOString() : null;
    dto.activeUpdatedBy = view.activeUpdatedBy;
    dto.providers = view.providers.map((row) => AiProviderRowDto.fromView(row));
    return dto;
  }
}
