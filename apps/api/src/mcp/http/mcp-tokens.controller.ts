/**
 * MCP Tokens Controller
 *
 * Admin-only HTTP REST surface for managing MCP Personal Access Tokens
 * (#1486). A human mints tokens here from the settings UI, so these routes
 * use the ORDINARY session auth — the global `JwtAuthGuard` plus
 * `@Roles('admin')`.
 *
 * This is deliberately the opposite of `McpTransportController`, which is
 * `@Public()` + bearer-verified. Keeping the two auth models in separate
 * controllers is what stops them blurring.
 *
 * POST   /mcp/tokens      — mint a token (raw value returned exactly once)
 * GET    /mcp/tokens      — list tokens (never includes the raw value)
 * DELETE /mcp/tokens/:id  — revoke a token
 *
 * @module apps/api/src/mcp/http
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  MCP_TOKEN_SERVICE_TOKEN,
  type IMcpTokenService,
  type McpTokenSummary,
} from '@openlinker/core/users';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { resolveMcpResourceUrl } from '../mcp-resource';
import { CreateMcpTokenDto } from './dto/create-mcp-token.dto';
import { McpTokenCreatedResponseDto, McpTokenResponseDto } from './dto/mcp-token-response.dto';

@ApiTags('mcp')
@ApiBearerAuth()
@Controller('mcp/tokens')
export class McpTokensController {
  constructor(
    @Inject(MCP_TOKEN_SERVICE_TOKEN)
    private readonly mcpTokens: IMcpTokenService
  ) {}

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Mint an MCP token (admin only). Raw value is shown once.' })
  @ApiResponse({ status: 201, type: McpTokenCreatedResponseDto })
  async create(
    @Body() dto: CreateMcpTokenDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<McpTokenCreatedResponseDto> {
    const minted = await this.mcpTokens.mint({
      userId: user.id,
      name: dto.name,
      scope: dto.scope,
      expiresInDays: dto.expiresInDays,
      resource: resolveMcpResourceUrl(),
    });

    return {
      id: minted.id,
      userId: user.id,
      name: minted.name,
      resource: minted.resource,
      // Just minted against the current config, so it matches by construction.
      resourceMatchesCurrent: true,
      scopes: minted.scopes,
      createdAt: minted.createdAt.toISOString(),
      expiresAt: minted.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      isActive: true,
      rawToken: minted.rawToken,
    };
  }

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List MCP tokens (admin only). Never returns raw values.' })
  @ApiResponse({ status: 200, type: McpTokenResponseDto, isArray: true })
  async list(): Promise<McpTokenResponseDto[]> {
    const tokens = await this.mcpTokens.list();
    // Resolved once per request, not per row — it cannot change mid-listing.
    const configuredResource = resolveMcpResourceUrl();
    return tokens.map((token) => this.toResponse(token, configuredResource));
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an MCP token (admin only).' })
  @ApiResponse({ status: 204, description: 'Revoked' })
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const revoked = await this.mcpTokens.revoke(id, 'revoked_by_admin');
    if (!revoked) {
      throw new NotFoundException(`MCP token not found: ${id}`);
    }
  }

  private toResponse(token: McpTokenSummary, configuredResource: string): McpTokenResponseDto {
    return {
      id: token.id,
      userId: token.userId,
      name: token.name,
      resource: token.resource,
      resourceMatchesCurrent: token.resource === configuredResource,
      scopes: token.scopes,
      createdAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt.toISOString(),
      lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
      revokedAt: token.revokedAt ? token.revokedAt.toISOString() : null,
      isActive: token.isActive,
    };
  }
}
