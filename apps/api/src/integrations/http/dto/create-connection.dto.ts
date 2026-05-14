/**
 * Create Connection DTO
 *
 * Request DTO for creating a new connection. Validates input and provides
 * Swagger documentation for the API endpoint.
 *
 * Callers supply credentials one of two ways:
 *  - `credentials`: a platform-specific JSON object (e.g. `{ webserviceApiKey }`
 *    for PrestaShop). The service persists it in the `integration_credentials`
 *    table and stores a `db:<uuid>` reference on the connection.
 *  - `credentialsRef`: an already-issued reference (must start with `db:`),
 *    used by OAuth flows that persist the credential themselves.
 *
 * Exactly one of the two must be provided.
 *
 * @module apps/api/src/integrations/http/dto
 */
import type { ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsArray,
  IsIn,
  Matches,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CoreCapability } from '@openlinker/core/integrations';
import { CoreCapabilityValues } from '@openlinker/core/integrations';

@ValidatorConstraint({ name: 'CredentialsXor', async: false })
class CredentialsXorConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CreateConnectionDto;
    const hasCreds = obj.credentials !== undefined && obj.credentials !== null;
    const hasRef = typeof obj.credentialsRef === 'string' && obj.credentialsRef.length > 0;
    return hasCreds !== hasRef; // exactly one
  }
  defaultMessage(): string {
    return 'Exactly one of `credentials` or `credentialsRef` must be provided';
  }
}

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

  @ApiPropertyOptional({
    description:
      'Platform-specific credential payload (e.g. `{ webserviceApiKey }` for PrestaShop). ' +
      'When provided, the API persists it in the integration credentials store and sets ' +
      'credentialsRef to `db:<uuid>` automatically. Mutually exclusive with credentialsRef.',
    example: { webserviceApiKey: 'XXXXX' },
  })
  @IsOptional()
  @IsObject()
  @IsNotEmpty()
  @Validate(CredentialsXorConstraint)
  credentials?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Existing credentials reference (must start with `db:`). Used by OAuth flows ' +
      'that persist the credential themselves. Mutually exclusive with `credentials`.',
    example: 'db:550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^db:/, {
    message: 'credentialsRef must start with "db:" — raw keys are no longer accepted',
  })
  credentialsRef?: string;

  @ApiPropertyOptional({
    description: 'Adapter key (optional, defaults from platformType in service)',
    example: 'prestashop.webservice.v1',
  })
  @IsString()
  @IsOptional()
  adapterKey?: string;

  @ApiPropertyOptional({
    description:
      'Capabilities this connection should fulfil. Defaults to the adapter\u2019s full supported set when omitted. Must be a subset of supportedCapabilities.',
    isArray: true,
    enum: CoreCapabilityValues,
  })
  @IsArray()
  @IsIn(CoreCapabilityValues, { each: true })
  @IsOptional()
  enabledCapabilities?: CoreCapability[];
}
