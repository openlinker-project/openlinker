/**
 * Connection Response DTO
 *
 * Response DTO for connection operations. Maps domain entity to API response
 * format with all fields exposed.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { CoreCapabilityValues } from '@openlinker/core/integrations';
import type { UserRole } from '@openlinker/core/users';

export class ConnectionResponseDto {
  @ApiProperty({
    description: 'Connection ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({ description: 'Platform type', example: 'prestashop' })
  platformType!: string;

  @ApiProperty({ description: 'Connection name', example: 'Main PrestaShop Store' })
  name!: string;

  @ApiProperty({
    description: 'Connection status',
    enum: ['active', 'disabled', 'error'],
    example: 'active',
  })
  status!: string;

  @ApiProperty({
    description: 'Connection configuration (JSONB)',
    example: { baseUrl: 'https://example.com' },
  })
  config!: Record<string, unknown>;

  @ApiProperty({
    description:
      'Whether credentials are stored in the database (true = editable via PUT /credentials; false = sourced from environment variable)',
    example: true,
  })
  credentialsBacked!: boolean;

  @ApiPropertyOptional({ description: 'Adapter key', example: 'prestashop.webservice.v1' })
  adapterKey?: string;

  @ApiProperty({
    description:
      'Capabilities enabled on this connection (operator-chosen subset of supportedCapabilities). Well-known values listed in `enum`; plugin-registered capability names also accepted.',
    isArray: true,
    enum: CoreCapabilityValues,
  })
  enabledCapabilities!: string[];

  @ApiProperty({
    description:
      'Capabilities supported by the resolved adapter (derived, not persisted). Well-known values listed in `enum`; plugin-registered capability names also accepted.',
    isArray: true,
    enum: CoreCapabilityValues,
  })
  supportedCapabilities!: string[];

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: Date;

  static fromDomain(
    connection: Connection,
    supportedCapabilities: string[],
    role?: UserRole,
    isDemoModeEnabled = false
  ): ConnectionResponseDto {
    const dto = new ConnectionResponseDto();
    dto.id = connection.id;
    dto.platformType = connection.platformType;
    dto.name = connection.name;
    dto.status = connection.status;
    // Deny-by-default: config is projected for admin callers, and for the
    // read-only 'viewer' role specifically while the deployment is in demo
    // mode — the demo viewer is meant to see real (but non-editable) config
    // per #1616. Every other non-admin case (in particular a production
    // 'operator', with or without demo mode) still gets {} so raw platform
    // config, OAuth client IDs, or shop URLs are never included in a
    // real non-admin response (#1124's protection is unchanged).
    const canViewConfig = role === 'admin' || (isDemoModeEnabled && role === 'viewer');
    dto.config = canViewConfig ? connection.config : {};
    dto.credentialsBacked = connection.credentialsRef.startsWith('db:');
    dto.adapterKey = connection.adapterKey;
    dto.enabledCapabilities = connection.enabledCapabilities;
    dto.supportedCapabilities = supportedCapabilities;
    dto.createdAt = connection.createdAt;
    dto.updatedAt = connection.updatedAt;
    return dto;
  }
}
