/**
 * Test world
 *
 * A snapshot of the running stack's topology, resolved dynamically from the API
 * so specs never hardcode connection ids, product ids, or tunnel URLs. Connections
 * are indexed by `platformType`; product/variant lookups are lazy helpers over
 * the live catalogue.
 *
 * @module world
 */
import type { ApiClient } from '../api/api-client';
import type { Connection, Product, ProductVariant } from '../api/api.types';

/** Platform types the operator flows care about. */
export const PlatformType = {
  prestashop: 'prestashop',
  woocommerce: 'woocommerce',
  allegro: 'allegro',
  erli: 'erli',
  inpost: 'inpost',
  ksef: 'ksef',
  infakt: 'infakt',
} as const;

export type KnownPlatformType = (typeof PlatformType)[keyof typeof PlatformType];

export interface World {
  /** Every connection on the stack, in list order. */
  readonly connections: readonly Connection[];
  /** First active connection for a platform type, or undefined. */
  connectionFor(platformType: string): Connection | undefined;
  /** First active connection for a platform type, throwing if absent. */
  requireConnection(platformType: string): Connection;
  /** All connections for a platform type. */
  connectionsFor(platformType: string): Connection[];
  /**
   * Connections that declare a capability in `enabledCapabilities` OR
   * `supportedCapabilities`. The FE gates surfaces on either field (products
   * page → supported, shop-publish launcher → enabled), so the union mirrors
   * what the UI actually offers.
   */
  connectionsWithCapability(capability: string): Connection[];
  /**
   * First active connection carrying `capability` (optionally narrowed to
   * `platformType`), or undefined. Unlike `connectionFor` (platformType-only),
   * this resolves a connection BY WHAT IT DOES rather than by assuming a
   * particular platform plays a role (#1571) — e.g. picking "the" master
   * catalogue connection without hardcoding PrestaShop. When two connections
   * of the same platformType exist with different capability sets (e.g. one
   * WooCommerce connection kept as a publish target, another configured as
   * ProductMaster), this still resolves the right one; `connectionFor` cannot
   * disambiguate them.
   */
  connectionWithCapability(capability: string, platformType?: string): Connection | undefined;
  /** Same as `connectionWithCapability`, throwing a descriptive error if absent. */
  requireConnectionWithCapability(capability: string, platformType?: string): Connection;
  /** Fetch a page of master products (first `limit`). */
  listProducts(limit?: number): Promise<Product[]>;
  /**
   * Find the first product with at least `minVariants` variants. With
   * `requireEans` every variant must carry an EAN/GTIN (the golden path's
   * offer mapping and order resolution key on barcodes).
   */
  findMultiVariantProduct(
    minVariants?: number,
    opts?: { requireEans?: boolean },
  ): Promise<Product | undefined>;
  /** Resolve a product's variants. */
  variantsOf(productId: string): Promise<ProductVariant[]>;
}

function isActive(connection: Connection): boolean {
  return connection.status === 'active';
}

/**
 * Resolve the world from the API. Requires the client to be authenticated.
 */
export async function buildWorld(api: ApiClient): Promise<World> {
  const connections = await api.connections.list();

  const connectionsFor = (platformType: string): Connection[] =>
    connections.filter((c) => c.platformType === platformType);

  const connectionFor = (platformType: string): Connection | undefined =>
    connectionsFor(platformType).find(isActive) ?? connectionsFor(platformType)[0];

  const requireConnection = (platformType: string): Connection => {
    const connection = connectionFor(platformType);
    if (!connection) {
      const available = [...new Set(connections.map((c) => c.platformType))].join(', ');
      throw new Error(
        `No connection found for platformType "${platformType}". Available: ${available || '(none)'}`,
      );
    }
    return connection;
  };

  const listProducts = async (limit = 50): Promise<Product[]> => {
    const page = await api.products.list({ limit });
    return page.items;
  };

  const variantsOf = async (productId: string): Promise<ProductVariant[]> => {
    const product = await api.products.getById(productId);
    if (product.variants && product.variants.length > 0) {
      return product.variants;
    }
    const page = await api.products.listVariants(productId);
    return page.items;
  };

  const findMultiVariantProduct = async (
    minVariants = 2,
    opts: { requireEans?: boolean } = {},
  ): Promise<Product | undefined> => {
    const products = await listProducts(50);
    for (const summary of products) {
      const variants = await variantsOf(summary.id);
      if (variants.length < minVariants) continue;
      // The golden path maps offers and resolves orders BY EAN — a
      // multi-variant product whose variants lack barcodes (e.g. the demo
      // "Resin Ring") would pass S0 and then strand every later segment.
      if (opts.requireEans && !variants.every((v) => !!(v.ean ?? v.gtin))) continue;
      return { ...summary, variants };
    }
    return undefined;
  };

  const connectionsWithCapability = (capability: string): Connection[] =>
    connections.filter(
      (c) =>
        c.enabledCapabilities.includes(capability) || c.supportedCapabilities.includes(capability),
    );

  const connectionWithCapability = (
    capability: string,
    platformType?: string,
  ): Connection | undefined => {
    const candidates = connectionsWithCapability(capability).filter(
      (c) => !platformType || c.platformType === platformType,
    );
    return candidates.find(isActive) ?? candidates[0];
  };

  const requireConnectionWithCapability = (capability: string, platformType?: string): Connection => {
    const connection = connectionWithCapability(capability, platformType);
    if (!connection) {
      const scope = platformType ? ` on platformType "${platformType}"` : '';
      throw new Error(`No connection found with capability "${capability}"${scope}.`);
    }
    return connection;
  };

  return {
    connections,
    connectionFor,
    requireConnection,
    connectionsFor,
    connectionsWithCapability,
    connectionWithCapability,
    requireConnectionWithCapability,
    listProducts,
    findMultiVariantProduct,
    variantsOf,
  };
}
