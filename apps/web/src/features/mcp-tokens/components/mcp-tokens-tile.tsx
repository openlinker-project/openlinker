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
import { useMessages } from '../../../shared/i18n';
import { useMcpTokensQuery } from '../hooks/use-mcp-tokens-query';

export function McpTokensTile(): ReactElement {
  const copy = useMessages('mcp-tokens').mcpTokensTile;
  const tokensQuery = useMcpTokensQuery();
  const activeCount = tokensQuery.data?.filter((token) => token.isActive).length ?? null;

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.adminOnly}</span>
      </div>
      <dl className="definition-list">
        <div>
          <dt>{copy.activeTokens}</dt>
          <dd className="mono-text">
            {tokensQuery.isLoading ? '…' : activeCount === null ? '—' : activeCount}
          </dd>
        </div>
      </dl>
      <p className="muted-text">{copy.description}</p>
      <Link className="button button--secondary button--sm" to="/settings/mcp-tokens">
        {copy.manage}
      </Link>
    </article>
  );
}
