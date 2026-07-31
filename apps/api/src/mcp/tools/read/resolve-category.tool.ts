/**
 * `resolve_category` MCP Tool
 *
 * Runs OL's deterministic destination-category placement chain (ADR-023 §1)
 * and reports what it resolved and how (#1488).
 *
 * NAMED `resolve`, NOT `suggest`. The underlying service is a deterministic
 * lookup chain — provision → barcode → configured mapping → manual — not a
 * semantic matcher. Calling it "suggest" would tell the agent that a `manual`
 * outcome means "no good suggestion was found", when it actually means
 * "nothing is mapped here — author a mapping". Semantic matching over a
 * searchable taxonomy is #1937 Wave 4.
 *
 * ⚠️ TWO WAYS THIS TOOL IS UNLIKE EVERY OTHER READ TOOL:
 *
 * 1. IT IS NOT PURELY OL-STORE-BACKED. The barcode step resolves the live
 *    destination adapter and calls `matchCategoryByBarcode` — a real
 *    marketplace request on the operator's API quota, the pattern ADR-033
 *    § Phase 1 amendments otherwise rejects. Admitted as a bounded exception:
 *    it is ONE call per invocation (not an N-call tree walk, which is exactly
 *    why `browse_categories` is deferred to #1937), and it is the entire value
 *    of the tool. The description says so, so a model does not loop on it.
 *
 * 2. ITS SCOPE IS COUPLED TO #1041. Step 1 of the chain is documented as
 *    "Provision — mirror/CREATE on the destination". It is inert today only
 *    because `CategoryResolutionService.tryProvision()` is a stub returning
 *    null, which is why `mcp:read` is correct HERE AND NOW. When #1041 wires
 *    `CategoryProvisioner`, this tool would start writing to the destination
 *    under a READ scope.
 *
 *    `resolve-category.tool.spec.ts` asserts this tool never reports
 *    `method: 'provision'`. That spec is the guard: it turns #1041 into a red
 *    build instead of a silent privilege escalation. If you are here because
 *    that spec failed — do not delete it; re-evaluate `requiredScope`.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type {
  CategoryResolutionResult,
  ICategoryResolutionService,
} from '@openlinker/core/listings';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult } from './tool-result';

export function createResolveCategoryTool(
  categoryResolutionService: ICategoryResolutionService
): McpToolDefinition {
  return {
    name: 'resolve_category',
    requiredCapability: null,
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      "Resolve which destination category OpenLinker would place a listing in, using its deterministic chain: barcode catalogue lookup, then the operator's configured category mappings. Returns the resolved category id and which method produced it. NOTE this performs a LIVE lookup against the destination platform when a barcode is supplied, so call it per item, not in a loop over a catalogue. A result with method 'manual' and a null category id means nothing is mapped for that input — the fix is to author a mapping with upsert_category_mapping, not to retry.",
    inputSchema: z.object({
      destinationConnectionId: z
        .string()
        .describe('Destination connection id, from list_connections.'),
      barcode: z
        .string()
        .optional()
        .describe(
          'EAN/GTIN. When supplied, triggers a live destination catalogue lookup. Omit to resolve from configured mappings only.'
        ),
      sourceCategoryIds: z
        .array(z.string())
        .optional()
        .describe('Source platform category ids, ordered deepest-first.'),
      sourceConnectionId: z
        .string()
        .optional()
        .describe('Source (master) connection id, to scope the mapping lookup.'),
    }),
    handler: async (args): Promise<CallToolResult> => {
      const result = await categoryResolutionService.resolveCategory({
        connectionId: args.destinationConnectionId as string,
        barcode: (args.barcode as string | undefined) ?? null,
        sourceCategoryIds: args.sourceCategoryIds as string[] | undefined,
        sourceConnectionId: args.sourceConnectionId as string | undefined,
      });
      return jsonResult(projectResolution(result));
    },
  };
}

function projectResolution(result: CategoryResolutionResult): Record<string, unknown> {
  return {
    destinationCategoryId: result.destinationCategoryId,
    provenance: result.provenance,
    method: result.method,
  };
}
