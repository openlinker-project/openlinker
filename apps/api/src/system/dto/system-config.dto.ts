/**
 * System Config DTO
 *
 * Response shape for GET /system/config. Exposes server-driven flags
 * that the frontend reads once at startup (staleTime: Infinity).
 *
 * @module apps/api/src/system/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { DemoIntegrationsDto } from './demo-integrations.dto';

export class SystemConfigDto {
  @ApiProperty({ description: 'True when OL_DEMO_MODE=true is set in the environment.' })
  demoMode!: boolean;

  @ApiProperty({
    description:
      'True when the install stores buyer personal data (OL_STORE_PII, default true). When false, ' +
      'order search indexes only order numbers and SKUs, so the UI must not offer buyer name/email search.',
  })
  storesPersonalData!: boolean;

  @ApiPropertyOptional({
    type: DemoIntegrationsDto,
    description:
      'Demo-only third-party integration config (e.g. PostHog). Present only when demo mode is active and the provider is configured.',
  })
  @Type(() => DemoIntegrationsDto)
  demoIntegrations?: DemoIntegrationsDto;
}
