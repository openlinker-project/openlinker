/**
 * `get_availability` MCP Tool
 *
 * Reads stock from OpenLinker's own inventory projection.
 *
 * TWO SHAPES, matching what the caller holds:
 *   - `productIds` → `getProductStockAggregates` (available/reserved summed
 *     across the product's rows, plus last stock write).
 *   - `variantIds` → `getAvailabilityByVariantIds` (the variant-keyed read the
 *     rest of OL uses per ADR-010 / #822 / #823).
 *
 * Takes NO `connectionId` (plan §3.3.2): both reads are global — inventory is
 * keyed by product/variant, not by connection — and accepting an argument that
 * did nothing would mislead the calling agent into thinking it had scoped the
 * result.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type {
  IInventoryQueryService,
  ProductStockAggregate,
  VariantAvailability,
} from '@openlinker/core/inventory';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult, toolFailure } from './tool-result';

const MAX_IDS = 100;

const inputSchema = z
  .object({
    productIds: z
      .array(z.string())
      .max(MAX_IDS)
      .optional()
      .describe('Internal product ids. Returns product-level totals.'),
    variantIds: z
      .array(z.string())
      .max(MAX_IDS)
      .optional()
      .describe('Internal variant ids. Returns per-variant availability.'),
  })
  .describe('Supply exactly one of productIds or variantIds.');

export function createGetAvailabilityTool(
  inventoryQueryService: IInventoryQueryService
): McpToolDefinition {
  return {
    name: 'get_availability',
    requiredCapability: 'InventoryMaster',
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      "Read stock levels from OpenLinker's inventory for a set of products (totals) or variants (per-variant). Supply exactly one of productIds or variantIds — ids come from search_catalog / get_product. Stock reflects the last completed inventory sync, not a live marketplace read.",
    inputSchema,
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      // NARROWING, not validation: the SDK already validated `args` against
      // this schema before invoking the handler, so this call cannot
      // realistically fail. It exists to turn `Record<string, unknown>` into
      // typed fields — never rely on it as the enforcement point for a
      // constraint (a caller-visible cap belongs on the schema itself).
      const { productIds, variantIds } = inputSchema.parse(args);

      const products = productIds !== undefined && productIds.length > 0 ? productIds : null;
      const variants = variantIds !== undefined && variantIds.length > 0 ? variantIds : null;

      // Tell the agent WHICH mistake it made — it has to decide what to send
      // next, and "supply exactly one" doesn't say which way it got that wrong.
      if (products !== null && variants !== null) {
        return toolFailure(
          'Supply productIds OR variantIds, not both: they return different shapes (product-level totals vs per-variant availability). Pick the one matching the ids you hold.'
        );
      }
      if (products === null && variants === null) {
        return toolFailure(
          'Supply a non-empty productIds (for product-level totals) or variantIds (for per-variant availability). Ids come from search_catalog / get_product.'
        );
      }

      if (products !== null) {
        const aggregates = await inventoryQueryService.getProductStockAggregates(products);
        return jsonResult({ products: aggregates.map(projectAggregate) });
      }

      const availability = await inventoryQueryService.getAvailabilityByVariantIds(variants ?? []);
      return jsonResult({ variants: availability.map(projectVariantAvailability) });
    },
  };
}

function projectAggregate(aggregate: ProductStockAggregate): Record<string, unknown> {
  return {
    productId: aggregate.productId,
    totalAvailable: aggregate.totalAvailable,
    totalReserved: aggregate.totalReserved,
    stockUpdatedAt: aggregate.stockUpdatedAt?.toISOString() ?? null,
  };
}

function projectVariantAvailability(availability: VariantAvailability): Record<string, unknown> {
  return {
    variantId: availability.productVariantId,
    totalAvailable: availability.totalAvailable,
    locationCount: availability.locationCount,
    // #2323 - net of OpenLinker's own published reservations; `null` means OL
    // could not determine it, which an agent must not read as zero.
    availableToPromise: availability.availableToPromise,
  };
}
