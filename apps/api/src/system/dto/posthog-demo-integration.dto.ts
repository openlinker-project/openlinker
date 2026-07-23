/**
 * PostHog Demo Integration DTO
 *
 * Nested response shape for the `demoIntegrations.posthog` block on
 * GET /system/config. Populated from `IPosthogSettingsService.resolveConfig()`
 * (#1685) — an enabled DB row, or an env-var fallback — never from user
 * input at request time. See `SystemService.getConfig()`.
 *
 * @module apps/api/src/system/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class PosthogDemoIntegrationDto {
  @ApiProperty({ description: 'PostHog project API key (publishable, write-only ingestion key).' })
  key!: string;

  @ApiProperty({ description: 'PostHog ingestion host, e.g. https://eu.i.posthog.com.' })
  host!: string;

  @ApiProperty({ description: 'Whether posthog-js should enable autocapture (clicks, form submits, page changes).' })
  autocapture!: boolean;

  @ApiProperty({ description: 'Whether posthog-js should enable session recording (always masks all text/inputs).' })
  sessionRecording!: boolean;

  @ApiProperty({
    description:
      'Master toggle for demo-mode product events (#1787), independent of autocapture.',
  })
  productEventsEnabled!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Enabled demo-event group names, derived client-side from the events catalog.',
  })
  enabledEventGroups!: string[];
}
