/**
 * `get_product` MCP Tool
 *
 * Reads one product plus its variants from OpenLinker's own catalog.
 *
 * Takes no `connectionId`: `IProductsService.getProduct` is a direct
 * internal-id read with no connection axis (plan §3.3.2). Accepting an
 * argument that silently did nothing would be worse than omitting it — an
 * agent would infer it had scoped the read.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';

import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult, toolFailure } from './tool-result';

const inputSchema = z.object({
  productId: z.string().describe('Internal OpenLinker product id, e.g. ol_product_… .'),
});

export function createGetProductTool(productsService: IProductsService): McpToolDefinition {
  return {
    name: 'get_product',
    requiredCapability: 'ProductMaster',
    description:
      "Read one product from OpenLinker's catalog by its internal id, including its variants (id, sku, barcode, price). Use search_catalog to find a product id first.",
    inputSchema,
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      // NARROWING, not validation: the SDK already validated `args` against
      // this schema before invoking the handler, so this call cannot
      // realistically fail. It exists to turn `Record<string, unknown>` into
      // typed fields — never rely on it as the enforcement point for a
      // constraint (a caller-visible cap belongs on the schema itself).
      const { productId } = inputSchema.parse(args);

      const product = await productsService.getProduct(productId);
      if (product === null) {
        return toolFailure(
          `No product found with id "${productId}". Use search_catalog to find valid product ids.`
        );
      }

      const variants = await productsService.getVariantsByProductId(productId);

      return jsonResult({ ...projectProduct(product), variants: variants.map(projectVariant) });
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
    description: product.description,
  };
}

function projectVariant(variant: ProductVariant): Record<string, unknown> {
  return {
    id: variant.id,
    sku: variant.sku,
    // Barcodes live on the variant, not the product — variants are the
    // canonical offer-link target (architecture-overview.md § Products).
    ean: variant.ean,
    gtin: variant.gtin,
    price: variant.price ?? null,
    attributes: variant.attributes,
  };
}
