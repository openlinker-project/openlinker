/**
 * MCP Resource Identifier
 *
 * Single source of truth for the RFC 8707 resource identifier this
 * deployment serves (#1486).
 *
 * This value is stamped onto every MCP token at mint time AND re-checked on
 * every request at verify time. Those are two halves of one contract: if the
 * two sides ever resolve it differently, previously-minted tokens fail with a
 * bare 401 and no further diagnostic. Keeping it in one function is what makes
 * that divergence impossible.
 *
 * @module apps/api/src/mcp
 */

/**
 * The route the MCP Streamable-HTTP ingress is served on.
 *
 * ⚠️ SECURITY-LOAD-BEARING. This single constant binds TWO things that must
 * never drift apart:
 *
 *   - `McpTransportController`'s `@Controller({ path })`
 *   - `McpModule.configure()`'s `requireBearerAuth` middleware `forRoutes({ path })`
 *
 * The MCP SDK handler performs NO verification of its own — its own words:
 * "the entry performs no token verification: `authInfo` … is never derived
 * from request headers." Authentication rests entirely on the middleware
 * having populated `req.auth` first. So if these two paths ever diverge, the
 * middleware silently stops matching and `/mcp` serves every request
 * UNAUTHENTICATED — a fail-OPEN mode. Sharing one constant makes that
 * divergence impossible; `mcp-token-auth.int-spec.ts` additionally asserts
 * that a header-less request is refused.
 *
 * Nest middleware paths are exact-match, so this does NOT gate `mcp/tokens`
 * (the admin surface, which uses ordinary session auth). That separation is
 * asserted in the int-spec.
 */
export const MCP_TRANSPORT_PATH = 'mcp';

/** Loopback default — correct for local dev, wrong for any real deployment. */
export const DEFAULT_MCP_RESOURCE_URL = 'http://localhost:3000/mcp';

export function resolveMcpResourceUrl(): string {
  const configured = process.env.OL_MCP_RESOURCE_URL;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  return DEFAULT_MCP_RESOURCE_URL;
}
