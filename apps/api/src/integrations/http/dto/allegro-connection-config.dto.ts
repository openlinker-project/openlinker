/**
 * Allegro Connection Config DTO
 *
 * Request DTO for Allegro connection configuration. Validates Allegro-specific
 * config fields (environment, apiBaseUrl) and provides Swagger documentation.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Allegro environment values
 */
export enum AllegroEnvironment {
  SANDBOX = 'sandbox',
  PRODUCTION = 'production',
}

/**
 * Allegro Connection Config DTO
 *
 * Configuration for an Allegro connection. Environment is required;
 * apiBaseUrl is optional and defaults based on environment.
 */
export class AllegroConnectionConfigDto {
  @ApiProperty({
    description: 'Allegro environment (sandbox or production)',
    enum: AllegroEnvironment,
    example: AllegroEnvironment.SANDBOX,
  })
  @IsEnum(AllegroEnvironment)
  environment!: AllegroEnvironment;

  @ApiPropertyOptional({
    description:
      'Allegro API base URL (optional, defaults based on environment). ' +
      'Sandbox: https://api.allegro.pl.allegrosandbox.pl, Production: https://api.allegro.pl. ' +
      'Note: OAuth authorization endpoints use https://allegro.pl.allegrosandbox.pl/auth/oauth/* (different base URL)',
    example: 'https://api.allegro.pl.allegrosandbox.pl',
  })
  @IsUrl({ require_tld: false })
  @IsOptional()
  @IsString()
  apiBaseUrl?: string;
}

