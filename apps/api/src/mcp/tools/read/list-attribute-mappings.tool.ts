/**
 * `list_attribute_mappings` MCP Tool
 *
 * Reads the operator's configured source-attribute → destination-parameter
 * mappings for one destination connection (#1488), the attribute-side
 * companion to `list_category_mappings`.
 *
 * CAVEAT surfaced in the tool description: this returns the rows keyed to the
 * destination connection. A destination that BORROWS its taxonomy (#1045 —
 * e.g. Erli consuming Allegro ids) resolves through the owner's
 * provenance-matching rows instead, so on such a connection this list can
 * differ from what the projection actually applies. `project_attributes` shows
 * the resolved truth; this shows what is stored here.
 *
 * Not capability-gated — see `list_category_mappings` for why.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { AttributeMapping, IMappingConfigService } from '@openlinker/core/mappings';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult } from './tool-result';

export function createListAttributeMappingsTool(
  mappingConfigService: IMappingConfigService
): McpToolDefinition {
  return {
    name: 'list_attribute_mappings',
    requiredCapability: null,
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      "List the attribute mappings stored for a destination connection (source attribute key → destination parameter name, with per-value remaps). These are the rows keyed to THIS destination; a destination that borrows another platform's taxonomy resolves against the owner's rows instead, so use project_attributes to see what a publish would actually send. An empty list means none are configured here yet.",
    inputSchema: z.object({
      destinationConnectionId: z
        .string()
        .describe('Destination connection id, from list_connections.'),
    }),
    handler: async (args): Promise<CallToolResult> => {
      const destinationConnectionId = args.destinationConnectionId as string;
      const mappings = await mappingConfigService.getAttributeMappings(destinationConnectionId);
      return jsonResult(mappings.map(projectAttributeMapping));
    },
  };
}

function projectAttributeMapping(mapping: AttributeMapping): Record<string, unknown> {
  return {
    id: mapping.id,
    sourceConnectionId: mapping.sourceConnectionId,
    sourceAttributeKey: mapping.sourceAttributeKey,
    destinationParameterName: mapping.destinationParameterName,
    destinationCategoryId: mapping.destinationCategoryId,
    destinationTaxonomyProvenance: mapping.destinationTaxonomyProvenance,
    // Enumerated, not spread: a field added to AttributeValueMapping later must
    // not start flowing to an external LLM provider without a deliberate edit.
    values: mapping.values.map((value) => ({
      sourceValue: value.sourceValue,
      destinationValue: value.destinationValue,
    })),
  };
}
