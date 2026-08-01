/**
 * `project_attributes` MCP Tool
 *
 * Shows what a destination would actually receive for a given category and set
 * of source attributes (#1488) — the "did my mapping work?" read that closes
 * the mapping-assistant loop.
 *
 * This is the resolved truth, where `list_attribute_mappings` is the stored
 * configuration: the projection applies operator rules (#1841), borrowed-
 * taxonomy reuse (#1045), and the destination's live category schema. Its
 * `unmappedSourceKeys` / `unresolvedRequired` outputs are the actionable half —
 * they name exactly what an operator still has to map.
 *
 * Like `resolve_category`, the projection MAY consult the destination's live
 * category schema (the `CategoryParametersReader` branch), so this is not a
 * purely local read. One call per invocation.
 *
 * Not capability-gated — see `list_category_mappings` for why.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type {
  AttributeProjectionResult,
  IAttributeProjectionService,
} from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';

import type { McpToolDefinition } from '../tool-definition.types';
import { resolveDestinationContext } from './destination-context';
import { jsonResult } from './tool-result';

export function createProjectAttributesTool(
  attributeProjectionService: IAttributeProjectionService,
  integrationsService: IIntegrationsService
): McpToolDefinition {
  return {
    name: 'project_attributes',
    requiredCapability: null,
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      "Preview which destination parameters OpenLinker would send for a given destination category and set of source attributes, applying the configured attribute mappings and rules. Use this to verify a mapping before publishing. 'unmappedSourceKeys' lists source attributes that would be dropped; 'unresolvedRequired' lists destination parameters the publish still needs — both are the actionable output. Performs a live lookup of the destination's category schema, so call it per category, not in a loop.",
    inputSchema: z.object({
      destinationConnectionId: z
        .string()
        .describe('Destination connection id, from list_connections.'),
      sourceConnectionId: z.string().describe('Source (master) connection id.'),
      destinationCategoryId: z
        .string()
        .describe('Destination category id, e.g. from resolve_category.'),
      attributes: z
        .record(z.string(), z.string())
        .describe("The variant's source attributes, e.g. {\"Color\": \"Red\"}."),
    }),
    handler: async (args): Promise<CallToolResult> => {
      const destinationConnectionId = args.destinationConnectionId as string;
      // A shop serves its schema under `ProductPublisher` and does not support
      // `OfferManager`, so the default would throw for every shop connection.
      const context = await resolveDestinationContext(
        integrationsService,
        destinationConnectionId
      );

      const result = await attributeProjectionService.project({
        destinationConnectionId,
        sourceConnectionId: args.sourceConnectionId as string,
        destinationCategoryId: args.destinationCategoryId as string,
        attributes: args.attributes as Record<string, string>,
        destinationCapability: context.destinationCapability,
        // #1045 — without this a borrowing destination misses the owner's
        // mappings and the tool under-reports what would actually be sent.
        ...(context.borrowedTaxonomy ? { borrowedTaxonomy: context.borrowedTaxonomy } : {}),
      });
      return jsonResult(projectResult(result));
    },
  };
}

function projectResult(result: AttributeProjectionResult): Record<string, unknown> {
  return {
    // Enumerated rather than spread: an OfferParameter field added later must
    // not start flowing to an external LLM provider without a deliberate edit.
    parameters: result.parameters.map((parameter) => ({
      // `id` is the destination parameter id on the "owns" path and the
      // destination parameter NAME on the borrows/pass-through path — that
      // duality is the contract, so it is surfaced as-is rather than renamed.
      id: parameter.id,
      values: parameter.values,
      valuesIds: parameter.valuesIds,
      rangeValue: parameter.rangeValue,
      section: parameter.section,
    })),
    unmappedSourceKeys: result.unmappedSourceKeys,
    unresolvedRequired: result.unresolvedRequired.map((entry) => ({
      id: entry.id,
      name: entry.name,
      section: entry.section,
    })),
  };
}
