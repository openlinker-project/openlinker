/**
 * MCP Token Response DTOs
 *
 * Read + create response shapes for the admin MCP-token surface (#1486).
 *
 * `McpTokenResponseDto` deliberately carries neither the raw token nor its
 * hash — the raw value exists exactly once, in
 * `McpTokenCreatedResponseDto.rawToken`, and is never re-derivable.
 *
 * @module apps/api/src/mcp/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { McpTokenScopeValues, type McpTokenScope } from '@openlinker/core/users';

export class McpTokenResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'Owner of this token. Present because the admin listing is deployment-wide (single-tenant, ADR-034) — without it an admin cannot tell whose token they are revoking.',
  })
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: McpTokenScopeValues, isArray: true })
  scopes!: McpTokenScope[];

  @ApiProperty({
    description: 'RFC 8707 resource this token is bound to, as stamped at mint time.',
  })
  resource!: string;

  @ApiProperty({
    description:
      'False when `resource` no longer matches this deployment\'s configured OL_MCP_RESOURCE_URL — the token will fail with a bare 401 until re-minted. Computed server-side so the browser never needs the config value.',
  })
  resourceMatchesCurrent!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty({ nullable: true, type: String })
  lastUsedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  revokedAt!: string | null;

  @ApiProperty({ description: 'False once revoked or expired.' })
  isActive!: boolean;
}

export class McpTokenCreatedResponseDto extends McpTokenResponseDto {
  @ApiProperty({
    description:
      'The raw token. Shown exactly once — it is stored hashed and can never be retrieved again.',
  })
  rawToken!: string;
}
