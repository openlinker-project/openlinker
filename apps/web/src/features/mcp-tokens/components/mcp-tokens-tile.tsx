/**
 * MCP Tokens Tile
 *
 * Settings-index row linking to the MCP token page (#1486).
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { useMcpTokensQuery } from '../hooks/use-mcp-tokens-query';

function McpTokensLive(): ReactElement {
  const copy = useMessages('mcp-tokens').mcpTokensTile;
  const tokensQuery = useMcpTokensQuery();
  const activeCount = tokensQuery.data?.filter((token) => token.isActive).length ?? null;

  return (
    <SettingsIndexRow
      title={copy.title}
      description={copy.description}
      valueState={tokensQuery.isLoading ? 'loading' : tokensQuery.isError ? 'error' : 'ready'}
      value={activeCount === null ? '-' : activeCount}
      note={copy.activeTokens}
      action={{ label: copy.manage, to: '/settings/mcp-tokens' }}
    />
  );
}

export function McpTokensTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('mcp-tokens').mcpTokensTile;
  return locked ? (
    <SettingsIndexRow locked title={copy.title} description={copy.description} />
  ) : (
    <McpTokensLive />
  );
}
