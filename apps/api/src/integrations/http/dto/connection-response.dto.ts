/**
 * Connection Response DTO
 *
 * Response DTO for connection operations. Maps domain entity to API response
 * format with all fields exposed.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Connection } from '@openlinker/core/identifier-mapping';
import { Capability, CapabilityValues } from '@openlinker/core/integrations';

export class ConnectionResponseDto {
  @ApiProperty({ description: 'Connection ID (UUID)', example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ description: 'Platform type', example: 'prestashop' })
  platformType!: string;

  @ApiProperty({ description: 'Connection name', example: 'Main PrestaShop Store' })
  name!: string;

  @ApiProperty({ description: 'Connection status', enum: ['active', 'disabled', 'error'], example: 'active' })
  status!: string;

  @ApiProperty({ description: 'Connection configuration (JSONB)', example: { baseUrl: 'https://example.com' } })
  config!: Record<string, unknown>;

  @ApiProperty({ description: 'Credentials reference', example: 'cred_abc123' })
  credentialsRef!: string;

  @ApiPropertyOptional({ description: 'Adapter key', example: 'prestashop.webservice.v1' })
  adapterKey?: string;

  @ApiProperty({
    description: 'Capabilities enabled on this connection (operator-chosen subset of supportedCapabilities)',
    isArray: true,
    enum: CapabilityValues,
  })
  enabledCapabilities!: Capability[];

  @ApiProperty({
    description: 'Capabilities supported by the resolved adapter (derived, not persisted)',
    isArray: true,
    enum: CapabilityValues,
  })
  supportedCapabilities!: Capability[];

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: Date;

  static fromDomain(
    connection: Connection,
    supportedCapabilities: Capability[],
  ): ConnectionResponseDto {
    const dto = new ConnectionResponseDto();
    dto.id = connection.id;
    dto.platformType = connection.platformType;
    dto.name = connection.name;
    dto.status = connection.status;
    dto.config = connection.config;
    dto.credentialsRef = connection.credentialsRef;
    dto.adapterKey = connection.adapterKey;
    dto.enabledCapabilities = connection.enabledCapabilities;
    dto.supportedCapabilities = supportedCapabilities;
    dto.createdAt = connection.createdAt;
    dto.updatedAt = connection.updatedAt;
    return dto;
  }
}

