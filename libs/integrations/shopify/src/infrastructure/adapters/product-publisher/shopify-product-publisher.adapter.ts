/**
 * Shopify Product Publisher Adapter (#3979)
 *
 * Implements `ShopProductManagerPort` (registry capability `ProductPublisher`)
 * and `CategoryProvisioner` for the Shopify Admin GraphQL API 2026-10: OpenLinker
 * publishes a master product (PrestaShop in the #3928 scenario) to a Shopify
 * shop, and a re-publish updates the product it mapped instead of creating a
 * second one.
 *
 * Simple product (no `variantGroup`): one `productSet` call. Create sends the
 * product, Shopify's default option and one variant with its stock at the
 * connection's single location. Update reads the mapped product first (a direct
 * read, never search, which lags writes by seconds), refuses one that no longer
 * has exactly one variant, and sends the same input with the existing variant
 * id - `productSet` deletes any variant an update does not list.
 *
 * Multi-variant product (`variantGroup`): one Shopify product per group, one
 * Shopify variant per OpenLinker variant, the result's `externalProductId` being
 * the Shopify VARIANT id and `externalParentProductId` the product id (the
 * WooCommerce #1836 contract). The first sibling creates the product with
 * `productSet` (its own variant included); every later sibling updates the
 * product-level fields with `productSet` WITHOUT `variants` (PATCH semantics,
 * SPIKE-2879 E-P5, so the siblings survive) and then creates or updates only
 * its own variant through `productVariantsBulkCreate` / `Update`. A sibling
 * with no mapping first looks for a variant carrying its option values and
 * adopts it, so a publish whose mapping write was lost does not duplicate it.
 * The product-level fields (status, title, description) are shared, so the
 * sibling published last sets them for the whole product; within one batch
 * they are the same for every sibling.
 *
 * Sibling race (L-S2b): siblings publish concurrently, and two that both find
 * no parent mapping each create a product. Shopify does not serialise
 * `productSet` by handle (it suffixes `-1`, `-2`, measured live) and the host
 * offers no lock, so the race is settled AFTER the create instead: every
 * group product gets the same handle (`groupHandle`) and an `openlinker.
 * variant_group` metafield, and the creator reads the products holding
 * `<handle>`, `<handle>-1` ... directly. The winner is the one holding the bare
 * handle (exactly one can), else the lowest id among marked candidates. A
 * loser moves its variant onto the winner, deletes its own product and reports
 * the winner as the parent, so every sibling's mapping names one product.
 * A create whose explicit handle is already taken is REFUSED by Shopify
 * (HANDLE_NOT_UNIQUE, measured live on the 3-sibling batch) rather than
 * suffixed; that loser reads the product holding the handle and, when it
 * carries this group's marker, adds its variant there instead.
 *
 * Prices: GROSS in, as the shop stores them out. A shop entering prices with
 * tax gets them unchanged; one entering them without gets net, divided by the
 * catalogue's rate (`resolvePublishPriceBasis`), and an exempt rate leaves the
 * variant not taxable. A price-only update has no rate on its command, so on a
 * tax-exclusive shop it asks Shopify for the variant's own rate
 * (`ShopifyTaxRateReader`) and refuses when that is unknown.
 *
 * Not on a master connection: a connection that is also the ProductMaster
 * would read every product it publishes back as a new master product, so a
 * publish there is refused naming the remedy. A stopgap for the core issue
 * #3985 (which also covers Shoper and WooCommerce); remove it once that lands.
 *
 * Stock: the configured location only (`ShopifyShopContextProvider`). A create
 * sets it in the same call; an update sets it with `inventorySetQuantities`
 * (compare-and-set against the level read with the product).
 *
 * Visibility: `status: published` writes `ACTIVE` and publishes the product to
 * the Online Store publication (looked up once per adapter instance);
 * `draft` writes `DRAFT` and leaves publications alone.
 *
 * Category: collections. `browseCategories` lists the shop's manual
 * collections (flat, no parents) for the destination taxonomy sync behind the
 * category picker; smart collections are left out, since a product cannot be
 * added to one. `provisionCategory` resolves a path to one collection
 * whose handle is derived from the whole path (a direct handle read, so a
 * collection created a moment ago is found), creating it when absent; a publish
 * then adds the product to every destination collection it is not yet in.
 *
 * Parameters: product metafields, written with `metafieldsSet` after the
 * product exists (see `shopify-product-metafields.mapper`): a parameter linked
 * to one of the shop's product metafield definitions keeps that definition's
 * namespace, key and type; any other goes to the `openlinker` namespace as
 * text. `ShopAttributeReader` offers those definitions (with their `choices`
 * as terms) to the publish edit flow. Taxonomy category attributes
 * (`shopify.*`, metaobject references) are not written. A re-publish upserts
 * the parameters it carries and never deletes one it no longer carries.
 *
 * Nothing after the product exists may throw: the caller persists the mapping
 * only once this method returns, so a throw would make the job retry and
 * create a second product. Everything after the write that fails becomes a
 * warning, as does every command field Shopify is not given.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/product-publisher
 * @implements {ShopProductManagerPort}
 */
import { randomUUID } from 'node:crypto';

import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  type CategoryProvisioner,
  type DescriptionFormat,
  type ProvisionCategoryCommand,
  type ProvisionCategoryResult,
  type PublishProductCommand,
  type PublishProductResult,
  type PublishProductStatus,
  type PublishProductVariantGroup,
  type ShopAttribute,
  type ShopCategory,
  type ShopCategoryBrowser,
  type ShopAttributeReader,
  type ShopAttributeTerm,
  type ShopCurrencyDeclarer,
  type ShopProductManagerPort,
  type ShopProductPriceUpdater,
  type UpdateShopProductPriceCommand,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import { SHOPIFY_ADAPTER_KEY } from '../../../shopify.constants';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { shopifyGrossFactor } from '../../mappers/shopify-product.mapper';
import type { ShopifyTaxRateReader } from '../../tax/shopify-tax-rate.reader';
import type {
  ShopifyShopContext,
  ShopifyShopContextProvider,
} from '../../shop-context/shopify-shop-context.provider';
import { SHOPIFY_DESCRIPTION_FORMAT } from './shopify-description-format';
import {
  COLLECTION_ADD_PRODUCTS_MUTATION,
  COLLECTION_BY_HANDLE_QUERY,
  COLLECTION_CREATE_MUTATION,
  GROUP_MARKER_KEY,
  GROUP_MARKER_NAMESPACE,
  groupCandidatesQuery,
  INVENTORY_SET_MUTATION,
  MANUAL_COLLECTIONS_QUERY,
  METAFIELDS_SET_MUTATION,
  PRODUCT_DELETE_MUTATION,
  PRICE_TARGET_QUERY,
  PRODUCT_METAFIELD_DEFINITIONS_QUERY,
  PRODUCT_SET_MUTATION,
  PUBLICATIONS_QUERY,
  PUBLISH_TARGET_QUERY,
  PUBLISHABLE_PUBLISH_MUTATION,
  VARIANTS_BULK_CREATE_MUTATION,
  VARIANTS_BULK_UPDATE_MUTATION,
  VARIANT_PRICE_UPDATE_MUTATION,
  type CollectionByHandleQuery,
  type CollectionCreatePayload,
  type GroupCandidateNode,
  type ManualCollectionsQuery,
  type MetafieldDefinitionsQuery,
  type PriceTargetQuery,
  type ProductSetPayload,
  type PublicationsQuery,
  type PublishablePublishPayload,
  type PublishedProductNode,
  type PublishedVariantNode,
  type PublishTargetQuery,
  type VariantsBulkPayload,
} from './shopify-product-publish.graphql';
import {
  definitionChoices,
  definitionRef,
  isWritableMetafieldType,
  planMetafields,
  type MetafieldWrite,
  type ShopifyMetafieldDefinitionNode,
} from './shopify-product-metafields.mapper';
import {
  buildFilesInput,
  buildPriceFields,
  buildProductFields,
  buildVariantCoreFields,
  DEFAULT_OPTION_NAME,
  DEFAULT_OPTION_VALUE,
  groupHandle,
  planImages,
  resolvePublishPriceBasis,
  toShopifyHandle,
  toStoreAmount,
  unsupportedFieldWarnings,
  type OptionValueRef,
} from './shopify-product-publish.mapper';

/** Shopify allows three options per product (SPIKE-2879 E-P9). */
const MAX_PRODUCT_OPTIONS = 3;

// `Publication` has no name on 2026-10; the channel shows only in the catalog
// title (`ChannelCatalog<id>forOnlineStore`), compared without spaces or case.
const ONLINE_STORE_PUBLICATION = 'onlinestore';

/** `metafieldsSet` takes at most 25 metafields per call. */
const METAFIELDS_PER_CALL = 25;
const DEFINITIONS_PAGE_SIZE = 250;
/** `namespace.key`: what a linked parameter id looks like. */
const DEFINITION_REF = /^[^.\s]+\.[^.\s]+$/;
/** `<handle>` plus `-1` .. `-5`: the concurrent sibling creates a race can produce and still be settled. */
const GROUP_HANDLE_PROBES = 6;
const COLLECTIONS_PAGE_SIZE = 250;

/** The capability a publish must not share a connection with (#3985). */
const PRODUCT_MASTER_CAPABILITY = 'ProductMaster';


type PriceBasis = { readonly divisor: number; readonly exempt: boolean };

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasValue(id: string | null | undefined): id is string {
  return id !== null && id !== undefined && id.trim().length > 0;
}

function statusOf(shopifyStatus: string): PublishProductStatus {
  return shopifyStatus === 'ACTIVE' ? 'published' : 'draft';
}

/** The variant whose selected options carry every one of `optionValues`. */
function findVariantByOptions(
  variants: readonly PublishedVariantNode[],
  optionValues: readonly OptionValueRef[],
): PublishedVariantNode | undefined {
  return variants.find((variant) =>
    optionValues.every((wanted) =>
      variant.selectedOptions.some((o) => o.name === wanted.optionName && o.value === wanted.name),
    ),
  );
}

/** A user error about the files (images) of a productSet input. */
function isFilesError(error: ShopifyUserErrorsException): boolean {
  return error.userErrors.some(
    (e) => (e.field ?? []).some((f) => /^files?$|media|image/i.test(f)) || /file|image|media/i.test(e.message),
  );
}

export class ShopifyProductPublisherAdapter
  implements
    ShopProductManagerPort,
    CategoryProvisioner,
    ShopCurrencyDeclarer,
    ShopProductPriceUpdater,
    ShopAttributeReader,
    ShopCategoryBrowser
{
  private readonly logger = new Logger(ShopifyProductPublisherAdapter.name);
  /** The Online Store publication id, read once per adapter instance; a failed read is retried next time. */
  private onlineStorePublication: Promise<string | null> | null = null;
  /** The shop's product metafield definitions by `namespace.key`, read once per adapter instance. */
  private metafieldDefinitions: Promise<Map<string, ShopifyMetafieldDefinitionNode>> | null = null;

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly connection: Connection,
    // Price-only updates on a tax-exclusive shop; absent, such an update is refused.
    private readonly taxRateReader?: ShopifyTaxRateReader,
  ) {}

  getDescriptionFormat(): DescriptionFormat {
    return SHOPIFY_DESCRIPTION_FORMAT;
  }

  /** The shop's own currency (`shop.currencyCode`), for the price-change review. */
  async getDestinationCurrency(): Promise<string | null> {
    return (await this.shopContext.get()).currencyCode ?? null;
  }

  /**
   * Price only: `productVariantsBulkUpdate` on the one variant, nothing else
   * rides along. A sale price writes `price` = sale and `compareAtPrice` =
   * regular, the same mapping the publish uses.
   */
  async updateShopProductPrice(cmd: UpdateShopProductPriceCommand): Promise<void> {
    const ids = cmd.externalParentProductId
      ? [toShopifyGid('ProductVariant', cmd.externalProductId)]
      : [toShopifyGid('Product', cmd.externalProductId), toShopifyGid('ProductVariant', cmd.externalProductId)];
    const data = await this.client.query<PriceTargetQuery>(PRICE_TARGET_QUERY, { ids });
    let productId: string | null = null;
    let variantId: string | null = null;
    for (const node of data.nodes) {
      if (node && node.__typename === 'ProductVariant' && 'product' in node) {
        productId = node.product.id;
        variantId = node.id;
      } else if (node && node.__typename === 'Product' && 'variants' in node && variantId === null) {
        if (node.variants.nodes.length !== 1) {
          throw new ProductPublishRejectedException(this.adapterKey(), 422, [
            { code: 'shopify_multi_variant', message: 'The Shopify product has several variants; price one variant, not the product' },
          ]);
        }
        productId = node.id;
        variantId = node.variants.nodes[0].id;
      }
    }
    if (productId === null || variantId === null) {
      throw new ProductPublishTargetNotFoundException(this.adapterKey(), cmd.externalProductId);
    }
    const toStore = await this.priceUpdateConverter(variantId, cmd.price.currency);
    const sale =
      cmd.salePrice && Number(cmd.salePrice.amount) < Number(cmd.price.amount) ? cmd.salePrice : undefined;
    try {
      await this.client.mutate(
        VARIANT_PRICE_UPDATE_MUTATION,
        {
          productId,
          variants: [
            sale
              ? { id: variantId, price: toStore(sale.amount), compareAtPrice: toStore(cmd.price.amount) }
              : { id: variantId, price: toStore(cmd.price.amount) },
          ],
        },
        'productVariantsBulkUpdate',
      );
    } catch (error) {
      throw this.toPublishError(error);
    }
  }

  /**
   * Gross amount -> what the shop stores. Identity on a tax-inclusive shop;
   * on a tax-exclusive one, divided by the variant's own rate as Shopify
   * computes it, refused when that rate is unknown.
   */
  private async priceUpdateConverter(
    variantGid: string,
    currency: string,
  ): Promise<(amount: string) => string> {
    const context = await this.shopContext.get();
    if (context.taxesIncluded) {
      return (amount) => amount;
    }
    const resolution = this.taxRateReader ? await this.taxRateReader.read({ variantId: variantGid }) : null;
    const factor = shopifyGrossFactor(resolution);
    if (factor === null) {
      throw this.refuse(
        'shopify_tax_rate_unknown',
        'The Shopify shop enters prices without tax and its VAT rate for this variant is unknown, so the ' +
          'net price cannot be worked out. Grant the app the write_draft_orders scope, or turn on ' +
          '"All prices include tax" in Shopify.',
      );
    }
    return (amount) => toStoreAmount(Number(amount), factor, currency);
  }

  async publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
    this.assertNotMaster();
    const context = await this.shopContext.get();
    const basis = this.priceBasis(cmd, context);
    this.logger.debug(
      `Publishing variant=${cmd.internalVariantId} connection=${this.connection.id} ` +
        `grouped=${cmd.variantGroup !== undefined} status=${cmd.status}`,
    );
    return cmd.variantGroup === undefined
      ? this.publishSimple(cmd, context.locationGid, basis)
      : this.publishGrouped(cmd, cmd.variantGroup, context.locationGid, basis);
  }

  // ─── Simple product ──────────────────────────────────────────────────────────

  private async publishSimple(
    cmd: PublishProductCommand,
    locationGid: string,
    basis: PriceBasis,
  ): Promise<PublishProductResult> {
    const isUpsert = hasValue(cmd.externalProductId);
    const price = buildPriceFields(cmd, basis.divisor);
    const warnings = [...price.warnings, ...unsupportedFieldWarnings(cmd)];

    let target: PublishedProductNode | null = null;
    if (isUpsert) {
      target = await this.readTarget(String(cmd.externalProductId), locationGid);
      if (target.variants.nodes.length !== 1) {
        throw this.refuse(
          'shopify_not_a_simple_product',
          `Shopify product ${String(cmd.externalProductId)} has ${target.variants.nodes.length} variants, ` +
            'but this publish is for a single-variant product. Publishing it would delete the other variants.',
        );
      }
    } else {
      this.assertTitle(cmd);
    }

    const existing = target?.variants.nodes[0];
    const optionValues: OptionValueRef[] =
      existing !== undefined && existing.selectedOptions.length > 0
        ? existing.selectedOptions.map((o) => ({ optionName: o.name, name: o.value }))
        : [{ optionName: DEFAULT_OPTION_NAME, name: DEFAULT_OPTION_VALUE }];
    const files = this.planFiles(cmd, target, warnings);

    const input = {
      ...buildProductFields(cmd),
      productOptions: optionValues.map((ov) => ({ name: ov.optionName, values: [{ name: ov.name }] })),
      variants: [
        {
          ...(existing === undefined ? {} : { id: existing.id }),
          optionValues,
          ...buildVariantCoreFields(cmd, price.fields, basis.exempt),
          ...(existing === undefined
            ? { inventoryQuantities: [{ locationId: locationGid, name: 'available', quantity: cmd.stock }] }
            : {}),
        },
      ],
    };
    const product = await this.productSet(input, target?.id ?? null, locationGid, files, warnings);

    // The product exists from here on: nothing below may throw.
    const variant = product.variants.nodes[0];
    if (existing !== undefined && variant !== undefined) {
      await this.setStock(variant, locationGid, cmd.stock, warnings);
    }
    await this.finishProduct(product, cmd, warnings);
    if (variant === undefined) {
      warnings.push('Shopify did not report the variant id, so orders for this product cannot be matched yet.');
    }
    return {
      externalProductId: fromShopifyGid(product.id),
      status: statusOf(product.status),
      ...(variant === undefined ? {} : { externalVariantId: fromShopifyGid(variant.id) }),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  // ─── Multi-variant product ───────────────────────────────────────────────────

  private async publishGrouped(
    cmd: PublishProductCommand,
    group: PublishProductVariantGroup,
    locationGid: string,
    basis: PriceBasis,
  ): Promise<PublishProductResult> {
    const price = buildPriceFields(cmd, basis.divisor);
    const warnings = [...price.warnings, ...unsupportedFieldWarnings(cmd)];
    const optionValues = this.groupOptionValues(group);
    const variantCore = buildVariantCoreFields(cmd, price.fields, basis.exempt);

    if (!hasValue(group.externalParentProductId)) {
      return this.createGroupParent(cmd, group, optionValues, variantCore, locationGid, warnings, basis);
    }

    const parentId = String(group.externalParentProductId);
    const target = await this.readTarget(parentId, locationGid);
    const productOptionNames = target.options.map((o) => o.name);
    const ownOptionNames = optionValues.map((o) => o.optionName);
    if (
      productOptionNames.length !== ownOptionNames.length ||
      productOptionNames.some((name) => !ownOptionNames.includes(name))
    ) {
      throw this.refuse(
        'shopify_variant_options_mismatch',
        `Shopify product ${parentId} has the options ${productOptionNames.join(', ')}, but this variant is ` +
          `described by ${ownOptionNames.join(', ')}. Align the variant attributes in the master shop.`,
      );
    }

    let existing: PublishedVariantNode | undefined;
    if (hasValue(cmd.externalProductId)) {
      const variantId = String(cmd.externalProductId);
      existing = target.variants.nodes.find((v) => fromShopifyGid(v.id) === variantId);
      if (existing === undefined) {
        throw new ProductPublishTargetNotFoundException(this.adapterKey(), variantId);
      }
    } else {
      existing = findVariantByOptions(target.variants.nodes, optionValues);
      if (existing !== undefined) {
        this.logger.warn(
          `Adopting Shopify variant ${existing.id} with the same option values for variant ` +
            `${cmd.internalVariantId} (connection ${this.connection.id})`,
        );
      }
    }

    // The parent's shared fields, without `variants`, so every sibling survives,
    // and without `handle`: the group handle is what a later race is settled by.
    const files = this.planFiles(cmd, target, warnings);
    const sharedFields = buildProductFields(cmd);
    delete sharedFields.handle;
    const parent = await this.productSet(sharedFields, target.id, locationGid, files, warnings);

    let variantGid: string;
    if (existing !== undefined) {
      await this.mutateOrReject<VariantsBulkPayload>(
        VARIANTS_BULK_UPDATE_MUTATION,
        { productId: target.id, variants: [{ id: existing.id, optionValues, ...variantCore }] },
        'productVariantsBulkUpdate',
      );
      variantGid = existing.id;
      await this.setStock(existing, locationGid, cmd.stock, warnings);
    } else {
      const created = await this.mutateOrReject<VariantsBulkPayload>(
        VARIANTS_BULK_CREATE_MUTATION,
        {
          productId: target.id,
          variants: [
            {
              optionValues,
              ...variantCore,
              inventoryQuantities: [{ locationId: locationGid, availableQuantity: cmd.stock }],
            },
          ],
        },
        'productVariantsBulkCreate',
      );
      const createdId = created.productVariants?.[0]?.id;
      if (createdId === undefined) {
        // A retry finds the variant by its option values and adopts it, so a refusal here duplicates nothing.
        throw this.refuse(
          'shopify_variant_create_answer_unreadable',
          'Shopify answered the variant create without a variant id. Publish again to link the variant.',
        );
      }
      variantGid = createdId;
    }

    await this.finishProduct(parent, cmd, warnings);
    return {
      externalProductId: fromShopifyGid(variantGid),
      externalParentProductId: fromShopifyGid(parent.id),
      status: statusOf(parent.status),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** The first sibling to publish: the product, its options and this variant, in one `productSet`. */
  private async createGroupParent(
    cmd: PublishProductCommand,
    group: PublishProductVariantGroup,
    optionValues: OptionValueRef[],
    variantCore: Record<string, unknown>,
    locationGid: string,
    warnings: string[],
    basis: PriceBasis,
  ): Promise<PublishProductResult> {
    this.assertTitle(cmd);
    const handle = groupHandle(cmd, group.groupId);
    const files = this.planFiles(cmd, null, warnings);
    const input = {
      ...buildProductFields(cmd),
      handle,
      metafields: [
        {
          namespace: GROUP_MARKER_NAMESPACE,
          key: GROUP_MARKER_KEY,
          type: 'single_line_text_field',
          value: group.groupId,
        },
      ],
      // Only this variant's values are declared; later siblings add their own values.
      productOptions: optionValues.map((ov) => ({ name: ov.optionName, values: [{ name: ov.name }] })),
      variants: [
        {
          optionValues,
          ...variantCore,
          inventoryQuantities: [{ locationId: locationGid, name: 'available', quantity: cmd.stock }],
        },
      ],
    };
    let product: PublishedProductNode;
    try {
      product = await this.productSet(input, null, locationGid, files, warnings);
    } catch (error) {
      // A sibling won the race to the group handle. Shopify REFUSES a duplicate
      // handle set explicitly (HANDLE_NOT_UNIQUE, measured live), it does not
      // suffix it - so the loser joins the product holding the handle instead.
      const owner = isHandleTaken(error) ? await this.groupOwnerOfHandle(handle, group.groupId) : null;
      if (owner === null) {
        throw error;
      }
      this.logger.warn(
        `Variant group ${group.groupId}: handle ${handle} already held by ${owner}; adding variant ` +
          `${cmd.internalVariantId} to it (connection ${this.connection.id})`,
      );
      return this.publishGrouped(
        cmd,
        { ...group, externalParentProductId: fromShopifyGid(owner) },
        locationGid,
        basis,
      );
    }

    // The product exists from here on.
    const variant = findVariantByOptions(product.variants.nodes, optionValues) ?? product.variants.nodes[0];
    if (variant === undefined) {
      // Refused (terminal), not retried: a retry would create a second product.
      throw this.refuse(
        'shopify_product_create_answer_unreadable',
        `Shopify created product ${product.id} but reported no variant. Check the shop before publishing again.`,
      );
    }

    const winnerGid = await this.raceWinner(product.id, handle, group.groupId, warnings);
    if (winnerGid !== null && winnerGid !== product.id) {
      const merged = await this.mergeIntoWinner(
        winnerGid,
        product.id,
        cmd,
        optionValues,
        variantCore,
        locationGid,
        warnings,
      );
      if (merged !== null) {
        return merged;
      }
    }

    await this.finishProduct(product, cmd, warnings);
    return {
      externalProductId: fromShopifyGid(variant.id),
      externalParentProductId: fromShopifyGid(product.id),
      status: statusOf(product.status),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * The product every sibling of the group should use, or null when it cannot
   * be told (the product just created is then kept). Never throws.
   */
  private async raceWinner(
    ownGid: string,
    handle: string,
    groupId: string,
    warnings: string[],
  ): Promise<string | null> {
    const handles = [handle, ...Array.from({ length: GROUP_HANDLE_PROBES - 1 }, (_, i) => `${handle}-${i + 1}`)];
    let candidates: GroupCandidateNode[];
    try {
      const data = await this.client.query<Record<string, GroupCandidateNode | null>>(
        groupCandidatesQuery(handles.length),
        Object.fromEntries(handles.map((h, i) => [`h${i}`, h])),
      );
      candidates = Object.values(data).filter(
        (c): c is GroupCandidateNode => c !== null && c.marker?.value === groupId,
      );
    } catch (error) {
      warnings.push(
        `Could not check for a concurrent publish of the same product (${reasonOf(error)}); ` +
          'if a sibling variant was published at the same moment, Shopify may now hold two products.',
      );
      return null;
    }
    if (!candidates.some((c) => c.id === ownGid)) {
      // More concurrent creates than probed handles, or our own write is not readable yet.
      this.logger.warn(`Variant group ${groupId}: own product ${ownGid} not among the handle probes`);
    }
    const bare = candidates.find((c) => c.handle === handle);
    if (bare !== undefined) {
      return bare.id;
    }
    const byId = [...candidates].sort((a, b) => Number(fromShopifyGid(a.id)) - Number(fromShopifyGid(b.id)));
    return byId[0]?.id ?? null;
  }

  /** The product holding `handle` when it is marked as this group's, else null. Never throws. */
  private async groupOwnerOfHandle(handle: string, groupId: string): Promise<string | null> {
    try {
      const data = await this.client.query<Record<string, GroupCandidateNode | null>>(groupCandidatesQuery(1), {
        h0: handle,
      });
      const node = Object.values(data)[0] ?? null;
      return node !== null && node.marker?.value === groupId ? node.id : null;
    } catch (error) {
      this.logger.warn(`Variant group ${groupId}: could not read the holder of ${handle}: ${reasonOf(error)}`);
      return null;
    }
  }

  /**
   * A losing sibling: this variant onto the winner, then the own duplicate
   * deleted. Null (keep the own product) when the variant could not be moved,
   * so nothing is lost; never throws.
   */
  private async mergeIntoWinner(
    winnerGid: string,
    ownGid: string,
    cmd: PublishProductCommand,
    optionValues: OptionValueRef[],
    variantCore: Record<string, unknown>,
    locationGid: string,
    warnings: string[],
  ): Promise<PublishProductResult | null> {
    let winner: PublishedProductNode;
    let variantGid: string;
    try {
      winner = await this.readTarget(fromShopifyGid(winnerGid), locationGid);
      const existing = findVariantByOptions(winner.variants.nodes, optionValues);
      if (existing !== undefined) {
        variantGid = existing.id;
        await this.setStock(existing, locationGid, cmd.stock, warnings);
      } else {
        const created = await this.client.mutate<VariantsBulkPayload>(
          VARIANTS_BULK_CREATE_MUTATION,
          {
            productId: winnerGid,
            variants: [
              {
                optionValues,
                ...variantCore,
                inventoryQuantities: [{ locationId: locationGid, availableQuantity: cmd.stock }],
              },
            ],
          },
          'productVariantsBulkCreate',
        );
        const createdId = created.productVariants?.[0]?.id;
        if (createdId === undefined) {
          throw new Error('the variant create answered without an id');
        }
        variantGid = createdId;
      }
    } catch (error) {
      warnings.push(
        `A sibling variant created Shopify product ${fromShopifyGid(winnerGid)} at the same moment, and this ` +
          `variant could not be moved onto it (${reasonOf(error)}); it stays on its own product ` +
          `${fromShopifyGid(ownGid)}. Merge the two in Shopify.`,
      );
      return null;
    }

    this.logger.warn(
      `Variant group race on connection ${this.connection.id}: moved variant ${cmd.internalVariantId} ` +
        `from ${ownGid} onto ${winnerGid}`,
    );
    try {
      await this.client.mutate<object>(PRODUCT_DELETE_MUTATION, { input: { id: ownGid } }, 'productDelete');
    } catch (error) {
      warnings.push(
        `The duplicate Shopify product ${fromShopifyGid(ownGid)} left by a concurrent publish could not be ` +
          `deleted (${reasonOf(error)}); delete it in Shopify.`,
      );
    }
    await this.finishProduct(winner, cmd, warnings);
    return {
      externalProductId: fromShopifyGid(variantGid),
      externalParentProductId: fromShopifyGid(winnerGid),
      status: statusOf(winner.status),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /** This variant's value for every option of the group, in the group's option order. */
  private groupOptionValues(group: PublishProductVariantGroup): OptionValueRef[] {
    const declared = Object.keys(group.groupAttributeValues);
    const names = declared.length > 0 ? declared : group.attributes.map((a) => a.name);
    if (names.length === 0) {
      throw this.refuse(
        'shopify_variant_without_options',
        'The variants of this product have no distinguishing attributes, so Shopify cannot tell them apart.',
      );
    }
    if (names.length > MAX_PRODUCT_OPTIONS) {
      throw this.refuse(
        'shopify_too_many_options',
        `Shopify allows ${MAX_PRODUCT_OPTIONS} options per product, but this product varies by ` +
          `${names.length}: ${names.join(', ')}.`,
      );
    }
    return names.map((name) => {
      const value = group.attributes.find((a) => a.name === name)?.value?.trim();
      if (value === undefined || value.length === 0) {
        throw this.refuse(
          'shopify_variant_option_missing',
          `This variant has no value for "${name}", which its sibling variants use. Shopify needs one.`,
        );
      }
      return { optionName: name, name: value };
    });
  }

  // ─── Shared steps ────────────────────────────────────────────────────────────

  private assertNotMaster(): void {
    if (this.connection.enabledCapabilities.includes(PRODUCT_MASTER_CAPABILITY)) {
      throw this.refuse(
        'shopify_publish_on_master_connection',
        'This Shopify connection is also the product master, so every product published to it would be ' +
          'read back as a new master product. Turn off Product master on this connection, or publish ' +
          'to a connection used only for publishing.',
      );
    }
  }

  private priceBasis(cmd: PublishProductCommand, context: ShopifyShopContext): PriceBasis {
    if (cmd.price.currency.toUpperCase() !== context.currencyCode.toUpperCase()) {
      throw this.refuse(
        'shopify_currency_mismatch',
        `The price is in ${cmd.price.currency} but the shop's currency is ${context.currencyCode}; ` +
          'convert the price before publishing.',
      );
    }
    const basis = resolvePublishPriceBasis(context.taxesIncluded, cmd.taxRate);
    if (!basis.ok) {
      throw this.refuse('shopify_tax_rate_required', basis.message);
    }
    return basis;
  }

  // ─── Category browse (collections) ──────────────────────────────────────────

  /**
   * The shop's manual collections, flat. A collection has no parent, so a
   * request for the children of one answers nothing. Smart collections are
   * left out: membership there follows their own rules, and adding a product
   * to one is refused.
   */
  async browseCategories(parentId?: string): Promise<ShopCategory[]> {
    if (parentId !== undefined && parentId.trim().length > 0) {
      return [];
    }
    const categories: ShopCategory[] = [];
    let after: string | null = null;
    for (;;) {
      const data: ManualCollectionsQuery = await this.client.query<ManualCollectionsQuery>(
        MANUAL_COLLECTIONS_QUERY,
        { first: COLLECTIONS_PAGE_SIZE, after },
      );
      for (const node of data.collections.nodes) {
        categories.push({ id: fromShopifyGid(node.id), name: node.title, parentId: null });
      }
      if (data.collections.pageInfo?.hasNextPage !== true || !data.collections.pageInfo.endCursor) {
        return categories;
      }
      after = data.collections.pageInfo.endCursor;
    }
  }

  private assertTitle(cmd: PublishProductCommand): void {
    if ((cmd.content?.title ?? '').trim().length === 0) {
      throw this.refuse('shopify_title_required', 'Shopify needs a product title to create a product.');
    }
  }

  /** The `files` input to send, or null: images go only to a product that has none yet. */
  private planFiles(
    cmd: PublishProductCommand,
    target: PublishedProductNode | null,
    warnings: string[],
  ): Record<string, unknown>[] | null {
    const plan = planImages(cmd);
    warnings.push(...plan.warnings);
    if (plan.urls.length === 0) {
      return null;
    }
    if (target !== null && target.media.nodes.length > 0) {
      warnings.push('The product already has images in Shopify, so they were left as they are.');
      return null;
    }
    return buildFilesInput(plan.urls, cmd.content?.title?.trim());
  }

  /**
   * One `productSet`. User errors mean nothing was written, so a refusal that
   * names the images is retried once without them (the product matters more
   * than its pictures).
   */
  private async productSet(
    input: Record<string, unknown>,
    productGid: string | null,
    locationGid: string,
    files: Record<string, unknown>[] | null,
    warnings: string[],
  ): Promise<PublishedProductNode> {
    const run = (withFiles: boolean): Promise<ProductSetPayload> =>
      this.client.mutate<ProductSetPayload>(
        PRODUCT_SET_MUTATION,
        {
          input: withFiles && files !== null ? { ...input, files } : input,
          identifier: productGid === null ? null : { id: productGid },
          locationId: locationGid,
        },
        'productSet',
      );

    let payload: ProductSetPayload;
    try {
      payload = await run(true);
    } catch (error) {
      if (files === null || !(error instanceof ShopifyUserErrorsException) || !isFilesError(error)) {
        throw this.toPublishError(error);
      }
      warnings.push(`Shopify refused the images (${error.message}), so the product was published without them.`);
      try {
        payload = await run(false);
      } catch (retryError) {
        throw this.toPublishError(retryError);
      }
    }
    if (payload.product === null) {
      throw this.refuse(
        'shopify_product_set_answer_unreadable',
        'Shopify answered the product write without a product. It may have been written: ' +
          'check the shop before publishing again.',
      );
    }
    return payload.product;
  }

  /** Visibility and collections, after the product exists. Never throws. */
  private async finishProduct(
    product: PublishedProductNode,
    cmd: PublishProductCommand,
    warnings: string[],
  ): Promise<void> {
    if (cmd.status === 'published') {
      await this.publishToOnlineStore(product.id, warnings);
    }
    await this.placeInCollections(product, cmd.destinationCategoryIds, warnings);
    await this.writeParameters(product.id, cmd, warnings);
  }

  /** The command's parameters as product metafields. Never throws. */
  private async writeParameters(productGid: string, cmd: PublishProductCommand, warnings: string[]): Promise<void> {
    const parameters = cmd.parameters ?? [];
    if (parameters.length === 0) {
      return;
    }
    let definitions: ReadonlyMap<string, ShopifyMetafieldDefinitionNode> | null = null;
    if (parameters.some((p) => DEFINITION_REF.test(p.id))) {
      try {
        definitions = await this.productMetafieldDefinitions();
      } catch (error) {
        warnings.push(
          `The shop's metafield definitions could not be read (${reasonOf(error)}), ` +
            'so linked parameters were written as OpenLinker text fields.',
        );
      }
    }
    const plan = planMetafields(parameters, definitions);
    warnings.push(...plan.warnings);
    for (let i = 0; i < plan.writes.length; i += METAFIELDS_PER_CALL) {
      const chunk = plan.writes.slice(i, i + METAFIELDS_PER_CALL);
      try {
        await this.setMetafields(productGid, chunk);
      } catch {
        // A refused value fails its whole call; write one by one so the others still land.
        for (const write of chunk) {
          try {
            await this.setMetafields(productGid, [write]);
          } catch (error) {
            warnings.push(`The parameter ${definitionRef(write)} was not written: ${reasonOf(error)}`);
          }
        }
      }
    }
  }

  private setMetafields(productGid: string, writes: readonly MetafieldWrite[]): Promise<object> {
    return this.client.mutate<object>(
      METAFIELDS_SET_MUTATION,
      { metafields: writes.map((w) => ({ ownerId: productGid, ...w })) },
      'metafieldsSet',
    );
  }

  // ─── Attributes (metafield definitions) ──────────────────────────────────────

  /**
   * The shop's product metafield definitions that take text, as global
   * attributes: `id` and `slug` are `namespace.key` (what a publish links by),
   * `name` the definition's name. Reference-typed ones (the taxonomy
   * attributes among them) are left out: a publish could not write them.
   */
  async listAttributes(): Promise<ShopAttribute[]> {
    const definitions = await this.productMetafieldDefinitions();
    return [...definitions.values()]
      .filter((d) => isWritableMetafieldType(d.type.name))
      .map((d) => ({ id: definitionRef(d), name: d.name, slug: definitionRef(d) }));
  }

  /** A definition's predefined values (`choices`); [] for a definition that takes any value. */
  async listAttributeTerms(attributeId: string): Promise<ShopAttributeTerm[]> {
    const definition = (await this.productMetafieldDefinitions()).get(attributeId);
    if (definition === undefined) {
      return [];
    }
    return definitionChoices(definition).map((choice) => ({
      id: choice,
      name: choice,
      slug: toShopifyHandle(choice),
    }));
  }

  private productMetafieldDefinitions(): Promise<Map<string, ShopifyMetafieldDefinitionNode>> {
    if (this.metafieldDefinitions === null) {
      this.metafieldDefinitions = this.readMetafieldDefinitions().catch((error: unknown) => {
        this.metafieldDefinitions = null;
        throw error;
      });
    }
    return this.metafieldDefinitions;
  }

  private async readMetafieldDefinitions(): Promise<Map<string, ShopifyMetafieldDefinitionNode>> {
    const byRef = new Map<string, ShopifyMetafieldDefinitionNode>();
    let after: string | null = null;
    for (;;) {
      const data: MetafieldDefinitionsQuery = await this.client.query(PRODUCT_METAFIELD_DEFINITIONS_QUERY, {
        first: DEFINITIONS_PAGE_SIZE,
        after,
      });
      for (const node of data.metafieldDefinitions.nodes) {
        byRef.set(definitionRef(node), node);
      }
      if (data.metafieldDefinitions.pageInfo?.hasNextPage !== true) {
        return byRef;
      }
      after = data.metafieldDefinitions.pageInfo.endCursor;
    }
  }

  /** Sets `available` at the location to `quantity`, compare-and-set against the level read with the product. */
  private async setStock(
    variant: PublishedVariantNode,
    locationGid: string,
    quantity: number,
    warnings: string[],
  ): Promise<void> {
    const item = variant.inventoryItem;
    if (item === null) {
      warnings.push('Stock was not set: Shopify reported no inventory item for the variant.');
      return;
    }
    if (item.inventoryLevel === null) {
      warnings.push('Stock was not set: the variant is not stocked at the configured Shopify location.');
      return;
    }
    const current = item.inventoryLevel.quantities.find((q) => q.name === 'available')?.quantity ?? null;
    if (current === quantity) {
      return;
    }
    try {
      await this.client.mutate<object>(
        INVENTORY_SET_MUTATION,
        {
          input: {
            name: 'available',
            reason: 'correction',
            quantities: [
              { inventoryItemId: item.id, locationId: locationGid, quantity, changeFromQuantity: current },
            ],
          },
          key: randomUUID(),
        },
        'inventorySetQuantities',
      );
    } catch (error) {
      warnings.push(`Stock was not set to ${quantity}: ${reasonOf(error)}`);
    }
  }

  private async publishToOnlineStore(productGid: string, warnings: string[]): Promise<void> {
    let publicationId: string | null;
    try {
      publicationId = await this.onlineStorePublicationId();
    } catch (error) {
      warnings.push(`The product was not published to the Online Store: ${reasonOf(error)}`);
      return;
    }
    if (publicationId === null) {
      warnings.push('The product was not published to the Online Store: the shop has no Online Store channel.');
      return;
    }
    try {
      await this.client.mutate<PublishablePublishPayload>(
        PUBLISHABLE_PUBLISH_MUTATION,
        { id: productGid, input: [{ publicationId }] },
        'publishablePublish',
      );
    } catch (error) {
      if (error instanceof ShopifyUserErrorsException && error.userErrors.every((e) => /already/i.test(e.message))) {
        return;
      }
      warnings.push(`The product was not published to the Online Store: ${reasonOf(error)}`);
    }
  }

  private onlineStorePublicationId(): Promise<string | null> {
    if (this.onlineStorePublication === null) {
      this.onlineStorePublication = this.client
        .query<PublicationsQuery>(PUBLICATIONS_QUERY)
        .then(({ publications }) => {
          const nodes = publications.nodes;
          const online = nodes.find((p) => (p.catalog?.title ?? '').replace(/\s+/g, '').toLowerCase().endsWith(ONLINE_STORE_PUBLICATION));
          if (online !== undefined) {
            return online.id;
          }
          // A shop with a single channel whose catalog title does not read as the
          // Online Store: used, but named in the log, so a product published to
          // some other channel (POS) is visible rather than silent.
          if (nodes.length === 1) {
            this.logger.warn(
              `No Online Store publication found on connection ${this.connection.id}; using the shop's only ` +
                `publication ${nodes[0].id} (${nodes[0].catalog?.title ?? 'untitled'})`,
            );
            return nodes[0].id;
          }
          return null;
        })
        .catch((error: unknown) => {
          this.onlineStorePublication = null;
          throw error;
        });
    }
    return this.onlineStorePublication;
  }

  /** Adds the product to each destination collection it is not in yet. Never throws. */
  private async placeInCollections(
    product: PublishedProductNode,
    categoryIds: readonly string[],
    warnings: string[],
  ): Promise<void> {
    const member = new Set(product.collections.nodes.map((c) => c.id));
    for (const raw of categoryIds) {
      const id = raw.trim();
      if (!/^\d+$/.test(id) && !id.startsWith('gid://shopify/Collection/')) {
        warnings.push(`The destination category ${raw} is not a Shopify collection id, so it was skipped.`);
        continue;
      }
      const collectionGid = toShopifyGid('Collection', id);
      if (member.has(collectionGid)) {
        continue;
      }
      try {
        await this.client.mutate<object>(
          COLLECTION_ADD_PRODUCTS_MUTATION,
          { id: collectionGid, productIds: [product.id] },
          'collectionAddProductsV2',
        );
      } catch (error) {
        warnings.push(`The product was not added to collection ${id}: ${reasonOf(error)}`);
      }
    }
  }

  /** The mapped product, or the stale-mapping signal core repairs by re-creating. Read before any write. */
  private async readTarget(externalProductId: string, locationGid: string): Promise<PublishedProductNode> {
    const { product } = await this.client.query<PublishTargetQuery>(PUBLISH_TARGET_QUERY, {
      id: toShopifyGid('Product', externalProductId),
      locationId: locationGid,
    });
    if (product === null) {
      throw new ProductPublishTargetNotFoundException(this.adapterKey(), externalProductId);
    }
    return product;
  }

  private async mutateOrReject<P extends object>(
    document: string,
    variables: Record<string, unknown>,
    payloadField: string,
  ): Promise<P> {
    try {
      return await this.client.mutate<P>(document, variables, payloadField);
    } catch (error) {
      throw this.toPublishError(error);
    }
  }

  // ─── Category provisioning (collections) ────────────────────────────────────

  /**
   * The collection for a category path. Shopify collections are flat, so the
   * whole path names one collection: its handle is derived from every name on
   * the path (so "Men > Shoes" and "Women > Shoes" stay apart), its title is
   * the leaf name. Looked up by handle, a direct read that sees a collection
   * created a moment ago, then created when absent. Throwing is safe here: the
   * retry finds a collection this call created.
   */
  async provisionCategory(cmd: ProvisionCategoryCommand): Promise<ProvisionCategoryResult> {
    const names = cmd.path.map((node) => node.name.trim());
    const leaf = cmd.path[cmd.path.length - 1];
    if (leaf === undefined || names.some((name) => name.length === 0)) {
      throw this.refuse('shopify_category_path_invalid', 'There is no complete category path to create on Shopify.');
    }
    const derived = toShopifyHandle(names.join(' '));
    const handle = derived.length > 0 ? derived : `ol-category-${toShopifyHandle(leaf.sourceCategoryId)}`;

    const existing = await this.findCollectionByHandle(handle);
    if (existing !== null) {
      return { destinationCategoryId: fromShopifyGid(existing) };
    }

    const title = names[names.length - 1];
    const { collection } = await this.client.mutate<CollectionCreatePayload>(
      COLLECTION_CREATE_MUTATION,
      { input: { title, handle } },
      'collectionCreate',
    );
    if (collection === null) {
      throw this.refuse(
        'shopify_collection_create_answer_unreadable',
        'Shopify answered a collection create without a collection. Publish again to resolve it.',
      );
    }
    let collectionGid = collection.id;
    if (collection.handle !== handle) {
      // Shopify suffixes a taken handle: another publish created the collection first.
      const winner = await this.findCollectionByHandle(handle);
      if (winner !== null) {
        this.logger.warn(
          `Shopify collection "${handle}" was created concurrently (connection ${this.connection.id}); ` +
            `using ${winner}, ${collection.id} is an unused duplicate`,
        );
        collectionGid = winner;
      }
    }
    if (collectionGid === collection.id) {
      // Best effort: a collection that is not on the Online Store still holds its products.
      const warnings: string[] = [];
      await this.publishToOnlineStore(collectionGid, warnings);
      for (const warning of warnings) {
        this.logger.warn(`Shopify collection ${collectionGid}: ${warning}`);
      }
    }
    const id = fromShopifyGid(collectionGid);
    return { destinationCategoryId: id, ...(collectionGid === collection.id ? { createdPath: [id] } : {}) };
  }

  private async findCollectionByHandle(handle: string): Promise<string | null> {
    const { collectionByIdentifier } = await this.client.query<CollectionByHandleQuery>(
      COLLECTION_BY_HANDLE_QUERY,
      { handle },
    );
    return collectionByIdentifier?.id ?? null;
  }

  // ─── Errors ──────────────────────────────────────────────────────────────────

  /**
   * A mutation with user errors wrote nothing: that is the shop refusing the
   * payload, a terminal rejection. The dev-store "too many attempts" user error
   * clears by itself and propagates for the retry classifier; so do transport,
   * throttle and auth failures.
   */
  private toPublishError(error: unknown): unknown {
    if (error instanceof ShopifyUserErrorsException && !error.isRateLimited()) {
      return new ProductPublishRejectedException(
        this.adapterKey(),
        422,
        error.userErrors.map((e) => ({
          code: e.code ?? 'shopify_rejected',
          message: `${e.message}${e.field ? ` (${e.field.join('.')})` : ''}`,
        })),
      );
    }
    return error;
  }

  private refuse(code: string, message: string): ProductPublishRejectedException {
    return new ProductPublishRejectedException(this.adapterKey(), 0, [{ code, message }]);
  }

  private adapterKey(): string {
    return this.connection.adapterKey ?? SHOPIFY_ADAPTER_KEY;
  }
}

/** Whether a publish failed because the explicit handle is already in use. */
function isHandleTaken(error: unknown): boolean {
  return (
    error instanceof ProductPublishRejectedException &&
    error.errors.some((e) => e.code === 'HANDLE_NOT_UNIQUE' || /handle .* already in use/i.test(e.message))
  );
}
