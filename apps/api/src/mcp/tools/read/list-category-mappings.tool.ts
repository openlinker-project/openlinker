/**
 * `list_category_mappings` MCP Tool
 *
 * Reads the operator's configured source-category → destination-category
 * mappings for one destination connection (#1488). This is where the
 * mapping-assistant loop starts: see what is already mapped before proposing
 * anything new.
 *
 * Not capability-gated (`requiredCapability: null`). Mapping configuration is
 * OL-owned data, not adapter-served — gating it on a marketplace capability
 * would repeat the Phase-1 confusion in which a passing gate is misread as
 * implying the data exists.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { CategoryMapping, IMappingConfigService } from '@openlinker/core/mappings';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult } from './tool-result';

export function createListCategoryMappingsTool(
  mappingConfigService: IMappingConfigService
): McpToolDefinition {
  return {
    name: 'list_category_mappings',
    requiredCapability: null,
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      'List the category mappings configured for a destination connection (source category id → destination category). Call this before proposing a new mapping, to see what already exists. An empty list means no mappings are configured for that destination yet — not that the destination has no categories.',
    inputSchema: z.object({
      destinationConnectionId: z
        .string()
        .describe('Destination connection id, from list_connections.'),
    }),
    handler: async (args): Promise<CallToolResult> => {
      const destinationConnectionId = args.destinationConnectionId as string;
      const mappings = await mappingConfigService.getCategoryMappings(destinationConnectionId);
      return jsonResult(mappings.map(projectCategoryMapping));
    },
  };
}

function projectCategoryMapping(mapping: CategoryMapping): Record<string, unknown> {
  return {
    id: mapping.id,
    sourceConnectionId: mapping.sourceConnectionId,
    sourceCategoryId: mapping.sourceCategoryId,
    destinationCategoryId: mapping.destinationCategoryId,
    destinationCategoryName: mapping.destinationCategoryName,
    destinationCategoryPath: mapping.destinationCategoryPath,
    destinationTaxonomyProvenance: mapping.destinationTaxonomyProvenance,
  };
}
