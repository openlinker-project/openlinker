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
  ProductPublishTargetNotFoundException,
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

// WooCommerce caps `per_page` at 100. The default (10) silently truncates the
// category-search result set, so an exact name match beyond the first 10 fuzzy
// hits is missed and a duplicate category is created (#1846 fix 3).
const CATEGORY_SEARCH_PER_PAGE = 100;

// WC REST error code returned when a category name already exists under the same
// parent — surfaces on a concurrent/racing provision. The response carries the
// existing term id, letting us reuse it instead of failing (#1846 fix 3).
const WC_TERM_EXISTS_CODE = 'term_exists';

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
    const isUpsert = cmd.externalProductId != null && cmd.externalProductId !== '';
    const body = this.buildProductBody(cmd, isUpsert);
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
      throw this.toPublishError(err, isUpsert, cmd.externalProductId);
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
      const created = await this.createCategory(node.name, parentId);
      leafId = String(created.id);
      if (created.created) createdPath.push(leafId);
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
  private buildProductBody(
    cmd: PublishProductCommand,
    isUpsert: boolean,
  ): Record<string, unknown> {
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
    // Omit an empty tags array: sending `tags: []` on upsert would CLEAR the WC
    // product's existing tags, violating the "never clear an untouched field"
    // contract. An explicit non-empty list still replaces the set.
    if (content?.tags != null && content.tags.length > 0) {
      typed.tags = content.tags.map((name) => ({ name }));
    }
    // Images are sideloaded by `src`; WooCommerce re-imports (churns/duplicates)
    // the media on every update. Only send them on create — image updates on
    // upsert need media-id tracking and are a deferred enhancement (#1846 fix 7).
    if (!isUpsert && content?.imageUrls != null) {
      typed.images = content.imageUrls.map((src) => ({ src }));
    }
    // Per-item slug: bulk publishes several sibling variants as distinct simple
    // products. Sending the same base slug for each lets WooCommerce silently
    // auto-suffix (-2/-3), drifting the canonical URL. Discriminate the slug per
    // item so each is deterministic and collision-free across re-publishes
    // (#1846 fix 4).
    if (content?.seo?.slug != null) typed.slug = this.buildPerItemSlug(content.seo.slug, cmd);
    if (cmd.destinationCategoryIds.length > 0) {
      typed.categories = cmd.destinationCategoryIds.map((id) => ({ id: Number(id) }));
    }
    const attributes = this.buildAttributes(cmd.parameters);
    if (attributes.length > 0) typed.attributes = attributes;

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
    // Neutral sale window is UTC (ISO 8601); write the `_gmt` fields so WC does
    // not reinterpret the value as site-local and shift the window.
    if (commerce.saleStartsAt != null) typed.date_on_sale_from_gmt = commerce.saleStartsAt;
    if (commerce.saleEndsAt != null) typed.date_on_sale_to_gmt = commerce.saleEndsAt;
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

  /**
   * Map neutral projected/operator parameters to WooCommerce custom attributes.
   * WooCommerce custom attributes carry only free-text option strings — the
   * owns-path `valuesIds` (dictionary entry ids) has no WC analogue. A parameter
   * that resolves to no free-text `values` (dictionary-only, or empty) is dropped
   * cleanly rather than emitted as an empty `options: []` attribute, which would
   * write a visible-but-valueless attribute row (silent data loss, #1846 fix 2).
   */
  private buildAttributes(
    parameters: PublishProductCommand['parameters'],
  ): Array<{ name: string; options: string[]; visible: boolean }> {
    if (!parameters || parameters.length === 0) return [];
    const attributes: Array<{ name: string; options: string[]; visible: boolean }> = [];
    for (const p of parameters) {
      const options = p.values ?? [];
      if (options.length === 0) {
        this.logger.debug(
          `Dropping WooCommerce attribute "${p.id}" with no free-text values ` +
            `(dictionary-typed valuesIds have no WC analogue).`,
        );
        continue;
      }
      attributes.push({ name: p.id, options, visible: true });
    }
    return attributes;
  }

  /**
   * Build a per-item, deterministic slug from the builder-supplied base slug.
   * Suffixing with the item's SKU (falling back to the internal variant id)
   * keeps sibling variants collision-free — WooCommerce would otherwise
   * auto-suffix a shared slug (-2/-3) — while staying stable across re-publishes
   * of the same item (so the canonical URL does not drift).
   */
  private buildPerItemSlug(baseSlug: string, cmd: PublishProductCommand): string {
    const discriminator = this.slugify(cmd.sku ?? cmd.internalVariantId);
    return discriminator ? `${baseSlug}-${discriminator}` : baseSlug;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '');
  }

  private async findCategory(
    name: string,
    parent: number,
  ): Promise<WooCommerceCategoryResponse | null> {
    const matches = await this.httpClient.get<WooCommerceCategoryResponse[]>(CATEGORIES_PATH, {
      search: name,
      parent,
      // WooCommerce defaults `per_page` to 10; a store with many same-prefix
      // siblings would truncate the fuzzy result set and miss the exact match,
      // then create a duplicate. Request the WC maximum so the exact match is
      // always in range (#1846 fix 3).
      per_page: CATEGORY_SEARCH_PER_PAGE,
    });
    // WooCommerce `search` is fuzzy — require an exact name + parent match before
    // reusing a node, so a similarly-named sibling is never mis-bound.
    return matches.find((c) => c.name === name && c.parent === parent) ?? null;
  }

  /**
   * Create a category node, tolerating a concurrent creation race. Two publishes
   * provisioning the same path at once can both miss `findCategory` and POST; the
   * loser gets a WC `term_exists` 4xx. Instead of failing (which would create a
   * duplicate on a naive retry), re-resolve the now-existing node and reuse it —
   * an idempotency guard around the non-atomic find-then-create (#1846 fix 3).
   */
  private async createCategory(
    name: string,
    parent: number,
  ): Promise<{ id: number; created: boolean }> {
    try {
      const created = await this.httpClient.post<WooCommerceCategoryResponse>(CATEGORIES_PATH, {
        name,
        parent,
      });
      return { id: created.id, created: true };
    } catch (err) {
      if (
        err instanceof WooCommerceHttpResponseException &&
        err.errorCode === WC_TERM_EXISTS_CODE
      ) {
        const existing = await this.findCategory(name, parent);
        if (existing) return { id: existing.id, created: false };
      }
      throw err;
    }
  }

  private fromWcStatus(status: WooCommerceProductStatus): PublishProductStatus {
    return status === 'publish' ? 'published' : 'draft';
  }

  /**
   * Map a transport failure to the neutral publish exception.
   *
   * - Upsert 404 → `ProductPublishTargetNotFoundException`: the mapped product
   *   was deleted shop-side; core deletes the stale mapping and re-creates
   *   (#1846 fix 1), not a terminal failure.
   * - 429 (rate limit) / 408 (request timeout) → propagate untouched: these are
   *   transient, so the worker retries the whole job rather than recording a
   *   `business_failure` (#1846 fix 6). (The HTTP client already retries 429/5xx
   *   internally; a surfaced 429 means its own budget was exhausted.)
   * - Other 4xx → terminal rejection (no record created/updated) →
   *   `ProductPublishRejectedException` (the execution service records
   *   `business_failure`).
   * - Auth (401/403, a distinct exception type) and 5xx/network propagate
   *   untouched for the worker-retry / reauth paths.
   */
  private toPublishError(
    err: unknown,
    isUpsert: boolean,
    externalProductId?: string | null,
  ): unknown {
    if (!(err instanceof WooCommerceHttpResponseException)) return err;

    const adapterKey = this.connection.adapterKey ?? DEFAULT_ADAPTER_KEY;

    if (isUpsert && err.statusCode === 404 && externalProductId != null) {
      return new ProductPublishTargetNotFoundException(adapterKey, String(externalProductId));
    }

    // Transient 4xx — let the worker retry the job instead of failing terminally.
    if (err.statusCode === 429 || err.statusCode === 408) return err;

    if (err.statusCode >= 400 && err.statusCode < 500) {
      return new ProductPublishRejectedException(adapterKey, err.statusCode, [
        { code: err.errorCode ?? 'woocommerce_rejected', message: err.message },
      ]);
    }
    return err;
  }
}
