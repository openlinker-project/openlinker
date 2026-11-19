/**
 * Amazon Product Master Adapter (#4182)
 *
 * `ProductMasterPort` over the seller's own Amazon listings, so a seller whose
 * products live on Amazon can publish them elsewhere. Read side only: every
 * write throws `AmazonNotSupportedException` (a silent no-op would read as
 * "done").
 *
 * A PRODUCT is a listing that is not a variation child: a standalone SKU, or
 * a variation parent. Its VARIANTS are the parent's child SKUs, or the SKU
 * itself for a standalone listing. Product and variant external ids are SKUs.
 *
 * Content order (decision on #4182): the seller's listing attributes first;
 * the ASIN's catalogue entry only fills a missing title, images or EAN,
 * because other sellers and Amazon edit the shared detail page too. Only
 * content the seller owns may be reused elsewhere; the connection page says so.
 *
 * Also implements three guard-only rungs (ADR-048 / ADR-063), never advertised:
 *   - `BulkProductReader`: prefetch 20 SKUs a call with
 *     `searchListingsItems(identifiersType=SKU)`.
 *   - `ModifiedProductLister`: `searchListingsItems(lastUpdatedAfter=...)`,
 *     a changed child reported as its parent. Hypothesis to confirm on a live
 *     account; the full pass stays the backstop.
 *   - `ProductTaxRateReader`: Amazon carries a `product_tax_code`, not a rate,
 *     so the rate is resolved only through the connection's `taxCodeRates`
 *     map and reported "not configured" otherwise, never defaulted.
 *
 * A listing Amazon no longer has raises `MasterProductNotFoundError`, the
 * deletion path (#1599 / #1689).
 *
 * Everything is read on ONE marketplace, `catalogueMarketplaceId` (else the
 * first configured): the content, the gross price and currency (ADR-077) and
 * the country of the tax rate. It is a setting on the connection page, so
 * reordering the marketplaces never moves the catalogue's currency.
 *
 * Enumeration: `listExternalIds` serves an `{offset, limit}` window over a
 * token-paged read. Positions count the product ids kept (children are
 * skipped), and a checkpoint in the host cache lets the next window of a
 * sweep resume where the last one stopped.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/product-master
 * @implements {ProductMasterPort}
 */
import {
  CORE_ENTITY_TYPE,
  type Connection,
  type IdentifierMappingPort,
} from '@openlinker/core/identifier-mapping';
import {
  MasterProductNotFoundError,
  type BulkProductReader,
  type Category,
  type ListExternalIdsModifiedSinceInput,
  type ModifiedProductLister,
  type Product,
  type ProductCreate,
  type ProductFilters,
  type ProductMasterPort,
  type ProductTaxRateReader,
  type ProductUpdate,
  type ProductVariant,
  type ProductVariantCreate,
  type ReadProductTaxRateInput,
  type TaxRateResolution,
} from '@openlinker/core/products';
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';

import { AMAZON_KNOWN_MARKETPLACES } from '../../../amazon.constants';
import { AmazonConfigException } from '../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../domain/exceptions/amazon-not-supported.exception';
import { resolveCatalogueMarketplaceId } from '../../../domain/policies/amazon-config.policy';
import type { AmazonCatalogEntry } from '../../../domain/types/amazon-catalog.types';
import type { AmazonConnectionConfig } from '../../../domain/types/amazon-config.types';
import type { AmazonListingItem } from '../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import {
  attributeText,
  listingEan,
  listingImages,
  mapAmazonProduct,
  mapAmazonVariant,
  variationLinks,
  type AmazonProductContext,
} from '../../mappers/amazon-product.mapper';
import { AmazonListingReader, type AmazonListingPageQuery } from '../../readers/amazon-listing.reader';
import { AmazonCatalogReader } from '../offer-manager/amazon-catalog-reader';

const DEFAULT_WINDOW = 50;
/** A window larger than this many pages is refused rather than read. */
const MAX_PAGES_PER_WINDOW = 200;
const CHECKPOINT_TTL_SECONDS = 6 * 3_600;
/** Pull a modified-since window back to cover clock skew between Amazon and OpenLinker. */
const MODIFIED_SINCE_PULL_BACK_MS = 60_000;

interface Checkpoint {
  readonly page: number;
  readonly kept: number;
}

export class AmazonProductMasterAdapter
  implements ProductMasterPort, BulkProductReader, ModifiedProductLister, ProductTaxRateReader
{
  private readonly logger = new Logger(AmazonProductMasterAdapter.name);
  private readonly listings: AmazonListingReader;
  private readonly catalog: AmazonCatalogReader;
  private readonly marketplaceId: string;

  constructor(
    private readonly connection: Connection,
    client: AmazonSpApiClient,
    private readonly config: AmazonConnectionConfig,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly cache?: CachePort,
  ) {
    if (config.sellerId === undefined) {
      throw new AmazonConfigException(connection.id, 'sellerId (merchant token) is required to read the catalogue');
    }
    this.marketplaceId = resolveCatalogueMarketplaceId(config);
    this.listings = new AmazonListingReader(client, config.sellerId, this.marketplaceId, connection.id, cache);
    this.catalog = new AmazonCatalogReader(client, this.marketplaceId);
  }

  // ── Enumeration ─────────────────────────────────────────────

  listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    return this.window({}, filters?.offset ?? 0, filters?.limit ?? DEFAULT_WINDOW);
  }

  listExternalIdsModifiedSince(input: ListExternalIdsModifiedSinceInput): Promise<string[]> {
    const since = new Date(input.since.getTime() - MODIFIED_SINCE_PULL_BACK_MS)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    return this.window({ lastUpdatedAfter: since }, input.offset, input.limit);
  }

  private async window(query: AmazonListingPageQuery, offset: number, limit: number): Promise<string[]> {
    const key = `amazon:catalogue-checkpoint:${this.connection.id}:${query.lastUpdatedAfter ?? 'all'}`;
    const checkpoint = await this.readCheckpoint(key);
    let page = checkpoint !== null && checkpoint.kept <= offset ? checkpoint.page : 0;
    let kept = checkpoint !== null && checkpoint.kept <= offset ? checkpoint.kept : 0;
    const ids: string[] = [];
    const seen = new Set<string>();

    for (let read = 0; read < MAX_PAGES_PER_WINDOW && ids.length < limit; read += 1) {
      const items = await this.listings.page(page, query);
      if (items === null) {
        return ids;
      }
      for (const productSku of this.productSkusOf(items, query.lastUpdatedAfter !== undefined)) {
        if (seen.has(productSku)) continue;
        seen.add(productSku);
        if (kept >= offset && ids.length < limit) {
          ids.push(productSku);
        }
        kept += 1;
      }
      page += 1;
      // "Page `page` starts at position `kept`": the next window of a sweep
      // (offset >= kept) resumes here instead of reading from the start.
      await this.cache?.set(key, { page, kept }, CHECKPOINT_TTL_SECONDS).catch(() => undefined);
    }
    if (ids.length < limit) {
      this.logger.warn(
        `Amazon catalogue window stopped after ${MAX_PAGES_PER_WINDOW} pages (connection: ${this.connection.id})`,
      );
    }
    return ids;
  }

  /** Product SKUs on a page: non-children; a changed child counts as its parent when `childAsParent`. */
  private productSkusOf(items: readonly AmazonListingItem[], childAsParent: boolean): string[] {
    const skus: string[] = [];
    for (const item of items) {
      const { parentSku } = variationLinks(item, this.marketplaceId);
      if (parentSku === null) {
        skus.push(item.sku);
      } else if (childAsParent) {
        skus.push(parentSku);
      }
    }
    return skus;
  }

  private async readCheckpoint(key: string): Promise<Checkpoint | null> {
    if (this.cache === undefined) return null;
    const value = await this.cache.get<Checkpoint>(key).catch(() => null);
    return value !== null && typeof value?.page === 'number' && typeof value.kept === 'number' ? value : null;
  }

  // ── Bulk prefetch ───────────────────────────────────────────

  async prefetchProducts(externalIds: readonly string[]): Promise<void> {
    try {
      await this.listings.prefetch(externalIds);
      const childSkus = externalIds.flatMap((sku) => {
        const item = this.listings.peek(sku);
        return item ? [...variationLinks(item, this.marketplaceId).childSkus] : [];
      });
      if (childSkus.length > 0) {
        await this.listings.prefetch(childSkus);
      }
    } catch (error) {
      this.logger.warn(
        `Amazon catalogue prefetch failed for ${externalIds.length} product(s) (connection: ${this.connection.id}); ` +
          `falling back to per-product reads: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Reads ───────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Product> {
    const sku = await this.externalId(CORE_ENTITY_TYPE.Product, productId);
    const item = await this.requireListing(sku, productId);
    return { ...mapAmazonProduct(item, await this.context(item)), id: productId };
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    if (filters?.categoryIds !== undefined && filters.categoryIds.length > 0) {
      throw new AmazonNotSupportedException('getProducts filter "categoryIds"');
    }
    if (filters?.query !== undefined && filters.query.trim().length > 0) {
      throw new AmazonNotSupportedException('searching the Amazon catalogue by text');
    }
    const skus = filters?.externalIds ?? (await this.listExternalIds({ offset: filters?.offset, limit: filters?.limit }));
    await this.listings.prefetch(skus);
    const products: Product[] = [];
    for (const sku of skus) {
      const item = await this.listings.read(sku);
      if (item === null) continue;
      const productId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.Product,
        sku,
        this.connection.id,
      );
      products.push({ ...mapAmazonProduct(item, await this.context(item)), id: productId });
    }
    return products;
  }

  searchProducts(query: string, filters?: ProductFilters): Promise<Product[]> {
    return this.getProducts({ ...filters, query });
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    const sku = await this.externalId(CORE_ENTITY_TYPE.Product, productId);
    const parent = await this.requireListing(sku, productId);
    const links = variationLinks(parent, this.marketplaceId);

    const items: AmazonListingItem[] = [];
    if (links.childSkus.length === 0) {
      items.push(parent);
    } else {
      await this.listings.prefetch(links.childSkus);
      for (const childSku of links.childSkus) {
        const child = await this.listings.read(childSku);
        if (child !== null) items.push(child);
      }
    }
    if (items.length === 0) {
      return [];
    }

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
      items.map((item) => ({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: item.sku,
        connectionId: this.connection.id,
        context: {
          parentEntityType: CORE_ENTITY_TYPE.Product,
          parentInternalId: productId,
          metadata: { variantExternalId: item.sku },
        },
      })),
    );

    const variants: ProductVariant[] = [];
    for (const item of items) {
      const internalId = idMap.get(`${item.sku}:${this.connection.id}`);
      if (internalId === undefined) {
        this.logger.warn(`No internal id for Amazon SKU ${item.sku} (connection: ${this.connection.id})`);
        continue;
      }
      const ctx = await this.context(item);
      variants.push({ ...mapAmazonVariant(item, productId, links.themeAttributes, ctx), id: internalId });
    }
    return variants;
  }

  /** The listing's product type, the one category Amazon places it in. */
  async getProductCategories(productId: string): Promise<Category[]> {
    const sku = await this.externalId(CORE_ENTITY_TYPE.Product, productId);
    const item = await this.requireListing(sku, productId);
    const productType = item.summaries?.[0]?.productType;
    return productType ? [{ id: productType, name: productType, depth: 0 }] : [];
  }

  async readProductTaxRate(input: ReadProductTaxRateInput): Promise<TaxRateResolution> {
    const productSku = await this.externalId(CORE_ENTITY_TYPE.Product, input.productId);
    const sku =
      input.variantId !== undefined
        ? await this.externalId(CORE_ENTITY_TYPE.ProductVariant, input.variantId)
        : productSku;
    const item = await this.listings.read(sku);
    if (item === null) {
      return { kind: 'unknown', reason: 'unreadable', detail: `Amazon has no listing ${sku}` };
    }
    const code = attributeText(item, 'product_tax_code', this.marketplaceId);
    if (code === null) {
      return { kind: 'unknown', reason: 'not-configured', detail: 'the listing carries no product tax code' };
    }
    const rate = this.config.taxCodeRates?.[code.toUpperCase()];
    if (rate === undefined) {
      return {
        kind: 'unknown',
        reason: 'not-configured',
        detail: `Amazon tax code ${code} is not mapped to a rate on this connection`,
      };
    }
    return { kind: 'resolved', code: rate, countryIso2: AMAZON_KNOWN_MARKETPLACES[this.marketplaceId]?.country ?? null };
  }

  readsTaxRatePerVariant(): boolean {
    return true;
  }

  // ── Writes (not supported) ──────────────────────────────────

  createProduct(_product: ProductCreate): Promise<Product> {
    return Promise.reject(new AmazonNotSupportedException('createProduct on the Amazon catalogue'));
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    return Promise.reject(new AmazonNotSupportedException('updateProduct on the Amazon catalogue'));
  }

  deleteProduct(_productId: string): Promise<void> {
    return Promise.reject(new AmazonNotSupportedException('deleteProduct on the Amazon catalogue'));
  }

  upsertProductVariant(_productId: string, _variant: ProductVariantCreate): Promise<ProductVariant> {
    return Promise.reject(new AmazonNotSupportedException('upsertProductVariant on the Amazon catalogue'));
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return Promise.reject(new AmazonNotSupportedException('assignCategories on the Amazon catalogue'));
  }

  // ── Helpers ─────────────────────────────────────────────────

  private async externalId(entityType: string, internalId: string): Promise<string> {
    const mappings = await this.identifierMapping.getExternalIds(entityType, internalId);
    const externalId = mappings.find((mapping) => mapping.connectionId === this.connection.id)?.externalId;
    if (externalId === undefined) {
      throw new MasterProductNotFoundError(internalId, this.connection.id);
    }
    return externalId;
  }

  private async requireListing(sku: string, productId: string): Promise<AmazonListingItem> {
    const item = await this.listings.read(sku);
    if (item === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    return item;
  }

  /** The mapping context, reading the ASIN's catalogue entry only when the listing lacks title, images or EAN. */
  private async context(item: AmazonListingItem): Promise<AmazonProductContext> {
    const base = {
      marketplaceId: this.marketplaceId,
      currency: AMAZON_KNOWN_MARKETPLACES[this.marketplaceId]?.currency ?? 'EUR',
    };
    const asin = item.summaries?.[0]?.asin;
    const needsCatalog =
      attributeText(item, 'item_name', this.marketplaceId) === null ||
      listingImages(item, this.marketplaceId).length === 0 ||
      listingEan(item, this.marketplaceId) === null;
    if (asin === undefined || !needsCatalog) {
      return base;
    }
    let catalog: AmazonCatalogEntry | null = null;
    try {
      catalog = await this.catalog.getByAsin(asin);
    } catch (error) {
      this.logger.warn(
        `Amazon catalogue entry ${asin} unreadable; mapping the listing alone: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { ...base, catalog };
  }
}
