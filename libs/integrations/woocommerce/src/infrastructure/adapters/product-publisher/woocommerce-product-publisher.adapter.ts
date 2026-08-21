/**
 * WooCommerce Product Publisher Adapter (#1043)
 *
 * Implements `ShopProductManagerPort` (capability `'ProductPublisher'`) plus the
 * `CategoryProvisioner`, `ShopCategoryBrowser` (#1834) and `ShopAttributeReader`
 * (#1835) sub-capabilities against the WooCommerce REST API v3. Pure transport:
 * the core `ProductPublishExecutionService` (#1042) owns the `ShopProduct`
 * identifier mapping + record lifecycle — this adapter only shapes the neutral
 * `PublishProductCommand` onto WooCommerce's `products` / `products/{id}/variations`
 * / `products/categories` / `products/attributes` resources and maps failures
 * back to the neutral `ProductPublishRejectedException`.
 *
 * Publish model (ADR-024 §1/§3, superseded by #1836 for multi-variant): a
 * single-variant / simple product publishes as its own *simple* product
 * (create on first publish, upsert via `externalProductId` thereafter) —
 * unchanged. A **multi-variant** product (`cmd.variantGroup` present) publishes
 * as one shared `type:'variable'` parent carrying every distinguishing
 * attribute flagged `variation:true`, plus one `products/{parentId}/variations`
 * entry per sibling carrying its own price/sku/stock/image/barcode and its own
 * value for each variation attribute (#1836). Neutral `parameters` become
 * WooCommerce product attributes on the parent either way: a parameter with
 * resolved term ids + a numeric global-attribute id links a real global
 * (`pa_*`) attribute, otherwise it falls back to a free-text custom attribute
 * (#1835).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher
 */
import { Logger } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  type DescriptionFormat,
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  SHOP_PUBLICATION_STATUS,
  type CategoryProvisioner,
  type ProvisionCategoryCommand,
  type ProvisionCategoryResult,
  type PublishProductCommand,
  type PublishProductContent,
  type PublishProductResult,
  type PublishProductStatus,
  type PublishProductVariantGroup,
  type ShopAttribute,
  type ShopAttributeReader,
  type ShopAttributeTerm,
  type ShopCategory,
  type ShopCategoryBrowser,
  type ShopProductManagerPort,
  type ShopProductStatusReadResult,
  type ShopProductStatusReader,
  type ShopPublicationStatus,
} from '@openlinker/core/listings';

import { WOOCOMMERCE_DESCRIPTION_FORMAT } from './woocommerce-description-format';

import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import type {
  WooCommerceAttributeResponse,
  WooCommerceAttributeTermResponse,
  WooCommerceCategoryResponse,
  WooCommercePriceCommerceFields,
  WooCommerceProductAttribute,
  WooCommerceProductPublishRequest,
  WooCommerceProductResponse,
  WooCommerceProductStatus,
  WooCommerceProductStatusResponse,
  WooCommerceVariationPublishRequest,
  WooCommerceVariationResponse,
} from './woocommerce-product-publish.types';

const PRODUCTS_PATH = '/wp-json/wc/v3/products';
const CATEGORIES_PATH = '/wp-json/wc/v3/products/categories';
const ATTRIBUTES_PATH = '/wp-json/wc/v3/products/attributes';
const DEFAULT_ADAPTER_KEY = 'woocommerce.restapi.v3';

// WooCommerce caps `per_page` at 100 across all list endpoints. The default (10)
// silently truncates the result set, so an exact category-search match beyond
// the first 10 fuzzy hits is missed and a duplicate category is created (#1846
// fix 3). A search yielding >100 fuzzy hits for one node name is not paginated
// here (accepted: a single category name matching 100+ siblings is not a
// realistic taxonomy).
const WC_LIST_PAGE_SIZE = 100;

// Defensive upper bound on paged list reads (browse categories / attributes /
// terms, #1834/#1835): a misbehaving endpoint that always returns a full page
// would otherwise spin the loop forever. 50 pages x 100 = 5000 rows, far beyond
// any realistic shop taxonomy/attribute set; hitting it logs a warning and stops.
const WC_LIST_MAX_PAGES = 50;

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
  implements
    ShopProductManagerPort,
    CategoryProvisioner,
    ShopCategoryBrowser,
    ShopAttributeReader,
    ShopProductStatusReader
{
  private readonly logger = new Logger(WooCommerceProductPublisherAdapter.name);

  /**
   * WooCommerce stores description HTML broadly, so this is the permissive end
   * of the range: a flat allowlist, no content model, links keep `href`
   * (ADR-046).
   *
   * The real allowlist is WordPress's own `wp_kses`, which varies with the API
   * user's role and the store's configuration - a shop can be more or less
   * permissive than this declaration. That per-CONNECTION variance is exactly
   * why the declaration is a capability method rather than a static manifest
   * entry: deriving it from the connection is possible here later, and would
   * not be from a manifest.
   *
   * Being permissive is safe in the direction that matters: WordPress strips
   * what it dislikes server-side, so an over-broad declaration loses
   * formatting silently at the shop, whereas an over-narrow one would lose it
   * here for every store including those that accept more.
   */
  getDescriptionFormat(): DescriptionFormat {
    return WOOCOMMERCE_DESCRIPTION_FORMAT;
  }


  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly connection: Connection,
  ) {}

  async publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
    if (cmd.variantGroup) {
      return this.publishGroupedVariant(cmd, cmd.variantGroup);
    }
    return this.publishSimpleProduct(cmd);
  }

  /** Pre-#1836 single-variant / simple-product path — unchanged. */
  private async publishSimpleProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
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

  /**
   * Multi-variant path (#1836): upsert the shared `type:'variable'` parent
   * (creating it on the first sibling to publish, reusing it on every later
   * sibling), then upsert this sibling's own `products/{parentId}/variations`
   * entry. Returns the variation's own external id on `externalProductId` plus
   * the resolved parent id on `externalParentProductId` so the execution
   * service can persist both `ShopProduct` mappings.
   */
  private async publishGroupedVariant(
    cmd: PublishProductCommand,
    group: PublishProductVariantGroup,
  ): Promise<PublishProductResult> {
    const parentId = await this.upsertParentVariableProduct(cmd, group);
    const variation = await this.upsertVariation(cmd, group, parentId);
    return { ...variation, externalParentProductId: parentId };
  }

  /**
   * Upsert the shared `variable` parent. Content/category/SEO fields mirror
   * the simple-product path; price/sku/stock/barcode/weight are intentionally
   * absent (those live on each variation). Every sibling's publish re-PUTs the
   * parent when it already exists — idempotent, though it means the parent's
   * shared fields reflect whichever sibling published most recently (accepted
   * MVP posture, documented in ADR-024).
   */
  private async upsertParentVariableProduct(
    cmd: PublishProductCommand,
    group: PublishProductVariantGroup,
  ): Promise<string> {
    const isUpsert = group.externalParentProductId != null && group.externalParentProductId !== '';
    const body = this.buildParentVariableProductBody(cmd, group, isUpsert);
    const path = isUpsert
      ? `${PRODUCTS_PATH}/${encodeURIComponent(String(group.externalParentProductId))}`
      : PRODUCTS_PATH;

    this.logger.debug(
      `Publishing grouped parent groupId=${group.groupId} connection=${this.connection.id} ` +
        `mode=${isUpsert ? 'upsert' : 'create'}`,
    );

    let raw: WooCommerceProductResponse;
    try {
      raw = isUpsert
        ? await this.httpClient.put<WooCommerceProductResponse>(path, body)
        : await this.httpClient.post<WooCommerceProductResponse>(path, body);
    } catch (err) {
      throw this.toPublishError(err, isUpsert, group.externalParentProductId);
    }
    return String(raw.id);
  }

  /**
   * Upsert this sibling's own variation under the resolved parent. Carries the
   * per-sibling price/sku/stock/image/barcode/weight plus this variant's own
   * value for each of the parent's variation-flagged attributes.
   */
  private async upsertVariation(
    cmd: PublishProductCommand,
    group: PublishProductVariantGroup,
    parentId: string,
  ): Promise<PublishProductResult> {
    const isUpsert = cmd.externalProductId != null && cmd.externalProductId !== '';
    const body = this.buildVariationBody(cmd, group, isUpsert);
    const variationsPath = `${PRODUCTS_PATH}/${encodeURIComponent(parentId)}/variations`;
    const path = isUpsert
      ? `${variationsPath}/${encodeURIComponent(String(cmd.externalProductId))}`
      : variationsPath;

    this.logger.debug(
      `Publishing variation variant=${cmd.internalVariantId} parent=${parentId} ` +
        `connection=${this.connection.id} mode=${isUpsert ? 'upsert' : 'create'} status=${cmd.status}`,
    );

    let raw: WooCommerceVariationResponse;
    try {
      raw = isUpsert
        ? await this.httpClient.put<WooCommerceVariationResponse>(path, body)
        : await this.httpClient.post<WooCommerceVariationResponse>(path, body);
    } catch (err) {
      throw this.toPublishError(err, isUpsert, cmd.externalProductId);
    }

    return { externalProductId: String(raw.id), status: cmd.status };
  }

  /**
   * Read the live shop-side publication status of a published product (#1845).
   * Maps WooCommerce's native `status` onto the neutral `ShopPublicationStatus`;
   * a 404 (product deleted/trashed shop-side) maps to `removed` so the core
   * reconcile can detect an unpublished/removed product without treating it as a
   * transport error. Other transport failures propagate for the runner's
   * transient-retry path.
   */
  async getShopProductStatus(externalProductId: string): Promise<ShopProductStatusReadResult> {
    const path = `${PRODUCTS_PATH}/${encodeURIComponent(externalProductId)}`;
    let raw: WooCommerceProductStatusResponse;
    try {
      raw = await this.httpClient.get<WooCommerceProductStatusResponse>(path);
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        return { publicationStatus: SHOP_PUBLICATION_STATUS.Removed };
      }
      throw err;
    }
    return { publicationStatus: this.toPublicationStatus(raw.status) };
  }

  /**
   * Read the live status of a grouped-publish CHILD variation (whole-epic review
   * finding #2). A variation lives at a different resource than a standalone
   * simple product — `products/{parentId}/variations/{id}`, not `products/{id}`
   * — so calling `getShopProductStatus` with a variation id 404s and would be
   * misread as `removed` even though the variation is genuinely live. Same 404
   * → `removed` mapping as the simple-product path.
   */
  async getShopVariationStatus(
    externalParentProductId: string,
    externalVariationId: string,
  ): Promise<ShopProductStatusReadResult> {
    const path = `${PRODUCTS_PATH}/${encodeURIComponent(externalParentProductId)}/variations/${encodeURIComponent(externalVariationId)}`;
    let raw: WooCommerceProductStatusResponse;
    try {
      raw = await this.httpClient.get<WooCommerceProductStatusResponse>(path);
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        return { publicationStatus: SHOP_PUBLICATION_STATUS.Removed };
      }
      throw err;
    }
    return { publicationStatus: this.toPublicationStatus(raw.status) };
  }

  /**
   * Map a WooCommerce native product status onto the neutral union. `publish` is
   * live; `draft` reverted to draft; `pending`/`private` are present but not
   * buyer-visible (unpublished); `trash` (or any unknown value) is treated as
   * removed shop-side.
   */
  private toPublicationStatus(status: string): ShopPublicationStatus {
    switch (status) {
      case 'publish':
        return SHOP_PUBLICATION_STATUS.Published;
      case 'draft':
        return SHOP_PUBLICATION_STATUS.Draft;
      case 'pending':
      case 'private':
        return SHOP_PUBLICATION_STATUS.Unpublished;
      case 'trash':
        return SHOP_PUBLICATION_STATUS.Removed;
      default:
        return SHOP_PUBLICATION_STATUS.Removed;
    }
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
   * List the shop's existing category nodes directly under `parentId` (#1834).
   * Omitting `parentId` lists root-level categories (WooCommerce `parent=0`).
   * Unlike a marketplace's leaf-gated taxonomy, every WooCommerce category is a
   * valid product placement, so no `leaf` flag is emitted — the picker allows
   * selecting any node and drilling into any node.
   *
   * Pages through the parent-scoped result set at the WC maximum `per_page` so a
   * parent with more than one page of direct children is fully enumerated; stops
   * on the first short page.
   */
  async browseCategories(parentId?: string): Promise<ShopCategory[]> {
    const parent = this.toParentNumber(parentId);
    const collected: ShopCategory[] = [];

    for (let page = 1; page <= WC_LIST_MAX_PAGES; page += 1) {
      const batch = await this.httpClient.get<WooCommerceCategoryResponse[]>(CATEGORIES_PATH, {
        parent,
        per_page: WC_LIST_PAGE_SIZE,
        page,
        orderby: 'name',
        order: 'asc',
      });
      for (const node of batch) {
        collected.push({
          id: String(node.id),
          name: node.name,
          parentId: node.parent === 0 ? null : String(node.parent),
        });
      }
      if (batch.length < WC_LIST_PAGE_SIZE) return collected;
      if (page === WC_LIST_MAX_PAGES) {
        this.logger.warn(
          `browseCategories hit the ${WC_LIST_MAX_PAGES}-page cap for parent=${parent} ` +
            `(connection=${this.connection.id}); returning the first ${collected.length} categories. ` +
            `The endpoint may be misbehaving or the taxonomy is unexpectedly large.`,
        );
      }
    }

    return collected;
  }

  /**
   * List the store's global product attributes (#1835) — the `pa_*` taxonomies
   * an operator picks from in the structured attribute picker. Reads
   * `GET /products/attributes`, paged at the WC maximum `per_page`.
   */
  async listAttributes(): Promise<ShopAttribute[]> {
    const rows = await this.fetchAllPages<WooCommerceAttributeResponse>(ATTRIBUTES_PATH, {
      label: 'listAttributes',
    });
    return rows.map((a) => ({ id: String(a.id), name: a.name, slug: a.slug }));
  }

  /**
   * List the predefined terms of one global attribute (#1835). Reads
   * `GET /products/attributes/{id}/terms`, paged at the WC maximum `per_page`.
   * The term ids returned here are threaded back on publish as the neutral
   * `OfferParameter.valuesIds` global-attribute linkage.
   */
  async listAttributeTerms(attributeId: string): Promise<ShopAttributeTerm[]> {
    const path = `${ATTRIBUTES_PATH}/${encodeURIComponent(attributeId)}/terms`;
    const rows = await this.fetchAllPages<WooCommerceAttributeTermResponse>(path, {
      label: 'listAttributeTerms',
    });
    return rows.map((t) => ({ id: String(t.id), name: t.name, slug: t.slug }));
  }

  /**
   * Page through a WC list endpoint at the maximum `per_page`, stopping on the
   * first short page. Bounded by `WC_LIST_MAX_PAGES` so a misbehaving endpoint
   * that always returns a full page cannot spin forever (logs + stops). Ordered
   * by name for a stable picker; `orderby=name` is a no-op on endpoints that
   * ignore it.
   */
  private async fetchAllPages<T>(path: string, ctx: { label: string }): Promise<T[]> {
    const collected: T[] = [];
    for (let page = 1; page <= WC_LIST_MAX_PAGES; page += 1) {
      const batch = await this.httpClient.get<T[]>(path, {
        per_page: WC_LIST_PAGE_SIZE,
        page,
        orderby: 'name',
        order: 'asc',
      });
      collected.push(...batch);
      if (batch.length < WC_LIST_PAGE_SIZE) return collected;
      if (page === WC_LIST_MAX_PAGES) {
        this.logger.warn(
          `${ctx.label} hit the ${WC_LIST_MAX_PAGES}-page cap for path=${path} ` +
            `(connection=${this.connection.id}); returning the first ${collected.length} rows. ` +
            `The endpoint may be misbehaving or the attribute set is unexpectedly large.`,
        );
      }
    }
    return collected;
  }

  /**
   * Map a neutral parent id to the WooCommerce `parent` query value. A blank /
   * absent id means "root level" (`parent=0`); a non-numeric id is a caller
   * error surfaced as `0` rather than a silent NaN.
   */
  private toParentNumber(parentId?: string): number {
    if (parentId == null || parentId.trim() === '') return 0;
    const parsed = Number(parentId);
    return Number.isFinite(parsed) ? parsed : 0;
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

  /**
   * Build the shared `variable` parent body (#1836). Mirrors `buildProductBody`
   * for content/category/SEO fields; price/sku/stock/barcode/weight are
   * intentionally absent (per-sibling, carried on the variation body instead).
   * Attributes merge the plain category-parameter attributes with the
   * variation-flagged distinguishing axes so WC knows which attributes a
   * variation may select a value from.
   */
  private buildParentVariableProductBody(
    cmd: PublishProductCommand,
    group: PublishProductVariantGroup,
    isUpsert: boolean,
  ): Record<string, unknown> {
    const content = cmd.content;
    const typed: WooCommerceProductPublishRequest = {
      type: 'variable',
      status: cmd.status === 'published' ? 'publish' : 'draft',
    };

    if (content?.title != null) typed.name = content.title;
    if (content?.description != null) typed.description = content.description;
    if (content?.shortDescription != null) typed.short_description = content.shortDescription;
    if (content?.tags != null && content.tags.length > 0) {
      typed.tags = content.tags.map((name) => ({ name }));
    }
    // Images churn on every WC re-import (#1846 fix 7) — create-only, same
    // guard as the simple-product path.
    if (!isUpsert && content?.imageUrls != null) {
      typed.images = content.imageUrls.map((src) => ({ src }));
    }
    // The parent's slug is keyed on the GROUP id (not the variant id) so every
    // sibling's publish resolves to the same stable slug, regardless of which
    // sibling happens to trigger the parent upsert (#1846 fix 4 extended).
    if (content?.seo?.slug != null) {
      typed.slug = this.buildGroupSlug(content.seo.slug, group.groupId);
    }
    if (cmd.destinationCategoryIds.length > 0) {
      typed.categories = cmd.destinationCategoryIds.map((id) => ({ id: Number(id) }));
    }

    const attributes = [
      ...this.buildAttributes(cmd.parameters),
      ...this.buildVariationFlaggedAttributes(group.groupAttributeValues),
    ];
    if (attributes.length > 0) typed.attributes = attributes;

    // Price/sale-price/sale-window fields are intentionally excluded on the
    // PARENT (whole-epic review finding #3): WooCommerce derives a variable
    // product's price/sale/on-sale state from its VARIATIONS, not the parent
    // post, so writing them here is silently ignored. `applyCommerce` still
    // writes dimensions/tax_class, which ARE legitimate parent-level fields.
    this.applyCommerce(typed, cmd, { includePricing: false });

    const metaData = this.buildSeoMetaData(content?.seo);
    if (metaData.length > 0) typed.meta_data = metaData;

    return { ...(cmd.platformParams ?? {}), ...typed };
  }

  /**
   * Declare the parent's variation axes: one entry per distinguishing
   * attribute name, carrying the FULL union of sibling values (so any sibling
   * variation can select from it) and `variation: true`. Custom (not global)
   * — `ProductVariant.attributes` are freeform names with no WC global
   * (`pa_*`) attribute id to link.
   */
  private buildVariationFlaggedAttributes(
    groupAttributeValues: Record<string, string[]>,
  ): WooCommerceProductAttribute[] {
    return Object.entries(groupAttributeValues)
      .filter(([name, values]) => name.length > 0 && values.length > 0)
      .map(([name, values]) => ({ name, options: values, visible: true, variation: true }));
  }

  /**
   * Build the per-sibling variation body (#1836): price/sku/stock/image/
   * barcode/weight/commerce fields, plus this variant's own value for each
   * parent variation-flagged attribute (WC variation attributes carry a
   * singular `option`, not the plural `options` array).
   */
  private buildVariationBody(
    cmd: PublishProductCommand,
    group: PublishProductVariantGroup,
    isUpsert: boolean,
  ): Record<string, unknown> {
    const typed: WooCommerceVariationPublishRequest = {
      status: cmd.status === 'published' ? 'publish' : 'draft',
      regular_price: String(cmd.price.amount),
      manage_stock: true,
      stock_quantity: cmd.stock,
    };

    if (cmd.sku) typed.sku = cmd.sku;
    if (cmd.barcode) typed.global_unique_id = cmd.barcode;
    if (cmd.weight != null) typed.weight = String(cmd.weight);
    // Single sideloaded image, create-only (same re-import churn guard as the
    // simple-product / parent paths, #1846 fix 7).
    const imageUrl = cmd.content?.imageUrls?.[0];
    if (!isUpsert && imageUrl != null) typed.image = { src: imageUrl };

    const attributes = group.attributes
      .filter((a) => a.name.length > 0 && a.value.length > 0)
      .map((a) => ({ name: a.name, option: a.value }));
    if (attributes.length > 0) typed.attributes = attributes;

    this.applyCommerce(typed, cmd);

    return { ...(cmd.platformParams ?? {}), ...typed };
  }

  /**
   * Map the neutral `commerce` block (sale price + schedule, dimensions, tax).
   * Typed against the shared `WooCommercePriceCommerceFields` shape so it can
   * write into either the parent/simple-product body or a variation body.
   * `includePricing` (default `true`) gates the price/sale-price/sale-window
   * fields off for the `variable` PARENT body (whole-epic review finding #3) —
   * WooCommerce derives those from the VARIATIONS, not the parent post, so
   * writing them there is silently ignored. Dimensions/tax always apply.
   */
  private applyCommerce(
    typed: WooCommercePriceCommerceFields,
    cmd: PublishProductCommand,
    { includePricing = true }: { includePricing?: boolean } = {},
  ): void {
    const commerce = cmd.commerce;
    if (!commerce) return;

    if (includePricing) {
      if (commerce.salePrice != null) typed.sale_price = String(commerce.salePrice.amount);
      // Neutral sale window is UTC (ISO 8601); write the `_gmt` fields so WC
      // does not reinterpret the value as site-local and shift the window.
      if (commerce.saleStartsAt != null) typed.date_on_sale_from_gmt = commerce.saleStartsAt;
      if (commerce.saleEndsAt != null) typed.date_on_sale_to_gmt = commerce.saleEndsAt;
    }
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
   * Map neutral projected/operator parameters to WooCommerce product attributes,
   * preferring real **global** attributes over free-text custom ones (#1835).
   *
   * A parameter carrying `valuesIds` (term ids from `ShopAttributeReader`) plus a
   * numeric `id` (the global-attribute id) is emitted as a global-attribute
   * linkage `{ id, options, visible }`, where `options` are the term names
   * (`values`) — WooCommerce resolves those to the attribute's existing terms.
   * This is what powers storefront filtering; term ids alone have no place in the
   * WC product `attributes[]` wire (options are name/slug strings), so the names
   * on `values` are the linkage payload.
   *
   * Any other parameter falls back to a free-text custom attribute
   * `{ name, options, visible }`. As before (#1846 fix 2), a custom parameter with
   * no free-text `values` is dropped rather than emitted as an empty, valueless
   * attribute row. A global-attribute linkage with no chosen terms is likewise
   * skipped — an attribute assignment with zero terms carries no information.
   */
  private buildAttributes(
    parameters: PublishProductCommand['parameters'],
  ): WooCommerceProductAttribute[] {
    if (!parameters || parameters.length === 0) return [];
    const attributes: WooCommerceProductAttribute[] = [];
    for (const p of parameters) {
      const options = p.values ?? [];
      const globalAttributeId = this.toGlobalAttributeId(p.valuesIds, p.id);

      if (globalAttributeId != null) {
        if (options.length === 0) {
          this.logger.debug(
            `Dropping WooCommerce global attribute "${p.id}" with no chosen term names ` +
              `(term ids alone cannot be sent in the product attributes wire).`,
          );
          continue;
        }
        attributes.push({ id: globalAttributeId, options, visible: true });
        continue;
      }

      if (options.length === 0) {
        this.logger.debug(
          `Dropping WooCommerce custom attribute "${p.id}" with no free-text values ` +
            `(dictionary-typed valuesIds without a numeric global-attribute id have no WC analogue).`,
        );
        continue;
      }
      attributes.push({ name: p.id, options, visible: true });
    }
    return attributes;
  }

  /**
   * Decide whether a neutral parameter is a WooCommerce global-attribute linkage.
   * It is when it carries resolved term ids (`valuesIds`) AND its `id` is the
   * numeric global-attribute id. A `valuesIds`-bearing parameter whose `id` is
   * not numeric (e.g. a dictionary param projected for a different platform) is
   * NOT a WC global attribute and falls back to the custom path.
   */
  private toGlobalAttributeId(valuesIds: string[] | undefined, id: string): number | null {
    if (!valuesIds || valuesIds.length === 0) return null;
    const parsed = Number(id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  /**
   * Build a per-item, deterministic slug from the builder-supplied base slug.
   * Suffixing keeps sibling variants collision-free — WooCommerce would
   * otherwise auto-suffix a shared slug (-2/-3) — while staying stable across
   * re-publishes of the same item (so the canonical URL does not drift).
   *
   * The discriminator is the **internal variant id**, not the SKU: the id is
   * immutable for the life of the variant, whereas a SKU can be absent at first
   * publish and gained later — which would silently change the slug on a
   * subsequent upsert and drift the WC permalink. Correctness (a stable URL)
   * beats the marginally more readable SKU-based slug.
   */
  private buildPerItemSlug(baseSlug: string, cmd: PublishProductCommand): string {
    const discriminator = this.slugify(cmd.internalVariantId);
    return discriminator ? `${baseSlug}-${discriminator}` : baseSlug;
  }

  /**
   * Build the shared parent slug from the GROUP id (#1836) — the parent slug
   * must resolve to the SAME value regardless of which sibling's publish
   * triggers the parent upsert, unlike the per-variant slug above (which
   * exists precisely so sibling simple products do NOT share one slug).
   */
  private buildGroupSlug(baseSlug: string, groupId: string): string {
    const discriminator = this.slugify(groupId);
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
      per_page: WC_LIST_PAGE_SIZE,
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
