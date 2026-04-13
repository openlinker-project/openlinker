/**
 * Update Connection Credentials DTO
 *
 * Request DTO for rotating a connection's stored credentials. The payload is
 * a platform-specific JSON object written into the `integration_credentials`
 * row referenced by the connection's `credentialsRef`. The connection row
 * itself is not modified.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsObject, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateConnectionCredentialsDto {
  @ApiProperty({
    description: 'Platform-specific credential payload (replaces the stored value).',
    example: { webserviceApiKey: 'NEW_KEY' },
  })
  @IsObject()
  @IsNotEmpty()
  credentials!: Record<string, unknown>;
}
