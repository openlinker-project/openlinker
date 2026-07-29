import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const mcpTokensRoute: RouteObject = {
  path: 'settings/mcp-tokens',
  handle: { crumb: { group: 'Settings', title: 'MCP tokens' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { McpTokensPage } = await import('../../pages/mcp-tokens/mcp-tokens-page');
    return { Component: McpTokensPage };
  },
};
