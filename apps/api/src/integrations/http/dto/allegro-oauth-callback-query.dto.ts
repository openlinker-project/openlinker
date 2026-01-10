/**
 * Allegro OAuth Callback Query DTO
 *
 * Query parameters DTO for Allegro OAuth callback. Validates OAuth callback
 * parameters (code, state) returned by Allegro after user authorization.
 * Note: client credentials should NOT be passed via query parameters for security.
 * They should be retrieved from stored state or connection config.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Allegro OAuth Callback Query DTO
 *
 * Query parameters received from Allegro OAuth callback redirect.
 * Only contains the OAuth response parameters (code, state).
 * Client credentials are retrieved from stored state for security.
 */
export class AllegroOAuthCallbackQueryDto {
  @ApiProperty({
    description: 'OAuth authorization code from Allegro',
    example: 'authorization-code-123',
  })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({
    description: 'State parameter (must match the state sent in connect request)',
    example: 'random-state-string',
  })
  @IsString()
  @IsOptional()
  state?: string;
}



