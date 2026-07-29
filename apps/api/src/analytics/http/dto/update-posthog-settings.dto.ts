/**
 * Update PostHog Settings DTO
 *
 * Request body for `PUT /posthog-settings`. Non-secret fields only — the
 * API key is written separately via `PUT /posthog-settings/credentials`.
 * `customHost` is required when `region === 'custom'`; the controller does
 * not cross-validate this (matching the Mailer settings precedent of
 * trusting the admin form) so an operator can stage a partial config before
 * switching region.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { PosthogRegion, PosthogRegionValues } from '@openlinker/core/analytics';

export class UpdatePosthogSettingsDto {
  @ApiProperty({ description: 'Whether PostHog analytics is enabled for the demo instance.' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: PosthogRegionValues })
  @IsIn(PosthogRegionValues as unknown as string[])
  region!: PosthogRegion;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Self-hosted PostHog host URL. Only used when region is "custom".',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  customHost?: string | null;

  @ApiProperty({ description: 'Automatically capture clicks, form submits, and page changes.' })
  @IsBoolean()
  autocapture!: boolean;

  @ApiProperty({ description: 'Record session replays (all text/inputs always masked).' })
  @IsBoolean()
  sessionRecording!: boolean;

  @ApiProperty({
    description:
      'Master toggle for demo-mode product events (#1787), independent of autocapture.',
  })
  @IsBoolean()
  productEventsEnabled!: boolean;

  @ApiProperty({
    type: [String],
    description:
      'Enabled demo-event group names (derived client-side from the demo-events catalog). Not validated against a closed enum — an unknown group name is simply never matched by any event.',
  })
  @IsArray()
  @IsString({ each: true })
  enabledEventGroups!: string[];
}
