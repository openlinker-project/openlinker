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
import { LoginPageCopyDto } from './login-page-copy.dto';

export class SystemConfigDto {
  @ApiProperty({ description: 'True when OL_DEMO_MODE=true is set in the environment.' })
  demoMode!: boolean;

  @ApiProperty({
    description:
      'True when the install stores buyer personal data (OL_STORE_PII, default true). When false, ' +
      'order search indexes only order numbers and SKUs, so the UI must not offer buyer name/email search.',
  })
  storesPersonalData!: boolean;

  @ApiProperty({
    description:
      'True when OL_REGISTRATION_ENABLED=true, i.e. the login page may offer sign-up (demo) or a request for access (a real install).',
  })
  registrationEnabled!: boolean;

  @ApiPropertyOptional({
    type: LoginPageCopyDto,
    description:
      'Login-page copy overrides an admin or env set, per language. Omitted in demo mode, whose copy is fixed in the frontend.',
  })
  @Type(() => LoginPageCopyDto)
  loginPage?: LoginPageCopyDto;

  @ApiPropertyOptional({
    type: DemoIntegrationsDto,
    description:
      'Demo-only third-party integration config (e.g. PostHog). Present only when demo mode is active and the provider is configured.',
  })
  @Type(() => DemoIntegrationsDto)
  demoIntegrations?: DemoIntegrationsDto;
}
