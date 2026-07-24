/**
 * WooCommerce Product Publisher Adapter (#1043)
 *
 * Implements `ShopProductManagerPort` (capability `'ProductPublisher'`) plus the
 * `CategoryProvisioner` sub-capability against the WooCommerce REST API v3.
 * Pure transport: the core `ProductPublishExecutionService` (#1042) owns the
 * `ShopProduct` identifier mapping + record lifecycle — this adapter only shapes
 * the neutral `PublishProductCommand` onto WooCommerce's `products` /
 * `products/categories` resources and maps failures back to the neutral
 * `ProductPublishRejectedException`.
 *
 * Publish model (ADR-024 §1/§3): each OL variant publishes as its own *simple*
 * product (create on first publish, upsert via `externalProductId` thereafter);
 * neutral `parameters` become per-product custom attributes. Variable-product /
 * variations grouping is a deferred enhancement.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher
 */
import { Logger } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ProductPublishRejectedException,
  type CategoryProvisioner,
  type ProvisionCategoryCommand,
  type ProvisionCategoryResult,
  type PublishProductCommand,
  type PublishProductContent,
  type PublishProductResult,
  type PublishProductStatus,
  type ShopProductManagerPort,
} from '@openlinker/core/listings';

import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import type {
  WooCommerceCategoryResponse,
  WooCommerceProductPublishRequest,
  WooCommerceProductResponse,
  WooCommerceProductStatus,
} from './woocommerce-product-publish.types';

const PRODUCTS_PATH = '/wp-json/wc/v3/products';
const CATEGORIES_PATH = '/wp-json/wc/v3/products/categories';
const DEFAULT_ADAPTER_KEY = 'woocommerce.restapi.v3';

// Core WooCommerce has no native SEO title/description field — those live in
// post meta owned by whichever SEO plugin the store runs. We write the meta keys
// for both dominant plugins (Yoast, RankMath); the inactive plugin's rows are
// inert post meta, so emitting both is safe and covers the common installs.
const SEO_TITLE_META_KEYS = ['_yoast_wpseo_title', 'rank_math_title'] as const;
const SEO_DESCRIPTION_META_KEYS = ['_yoast_wpseo_metadesc', 'rank_math_description'] as const;

export class WooCommerceProductPublisherAdapter
  implements ShopProductManagerPort, CategoryProvisioner
{
  private readonly logger = new Logger(WooCommerceProductPublisherAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly connection: Connection,
  ) {}

  async publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
    const body = this.buildProductBody(cmd);
    const isUpsert = cmd.externalProductId != null && cmd.externalProductId !== '';
    const path = isUpsert
      ? `${PRODUCTS_PATH}/${encodeURIComponent(String(cmd.externalProductId))}`
      : PRODUCTS_PATH;

    this.logger.debug(
      `Publishing variant=${cmd.internalVariantId} connection=${this.connection.id} ` +
        `mode=${isUpsert ? 'upsert' : 'create'} status=${cmd.status}`,
    );

    let raw: WooCommerceProductResponse;
    try {
      raw = isUpsert
        ? await this.httpClient.put<WooCommerceProductResponse>(path, body)
        : await this.httpClient.post<WooCommerceProductResponse>(path, body);
    } catch (err) {
      throw this.toPublishError(err);
    }

    return { externalProductId: String(raw.id), status: this.fromWcStatus(raw.status) };
  }

  async provisionCategory(cmd: ProvisionCategoryCommand): Promise<ProvisionCategoryResult> {
    let parentId = 0;
    let leafId = '';
    const createdPath: string[] = [];

    for (const node of cmd.path) {
      const existing = await this.findCategory(node.name, parentId);
      if (existing) {
        leafId = String(existing.id);
        parentId = existing.id;
        continue;
      }
      const created = await this.httpClient.post<WooCommerceCategoryResponse>(CATEGORIES_PATH, {
        name: node.name,
        parent: parentId,
      });
      leafId = String(created.id);
      createdPath.push(leafId);
      parentId = created.id;
    }

    return {
      destinationCategoryId: leafId,
      ...(createdPath.length > 0 ? { createdPath } : {}),
    };
  }

  /**
   * Build the sparse WooCommerce product body. `platformParams` is spread first
   * so the explicit, modelled fields always win over any un-modeled knob.
   */
  private buildProductBody(cmd: PublishProductCommand): Record<string, unknown> {
    const content = cmd.content;
    const typed: WooCommerceProductPublishRequest = {
      type: 'simple',
      status: cmd.status === 'published' ? 'publish' : 'draft',
      regular_price: String(cmd.price.amount),
      manage_stock: true,
      stock_quantity: cmd.stock,
    };

    // Truthy (not `!= null`) so an empty string is treated as absent, matching
    // the builder's spread-omit and avoiding an empty `sku` clearing the WC
    // product's SKU on upsert.
    if (cmd.sku) typed.sku = cmd.sku;
    if (cmd.barcode) typed.global_unique_id = cmd.barcode;
    if (cmd.weight != null) typed.weight = String(cmd.weight);
    if (content?.title != null) typed.name = content.title;
    if (content?.description != null) typed.description = content.description;
    if (content?.shortDescription != null) typed.short_description = content.shortDescription;
    if (content?.tags != null) typed.tags = content.tags.map((name) => ({ name }));
    if (content?.imageUrls != null) typed.images = content.imageUrls.map((src) => ({ src }));
    if (content?.seo?.slug != null) typed.slug = content.seo.slug;
    if (cmd.destinationCategoryIds.length > 0) {
      typed.categories = cmd.destinationCategoryIds.map((id) => ({ id: Number(id) }));
    }
    if (cmd.parameters && cmd.parameters.length > 0) {
      // WooCommerce custom attributes carry free-text option strings; the owns-path
      // `valuesIds` (dictionary entry ids) has no WC analogue and is intentionally
      // not emitted in v1.
      typed.attributes = cmd.parameters.map((p) => ({
        name: p.id,
        options: p.values ?? [],
        visible: true,
      }));
    }

    this.applyCommerce(typed, cmd);

    // SEO title/description have no native WooCommerce product field — route them
    // to the SEO-plugin post-meta keys so they aren't silently dropped (#1833).
    const metaData = this.buildSeoMetaData(content?.seo);
    if (metaData.length > 0) typed.meta_data = metaData;

    return { ...(cmd.platformParams ?? {}), ...typed };
  }

  /** Map the neutral `commerce` block (sale price + schedule, dimensions, tax). */
  private applyCommerce(
    typed: WooCommerceProductPublishRequest,
    cmd: PublishProductCommand,
  ): void {
    const commerce = cmd.commerce;
    if (!commerce) return;

    if (commerce.salePrice != null) typed.sale_price = String(commerce.salePrice.amount);
    if (commerce.saleStartsAt != null) typed.date_on_sale_from = commerce.saleStartsAt;
    if (commerce.saleEndsAt != null) typed.date_on_sale_to = commerce.saleEndsAt;
    if (commerce.taxClass != null) typed.tax_class = commerce.taxClass;
    if (commerce.taxStatus != null) typed.tax_status = commerce.taxStatus;

    if (commerce.dimensions != null) {
      const { length, width, height } = commerce.dimensions;
      const dimensions: { length?: string; width?: string; height?: string } = {};
      if (length != null) dimensions.length = String(length);
      if (width != null) dimensions.width = String(width);
      if (height != null) dimensions.height = String(height);
      if (Object.keys(dimensions).length > 0) typed.dimensions = dimensions;
    }
  }

  /**
   * Build SEO post-meta rows for the common SEO plugins. Emits both Yoast and
   * RankMath keys for each supplied value so whichever plugin the store runs
   * picks it up; an absent value emits no rows for that field.
   */
  private buildSeoMetaData(
    seo: PublishProductContent['seo'],
  ): Array<{ key: string; value: string }> {
    const rows: Array<{ key: string; value: string }> = [];
    if (seo?.title != null) {
      for (const key of SEO_TITLE_META_KEYS) rows.push({ key, value: seo.title });
    }
    if (seo?.description != null) {
      for (const key of SEO_DESCRIPTION_META_KEYS) rows.push({ key, value: seo.description });
    }
    return rows;
  }

  private async findCategory(
    name: string,
    parent: number,
  ): Promise<WooCommerceCategoryResponse | null> {
    const matches = await this.httpClient.get<WooCommerceCategoryResponse[]>(CATEGORIES_PATH, {
      search: name,
      parent,
    });
    // WooCommerce `search` is fuzzy — require an exact name + parent match before
    // reusing a node, so a similarly-named sibling is never mis-bound.
    return matches.find((c) => c.name === name && c.parent === parent) ?? null;
  }

  private fromWcStatus(status: WooCommerceProductStatus): PublishProductStatus {
    return status === 'publish' ? 'published' : 'draft';
  }

  /**
   * Map a transport failure to the neutral publish exception. A 4xx is a
   * terminal rejection (no record created/updated) → `ProductPublishRejectedException`
   * (the execution service records `business_failure`). Auth (401/403, a distinct
   * exception type) and 5xx/network propagate untouched for the worker-retry / reauth paths.
   */
  private toPublishError(err: unknown): unknown {
    if (
      err instanceof WooCommerceHttpResponseException &&
      err.statusCode >= 400 &&
      err.statusCode < 500
    ) {
      const adapterKey = this.connection.adapterKey ?? DEFAULT_ADAPTER_KEY;
      return new ProductPublishRejectedException(adapterKey, err.statusCode, [
        { code: err.errorCode ?? 'woocommerce_rejected', message: err.message },
      ]);
    }
    return err;
  }
}
