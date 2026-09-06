/**
 * MCP Tokens Tile
 *
 * Admin-only settings tile linking to the MCP token page (#1486).
 * Mirrors `MailerSettingsTile` / `PosthogSettingsTile`.
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useMcpTokensQuery } from '../hooks/use-mcp-tokens-query';

export function McpTokensTile(): ReactElement {
  const tokensQuery = useMcpTokensQuery();
  // A degraded response (a 500 handled into an empty object, a partial
  // payload) can arrive as a successful query whose `data` is not actually
  // an array — `?? null` alone only guards `undefined`, not a truthy
  // non-array value, and `.filter` on that throws. Treating anything but a
  // real array as "unknown" (`null`, rendered as `—`) rather than crashing
  // or claiming zero matches the no-positive-claim-from-absent-data
  // convention documented for the returns surfaces in
  // docs/architecture-overview.md.
  const activeCount = Array.isArray(tokensQuery.data)
    ? tokensQuery.data.filter((token) => token.isActive).length
    : null;

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Agents</p>
          <h3 className="section-title">MCP tokens</h3>
        </div>
        <span className="panel__meta">Admin only</span>
      </div>
      <dl className="definition-list">
        <div>
          <dt>Active tokens</dt>
          <dd className="mono-text">
            {tokensQuery.isLoading ? '…' : activeCount === null ? '—' : activeCount}
          </dd>
        </div>
      </dl>
      <p className="muted-text">
        Personal access tokens that let an MCP client authenticate to this OpenLinker instance.
      </p>
      <Link className="button button--secondary button--sm" to="/settings/mcp-tokens">
        Manage tokens
      </Link>
    </article>
  );
}
