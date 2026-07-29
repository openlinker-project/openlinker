/**
 * `search_catalog` MCP Tool
 *
 * Searches OpenLinker's OWN product catalog — not a live platform call.
 * See the plan §3.3: reading OL's store keeps results internal-id-keyed
 * (so they join with the other tools), costs no marketplace API quota, and
 * inherits whatever the operator has already synced.
 *
 * `connectionId` filters by PROVENANCE (`ProductListFilters.sourceConnectionId`
 * matches products having a Product identifier mapping for that connection) —
 * it is NOT "products currently listed there". The description says so,
 * because an agent would otherwise reasonably assume the latter.
 *
 * Results are capped and projected: a tool result is fed to an LLM, so an
 * unbounded array of full `Product` entities would blow the context window
 * for no benefit.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { IProductsService, Product } from '@openlinker/core/products';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult } from './tool-result';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const inputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Case-insensitive substring match on product name or SKU. Omit to list all.'),
  connectionId: z
    .string()
    .optional()
    .describe('Restrict to products that originated from this connection.'),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Default ${DEFAULT_LIMIT}.`),
  offset: z.number().int().min(0).optional().describe('Default 0.'),
});

export function createSearchCatalogTool(productsService: IProductsService): McpToolDefinition {
  return {
    name: 'search_catalog',
    requiredCapability: 'ProductMaster',
    description:
      "Search OpenLinker's product catalog by name or SKU. Returns internal product ids usable with get_product and get_availability. `connectionId` filters by which connection a product ORIGINATED from (its identifier mapping), not by where it is currently listed. An empty result means no product matched — the catalog is populated by sync, so a recently added connection may not have products yet.",
    inputSchema,
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const { query, connectionId, limit, offset } = inputSchema.parse(args);

      const page = await productsService.listProducts(
        {
          ...(query !== undefined ? { search: query } : {}),
          ...(connectionId !== undefined ? { sourceConnectionId: connectionId } : {}),
        },
        { limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 }
      );

      return jsonResult({
        total: page.total,
        returned: page.items.length,
        products: page.items.map(projectProduct),
      });
    },
  };
}

function projectProduct(product: Product): Record<string, unknown> {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: product.price,
    currency: product.currency,
  };
}
