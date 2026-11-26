/**
 * Mirakl Product Master Adapter
 *
 * `ProductMasterPort` over the seller's Mirakl offers (#4284): each offer is a
 * product with one variant, keyed by `shop_sku`, read from OF21. Read-only:
 * every write throws `MiraklNotSupportedException`, because the catalogue card
 * belongs to the operator and an offer is changed through its own imports, not
 * through the master port.
 *
 * Deletion: an offer OF21 no longer returns for its `shop_sku` is a product
 * deleted at the master (`MasterProductNotFoundError`, #1599), so its listings
 * elsewhere are paused. A missing identifier mapping is not: that stays a
 * retryable plugin error.
 *
 * Images come from the catalogue card through P11 (OF21 carries none), one
 * call per batch of offers; a card without a picture gives none. The tax rate
 * is not on the offer and stays unreported; see `mirakl-master-product.mapper.ts`.
 *
 * Filters: OF21 offers neither text search nor a category filter, so `query`,
 * `categoryIds` and `status` are refused rather than answered from one window,
 * which would read as "nothing else matches".
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 * @implements {ProductMasterPort}
 */
import {
  MasterProductNotFoundError,
  type Category,
  type Product,
  type ProductCreate,
  type ProductFilters,
  type ProductMasterPort,
  type ProductUpdate,
  type ProductVariant,
  type ProductVariantCreate,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import { MiraklNotSupportedException } from '../../../domain/exceptions/mirakl-not-supported.exception';
import type { MiraklOffer } from '../../../domain/types/mirakl-offer.types';
import { MIRAKL_MAX_PAGE_SIZE } from '../../http/mirakl-pagination';
import {
  mapMiraklOfferCategory,
  mapMiraklOfferToProduct,
  mapMiraklOfferToVariant,
} from './mirakl-master-product.mapper';
import type { MiraklMasterIdentity } from './mirakl-master-identity';
import type { MiraklOfferReader } from './mirakl-offer-reader';
import type { MiraklProductMediaReader } from './mirakl-product-media-reader';

/** Window used when a caller asks for products without a limit. */
const DEFAULT_WINDOW = 50;

export class MiraklProductMasterAdapter implements ProductMasterPort {
  private readonly logger = new Logger(MiraklProductMasterAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly brand: string,
    private readonly reader: MiraklOfferReader,
    private readonly identity: MiraklMasterIdentity,
    private readonly media: MiraklProductMediaReader
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Product> {
    const offer = await this.readOffer(productId);
    const images = await this.imagesOf([offer]);
    return mapMiraklOfferToProduct(offer, productId, imagesFor(images, offer));
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    this.refuseUnsupportedFilters(filters);
    if (filters?.externalIds !== undefined) {
      const offers: MiraklOffer[] = [];
      for (const sku of new Set(filters.externalIds.map(String))) {
        const offer = await this.reader.readBySku(sku);
        if (offer) {
          offers.push(offer);
        }
      }
      return this.toProducts(offers);
    }
    const offers = await this.readWindow(filters?.offset ?? 0, filters?.limit ?? DEFAULT_WINDOW);
    return this.toProducts(offers);
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    const sku = await this.identity.skuOf(productId);
    const offer = await this.reader.readBySku(sku);
    if (!offer) {
      throw new MasterProductNotFoundError(productId, this.connectionId);
    }
    const variantId = await this.identity.variantId(sku, productId);
    return [mapMiraklOfferToVariant(offer, productId, variantId)];
  }

  async getProductCategories(productId: string): Promise<Category[]> {
    const category = mapMiraklOfferCategory(await this.readOffer(productId));
    return category ? [category] : [];
  }

  searchProducts(query: string, filters?: ProductFilters): Promise<Product[]> {
    return this.getProducts({ ...filters, query });
  }

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    const offset = Math.max(0, filters?.offset ?? 0);
    const offers = await this.readWindow(offset, filters?.limit ?? Number.POSITIVE_INFINITY);
    return offers.flatMap((offer) => (offer.shop_sku ? [offer.shop_sku] : []));
  }

  // ─── Writes (refused) ──────────────────────────────────────────────────────

  createProduct(_product: ProductCreate): Promise<Product> {
    return this.refuse('creating a product');
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    return this.refuse('editing a product');
  }

  deleteProduct(_productId: string): Promise<void> {
    return this.refuse('deleting a product');
  }

  upsertProductVariant(
    _productId: string,
    _variant: ProductVariantCreate
  ): Promise<ProductVariant> {
    return this.refuse('editing a variant');
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return this.refuse('changing a product category');
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async readOffer(productId: string): Promise<MiraklOffer> {
    const sku = await this.identity.skuOf(productId);
    const offer = await this.reader.readBySku(sku);
    if (!offer) {
      throw new MasterProductNotFoundError(productId, this.connectionId);
    }
    return offer;
  }

  /** Offers `[offset, offset + limit)` in OF21 order, walked page by page. */
  private async readWindow(offset: number, limit: number): Promise<MiraklOffer[]> {
    const offers: MiraklOffer[] = [];
    let position = offset;
    while (offers.length < limit) {
      const page = await this.reader.readPage(
        position,
        Math.min(MIRAKL_MAX_PAGE_SIZE, limit - offers.length)
      );
      offers.push(...page.offers);
      position += page.read;
      if (!page.hasMore || page.read === 0) {
        break;
      }
    }
    return offers;
  }

  private async toProducts(offers: readonly MiraklOffer[]): Promise<Product[]> {
    const withSku = offers.filter((offer): offer is MiraklOffer & { shop_sku: string } =>
      Boolean(offer.shop_sku)
    );
    if (withSku.length < offers.length) {
      this.logger.warn(
        `Skipping ${offers.length - withSku.length} offer(s) without a shop_sku ` +
          `(connection: ${this.connectionId})`
      );
    }
    const ids = await this.identity.productIds(withSku.map((offer) => offer.shop_sku));
    const images = await this.imagesOf(withSku);
    const products: Product[] = [];
    for (const offer of withSku) {
      const internalId = ids.get(this.identity.key(offer.shop_sku));
      if (internalId === undefined) {
        this.logger.warn(
          `No internal id for offer ${offer.shop_sku} (connection: ${this.connectionId})`
        );
        continue;
      }
      products.push(mapMiraklOfferToProduct(offer, internalId, imagesFor(images, offer)));
    }
    return products;
  }

  /** The card pictures of these offers, keyed by `product_sku`. */
  private imagesOf(offers: readonly MiraklOffer[]): Promise<Map<string, readonly string[]>> {
    return this.media.imagesFor(
      offers.flatMap((offer) => (offer.product_sku ? [offer.product_sku] : []))
    );
  }

  private refuseUnsupportedFilters(filters: ProductFilters | undefined): void {
    if (filters?.query !== undefined && filters.query.trim() !== '') {
      throw new MiraklNotSupportedException('searching products by text', this.brand);
    }
    if (filters?.categoryIds !== undefined && filters.categoryIds.length > 0) {
      throw new MiraklNotSupportedException('filtering products by category', this.brand);
    }
    if (filters?.status !== undefined) {
      throw new MiraklNotSupportedException('filtering products by status', this.brand);
    }
  }

  private refuse(operation: string): Promise<never> {
    return Promise.reject(new MiraklNotSupportedException(operation, this.brand));
  }
}

function imagesFor(
  images: ReadonlyMap<string, readonly string[]>,
  offer: MiraklOffer
): readonly string[] {
  return offer.product_sku ? images.get(offer.product_sku) ?? [] : [];
}
