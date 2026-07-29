/**
 * OpenLinker MCP Token Verifier
 *
 * The Resource-Server seam (#1486, ADR-034). Implements the MCP SDK's
 * `OAuthTokenVerifier` — the SDK's own words: "intentionally narrower than
 * a full OAuth Authorization Server provider; it only covers the
 * verification step a Resource Server needs." That is ADR-034's decision
 * expressed as an interface, which is why OL implements it rather than
 * hand-rolling a bearer guard: `requireBearerAuth` then owns the 401/403
 * split, the `WWW-Authenticate` challenge, the OAuth error body, and
 * `requiredScopes` enforcement.
 *
 * A future OAuth Authorization Server (ADR-034's deferred upgrade) swaps
 * this implementation and nothing else moves.
 *
 * SECURITY: the returned `AuthInfo` carries the RAW bearer token in its
 * `token` field. It must never be logged or serialized wholesale — see
 * `mcp-principal.types.ts`. This class logs only redacted identity.
 *
 * @module apps/api/src/mcp/auth
 * @implements {OAuthTokenVerifier}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  OAuthError,
  OAuthErrorCode,
  checkResourceAllowed,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { Logger } from '@openlinker/shared/logging';
import { MCP_TOKEN_SERVICE_TOKEN, type IMcpTokenService } from '@openlinker/core/users';
import { resolveMcpResourceUrl } from '../mcp-resource';
import type { McpAuthInfoExtra } from './mcp-principal.types';

@Injectable()
export class OlMcpTokenVerifier implements OAuthTokenVerifier {
  private readonly logger = new Logger(OlMcpTokenVerifier.name);

  constructor(
    @Inject(MCP_TOKEN_SERVICE_TOKEN)
    private readonly mcpTokens: IMcpTokenService
  ) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const principal = await this.mcpTokens.resolvePrincipal(token);
    if (!principal) {
      // Deliberately opaque: unknown / revoked / expired / inactive-owner
      // all answer identically so the response can't be used as an oracle.
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or expired MCP token');
    }

    const configuredResource = resolveMcpResourceUrl();
    if (
      !checkResourceAllowed({
        requestedResource: principal.resource,
        configuredResource,
      })
    ) {
      this.logger.warn(
        `MCP token ${principal.tokenId} bound to a non-matching resource; rejecting`
      );
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token is not valid for this resource');
    }

    const extra: McpAuthInfoExtra = {
      mcpTokenId: principal.tokenId,
      tokenName: principal.tokenName,
      olUserId: principal.userId,
      olRole: principal.role,
    };

    return {
      token,
      // The credential, not the human — user identity rides in `extra`.
      clientId: principal.tokenId,
      scopes: [...principal.scopes],
      // Epoch SECONDS. Always set: the SDK rejects an unset expiresAt.
      expiresAt: Math.floor(principal.expiresAt.getTime() / 1000),
      resource: new URL(principal.resource),
      extra: { ...extra },
    };
  }
}
