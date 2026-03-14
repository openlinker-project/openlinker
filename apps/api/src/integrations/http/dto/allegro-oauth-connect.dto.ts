/**
 * Allegro OAuth Connect DTO
 *
 * Request DTO for initiating Allegro OAuth flow. Validates required fields
 * for OAuth authorization URL generation.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsNotEmpty, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Allegro OAuth Connect DTO
 *
 * Request to initiate OAuth flow. Returns authorization URL that user
 * should redirect to for OAuth consent.
 */
export class AllegroOAuthConnectDto {
  @ApiProperty({
    description: 'Allegro OAuth client ID',
    example: 'your-client-id',
  })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({
    description: 'Allegro OAuth client secret',
    example: 'your-client-secret',
  })
  @IsString()
  @IsNotEmpty()
  clientSecret!: string;

  @ApiProperty({
    description: 'OAuth redirect URI (must match Allegro app configuration)',
    example: 'https://api.openlinker.com/integrations/allegro/oauth/callback',
  })
  @IsUrl({ require_tld: false })
  @IsString()
  @IsNotEmpty()
  redirectUri!: string;

  @ApiPropertyOptional({
    description: 'Allegro environment (sandbox or production)',
    example: 'sandbox',
  })
  @IsString()
  @IsOptional()
  environment?: string;

  @ApiPropertyOptional({
    description: 'State parameter for OAuth flow (optional, auto-generated if not provided)',
    example: 'random-state-string',
  })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({
    description: 'Connection name (optional, for creating connection after OAuth)',
    example: 'My Allegro Store',
  })
  @IsString()
  @IsOptional()
  connectionName?: string;
}

