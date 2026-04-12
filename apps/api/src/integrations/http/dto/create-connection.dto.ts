/**
 * Create Connection DTO
 *
 * Request DTO for creating a new connection. Validates input and provides
 * Swagger documentation for the API endpoint.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Capability, CapabilityValues } from '@openlinker/core/integrations';

export class CreateConnectionDto {
  @ApiProperty({
    description: 'Connection name',
    example: 'Main PrestaShop Store',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Platform type (e.g., prestashop, allegro)',
    example: 'prestashop',
  })
  @IsString()
  @IsNotEmpty()
  platformType!: string;

  @ApiProperty({
    description: 'Connection configuration (JSONB)',
    example: { baseUrl: 'https://example.com', shopId: '123' },
  })
  @IsObject()
  @IsNotEmpty()
  config!: Record<string, unknown>;

  @ApiProperty({
    description: 'Credentials reference',
    example: 'cred_abc123',
  })
  @IsString()
  @IsNotEmpty()
  credentialsRef!: string;

  @ApiPropertyOptional({
    description:
      'Adapter key (optional, defaults from platformType in service)',
    example: 'prestashop.webservice.v1',
  })
  @IsString()
  @IsOptional()
  adapterKey?: string;

  @ApiPropertyOptional({
    description:
      'Capabilities this connection should fulfil. Defaults to the adapter\u2019s full supported set when omitted. Must be a subset of supportedCapabilities.',
    isArray: true,
    enum: CapabilityValues,
  })
  @IsArray()
  @IsIn(CapabilityValues, { each: true })
  @IsOptional()
  enabledCapabilities?: Capability[];
}

