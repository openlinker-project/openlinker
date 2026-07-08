/**
 * PostHog Demo Integration DTO
 *
 * Nested response shape for the `demoIntegrations.posthog` block on
 * GET /system/config. Only ever populated server-side from env vars, never
 * from user input — see `SystemService.getConfig()`.
 *
 * @module apps/api/src/system/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class PosthogDemoIntegrationDto {
  @ApiProperty({ description: 'PostHog project API key (publishable, write-only ingestion key).' })
  key!: string;

  @ApiProperty({ description: 'PostHog ingestion host, e.g. https://eu.posthog.com.' })
  host!: string;
}
