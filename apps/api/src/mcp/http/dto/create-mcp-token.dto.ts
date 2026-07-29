/**
 * Create MCP Token DTO
 *
 * Request body for minting an MCP Personal Access Token (#1486).
 *
 * @module apps/api/src/mcp/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  MCP_TOKEN_MAX_EXPIRY_DAYS,
  McpTokenScopeValues,
  type McpTokenScope,
} from '@openlinker/core/users';

export class CreateMcpTokenDto {
  @ApiProperty({ description: 'Operator-facing label for this token', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    enum: McpTokenScopeValues,
    description: '`mcp:write` implies `mcp:read`; both are granted when write is requested.',
  })
  @IsIn(McpTokenScopeValues as readonly string[])
  scope!: McpTokenScope;

  @ApiPropertyOptional({
    description: 'Token lifetime in days. Defaults to 90.',
    minimum: 1,
    maximum: MCP_TOKEN_MAX_EXPIRY_DAYS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MCP_TOKEN_MAX_EXPIRY_DAYS)
  expiresInDays?: number;
}
