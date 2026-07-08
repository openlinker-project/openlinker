/**
 * Demo Integrations DTO
 *
 * Vendor-neutral container for demo-only third-party integration config on
 * GET /system/config. Each provider gets its own namespaced, optional
 * sub-key (today: `posthog`) so adding a future provider (e.g. support-chat)
 * is additive rather than a reshape. See ADR-032.
 *
 * @module apps/api/src/system/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { PosthogDemoIntegrationDto } from './posthog-demo-integration.dto';

export class DemoIntegrationsDto {
  @ApiPropertyOptional({ type: PosthogDemoIntegrationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosthogDemoIntegrationDto)
  posthog?: PosthogDemoIntegrationDto;
}
