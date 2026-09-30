/**
 * Connection Response DTO
 *
 * Response DTO for connection operations. Maps domain entity to API response
 * format with all fields exposed.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Connection, ConnectionRateLimit } from '@openlinker/core/identifier-mapping';
import {
  CoreCapabilityValues,
  VariantGroupingModelValues,
} from '@openlinker/core/integrations';
import { VariantGroupingModel } from '@openlinker/core/integrations';
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
      'Whether credentials are editable via PUT /credentials: true for a database-backed credential, and for a connection whose adapter needs credentials but holds none (a restored archived connection, #3657); false when they are sourced from an environment variable or the adapter takes none. Read `credentialsStored` to tell whether a value is actually present.',
    example: true,
  })
  credentialsBacked!: boolean;

  @ApiProperty({
    description:
      'Whether a credential row is currently stored for this connection. false on a restored archived connection until credentials are re-entered (#3657).',
    example: true,
  })
  credentialsStored!: boolean;

  @ApiProperty({
    description:
      'Whether the connection may be archived once disabled. false for an adapter that declares it (the OpenLinker OMS), which can only be disabled (#3657).',
    example: true,
  })
  archivable!: boolean;

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

  @ApiProperty({
    description:
      "How this destination groups sibling variants into one listing, and therefore whether - and how consequentially - a single variant may carry its own category (derived from the resolved adapter's manifest, defaulting to the most restrictive shape when undeclared).",
    enum: VariantGroupingModelValues,
  })
  variantGrouping!: VariantGroupingModel;

  @ApiProperty({
    description:
      "The resolved adapter's fallback outbound rate limit, applied whenever this connection has no explicit `config.rateLimit` (derived from the adapter manifest, not persisted). `null` when the adapter declares none, meaning an empty `config.rateLimit` is truly unlimited. Lets the FE render the real effective policy instead of assuming 'unlimited' whenever the form fields are empty.",
    example: { requestsPerMinute: 60, maxConcurrent: 4 },
    nullable: true,
  })
  defaultRateLimit!: ConnectionRateLimit | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: Date;

  static fromDomain(
    connection: Connection,
    supportedCapabilities: string[],
    variantGrouping: VariantGroupingModel,
    defaultRateLimit: ConnectionRateLimit | null,
    role?: UserRole,
    isDemoModeEnabled = false,
    requiresCredentials = true,
    archivable = true
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
    // #3657 — an empty ref on an adapter that needs credentials is a
    // credential-less restored connection: PUT /credentials stores a fresh one,
    // so it is editable. An empty ref on a credential-less adapter (ADR-055) is
    // not - there is nothing to enter.
    dto.credentialsStored = connection.credentialsRef.startsWith('db:');
    dto.credentialsBacked =
      dto.credentialsStored || (connection.credentialsRef === '' && requiresCredentials);
    dto.archivable = archivable;
    dto.adapterKey = connection.adapterKey;
    dto.enabledCapabilities = connection.enabledCapabilities;
    dto.supportedCapabilities = supportedCapabilities;
    dto.variantGrouping = variantGrouping;
    dto.defaultRateLimit = defaultRateLimit;
    dto.createdAt = connection.createdAt;
    dto.updatedAt = connection.updatedAt;
    return dto;
  }
}
