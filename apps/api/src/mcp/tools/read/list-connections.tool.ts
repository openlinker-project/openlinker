/**
 * `list_connections` MCP Tool
 *
 * The discovery entry point: tells the agent which connections exist, what
 * platform each is, and which capabilities are enabled on it — so it can pick
 * a sensible `connectionId` for the tools that take one.
 *
 * Always registered (no capability gate): a deployment with zero connections
 * still needs to be able to say so.
 *
 * SECURITY: PROJECTS the connection. A `Connection` carries `credentialsRef`
 * (a pointer into encrypted credential storage) and a free-form operator
 * `config` JSONB; neither is appropriate to hand to an external LLM provider.
 * Only id / name / platformType / status / enabledCapabilities leave here.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Connection } from '@openlinker/core/identifier-mapping';

import type { IConnectionService } from '../../../integrations/application/interfaces/connection.service.interface';
import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult } from './tool-result';

export function createListConnectionsTool(
  connectionService: IConnectionService
): McpToolDefinition {
  return {
    name: 'list_connections',
    requiredCapability: null,
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      'List the integration connections configured in OpenLinker (id, name, platform, status, enabled capabilities). Call this first to discover which connectionId to pass to other tools. An empty list means no connections are configured.',
    inputSchema: z.object({}),
    handler: async (): Promise<CallToolResult> => {
      const connections = await connectionService.list();
      return jsonResult(connections.map(projectConnection));
    },
  };
}

function projectConnection(connection: Connection): Record<string, unknown> {
  return {
    id: connection.id,
    name: connection.name,
    platformType: connection.platformType,
    status: connection.status,
    enabledCapabilities: connection.enabledCapabilities,
  };
}
