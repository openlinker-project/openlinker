/**
 * PostHog Settings Response DTO
 *
 * Response body for `GET /posthog-settings`. Reports the non-secret
 * settings fields plus whether an API key is currently configured (DB or
 * env) and whether a saved row would override an env var — the key value
 * itself, and any env var *value*, never leave the server.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  PosthogRegion,
  PosthogRegionValues,
  type PosthogSettingsView,
} from '@openlinker/core/analytics';

export class PosthogSettingsResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ enum: PosthogRegionValues })
  region!: PosthogRegion;

  @ApiProperty({ type: String, nullable: true })
  customHost!: string | null;

  @ApiProperty()
  autocapture!: boolean;

  @ApiProperty()
  sessionRecording!: boolean;

  @ApiProperty({ description: 'True when an API key is currently resolvable (DB or env).' })
  apiKeyConfigured!: boolean;

  @ApiProperty({ description: 'True when a saved, enabled row would override a set env var.' })
  wouldOverrideEnv!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Names of the env vars shadowed by the saved row, e.g. ["OL_POSTHOG_KEY"].',
  })
  overriddenEnvVars!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the settings were last changed. `null` when no row exists yet.',
  })
  updatedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who last changed the settings. `null` when no row exists yet.',
  })
  updatedBy!: string | null;

  static fromView(view: PosthogSettingsView): PosthogSettingsResponseDto {
    const dto = new PosthogSettingsResponseDto();
    dto.enabled = view.enabled;
    dto.region = view.region;
    dto.customHost = view.customHost;
    dto.autocapture = view.autocapture;
    dto.sessionRecording = view.sessionRecording;
    dto.apiKeyConfigured = view.apiKeyConfigured;
    dto.wouldOverrideEnv = view.wouldOverrideEnv;
    dto.overriddenEnvVars = view.overriddenEnvVars;
    dto.updatedAt = view.updatedAt ? view.updatedAt.toISOString() : null;
    dto.updatedBy = view.updatedBy;
    return dto;
  }
}
