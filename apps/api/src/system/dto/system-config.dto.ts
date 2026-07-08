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
import { IsOptional, ValidateNested } from 'class-validator';
import { DemoIntegrationsDto } from './demo-integrations.dto';

export class SystemConfigDto {
  @ApiProperty({ description: 'True when OL_DEMO_MODE=true is set in the environment.' })
  demoMode!: boolean;

  @ApiPropertyOptional({
    type: DemoIntegrationsDto,
    description:
      'Demo-only third-party integration config (e.g. PostHog). Present only when demo mode is active and the provider is configured.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DemoIntegrationsDto)
  demoIntegrations?: DemoIntegrationsDto;
}
