/**
 * Update Connection DTO
 *
 * Request DTO for updating an existing connection. All fields are optional.
 * Only provided fields will be updated.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsOptional, IsObject, IsEnum, IsArray, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ConnectionStatusValues } from '@openlinker/core/identifier-mapping';
import type { CoreCapability } from '@openlinker/core/integrations';
import { CoreCapabilityValues } from '@openlinker/core/integrations';

export class UpdateConnectionDto {
  @ApiPropertyOptional({
    description: 'Connection name',
    example: 'Updated Store Name',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Connection status',
    enum: ConnectionStatusValues,
    example: 'active',
  })
  @IsEnum(ConnectionStatusValues)
  @IsOptional()
  status?: 'active' | 'disabled' | 'error';

  @ApiPropertyOptional({
    description: 'Connection configuration (JSONB)',
    example: { baseUrl: 'https://new-url.com' },
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Adapter key',
    example: 'prestashop.webservice.v2',
  })
  @IsString()
  @IsOptional()
  adapterKey?: string;

  @ApiPropertyOptional({
    description:
      'Capabilities enabled on this connection. Subset of the adapter\u2019s supportedCapabilities.',
    isArray: true,
    enum: CoreCapabilityValues,
  })
  @IsArray()
  @IsIn(CoreCapabilityValues, { each: true })
  @IsOptional()
  enabledCapabilities?: CoreCapability[];
}
