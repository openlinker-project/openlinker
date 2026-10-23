/**
 * Shoper Product Publisher Adapter (#3712)
 *
 * Implements `ShopProductManagerPort` (registry capability `ProductPublisher`):
 * creates a product on a Shoper shop, or updates the one already mapped, so a
 * re-publish never duplicates it.
 *
 *   - create: `POST /products`, which answers the bare product id;
 *   - update: `PUT /products/:id` with a partial body (the id comes from the
 *     `ShopProduct` mapping `ProductPublishExecutionService` resolved first).
 *
 * Verified live against a Shoper shop (see
 * `docs/plans/implementation-plan-shoper-product-publisher.md`).
 *
 * Refusals are explicit and actionable rather than defaulted:
 *   - a multi-variant product is refused. Shoper models variants as extra
 *     `product-stocks` rows keyed by option ids that must already exist in the
 *     shop, and creating them was not verified;
 *   - a create with no category is refused, because Shoper requires `category_id`
 *     (category provisioning is a separate capability);
 *   - a create with no title is refused;
 *   - whatever Shoper itself rejects (duplicate code, invalid EAN, unknown
 *     category) is surfaced with the shop's own words.
 *
 * It also implements `CategoryProvisioner` (#3713): the category path of the
 * master product is mirrored onto the shop, creating whatever is missing. Shoper
 * accepts a duplicate name under one parent and an unknown parent id, so the
 * lookup before every create is the whole of the idempotency, and after a create
 * the directory is read again so two publishes that raced settle on the same
 * (lowest-id) node.
 *
 * It also implements `ShopCategoryBrowser`, so the shop's existing tree reaches
 * the destination taxonomy projection the publish category picker reads (#1979,
 * #2085). The sync job browses one parent at a time against ONE adapter
 * instance, while Shoper can only answer the whole directory (tree + every page
 * of names), so the joined directory is read once per instance and every browse
 * is a filter over it. A category this instance provisions drops that memo, so a
 * later browse never hides what was just created.
 *
 * And `ShopProductStatusReader` (#1845): the live visibility of a published
 * product, read as the inverse of how `publishProduct` writes it.
 *
 * And `ShopAttributeReader` (#1835): the shop's attributes and the predefined
 * values of a select attribute, for the attribute picker. Read only for now:
 * a publish does not send `parameters` yet (they come back as a warning).
 *
 * Fields the command carries but this adapter does not publish come back as
 * `warnings`. Transient failures (429, 408, 5xx, network) propagate untouched so
 * the worker retries the job.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/product-publisher
 * @implements {ShopProductManagerPort}
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  SHOP_PUBLICATION_STATUS,
  type CategoryProvisioner,
  type DescriptionFormat,
  type ProvisionCategoryCommand,
  type ProvisionCategoryResult,
  type PublishProductCommand,
  type PublishProductResult,
  type ShopAttribute,
  type ShopAttributeReader,
  type ShopAttributeTerm,
  type ShopCategory,
  type ShopCategoryBrowser,
  type ShopProductManagerPort,
  type ShopProductStatusReadResult,
  type ShopProductStatusReader,
} from '@openlinker/core/listings';
import type { Category } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import type { ShoperAttribute, ShoperProduct } from '../../../domain/types/shoper-api.types';
import type {
  ShoperCategoryWriteBody,
  ShoperImageWriteBody,
} from '../../../domain/types/shoper-product-write.types';
import { SHOPER_ADAPTER_KEY } from '../../../shoper.constants';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { fetchAllShoperPages } from '../../http/shoper-pagination';
import { mapShoperAttributeTerms, mapShoperAttributes } from '../../mappers/shoper-attribute.mapper';
import {
  findShoperCategoryChild,
  joinShoperCategories,
  selectShoperCategoryChildren,
} from '../../mappers/shoper-category.mapper';
import { mapShoperProductPublicationStatus } from '../../mappers/shoper-product-status.mapper';
import { ShoperCategoryReader } from '../../readers/shoper-category.reader';
import {
  buildShoperProductBody,
  parseShoperCategoryIds,
  planShoperImageUploads,
} from '../../mappers/shoper-product-write.mapper';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';
import { SHOPER_DESCRIPTION_FORMAT } from './shoper-description-format';

const PRODUCTS_PATH = '/products';

const CATEGORIES_PATH = '/categories';
const IMAGES_PATH = '/product-images';
const ATTRIBUTES_PATH = '/attributes';

/** A short, token-free reason for a warning. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ShoperProductPublisherAdapter
  implements
    ShopProductManagerPort,
    CategoryProvisioner,
    ShopCategoryBrowser,
    ShopProductStatusReader,
    ShopAttributeReader
{
  private readonly logger = new Logger(ShoperProductPublisherAdapter.name);
  private readonly categoryReader: ShoperCategoryReader;
  /**
   * The joined directory `browseCategories` filters, memoised as a PROMISE so
   * concurrent browses share one read. A failure is dropped from the memo, so
   * the next browse retries instead of replaying the rejection.
   */
  private browseDirectory: Promise<Category[]> | null = null;

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly connection: Connection,
  ) {
    this.categoryReader = new ShoperCategoryReader(client);
  }

  getDescriptionFormat(): DescriptionFormat {
    return SHOPER_DESCRIPTION_FORMAT;
  }

  async publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
    if (cmd.variantGroup !== undefined) {
      throw this.refuse(
        'shoper_variants_unsupported',
        'Publishing a product with several variants to Shoper is not supported yet: Shoper ' +
          'variants need option values that already exist in the shop. Publish a single-variant product.',
      );
    }

    const isUpsert = cmd.externalProductId != null && cmd.externalProductId !== '';
    this.assertCategories(cmd, isUpsert);
    if (!isUpsert && (cmd.content?.title ?? '').trim().length === 0) {
      throw this.refuse('shoper_name_required', 'Shoper needs a product name to create a product.');
    }

    const context = await this.shopContext.get();
    if (context.language.length === 0) {
      throw this.refuse(
        'shoper_language_unknown',
        "The shop did not report a default language, so the product's texts cannot be addressed.",
      );
    }

    if (context.currency !== null && cmd.price.currency.toUpperCase() !== context.currency.toUpperCase()) {
      // Writing the amount as is would put a wrong price on the storefront, so refuse.
      throw this.refuse(
        'shoper_currency_mismatch',
        `The price is in ${cmd.price.currency} but the shop's currency is ${context.currency}; ` +
          'convert the price before publishing.',
      );
    }

    const { body, warnings } = buildShoperProductBody(cmd, context);
    this.logger.debug(
      `Publishing variant=${cmd.internalVariantId} connection=${this.connection.id} ` +
        `mode=${isUpsert ? 'upsert' : 'create'} status=${cmd.status}`,
    );

    const externalProductId = isUpsert
      ? await this.update(String(cmd.externalProductId), body)
      : await this.create(body);

    // After the product exists, and never allowed to throw: the caller persists the
    // product mapping only once this method returns, so a failure here would make
    // the job retry into a SECOND product.
    warnings.push(...(await this.publishImages(externalProductId, cmd, isUpsert)));

    return {
      externalProductId,
      status: cmd.status,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * Sends the command's images, in order, after the product exists. Shoper fetches
   * each from its URL; the first becomes the main image.
   *
   * Images are only added to a product that has none: a re-publish would
   * otherwise append the same pictures again, and Shoper offers no way to tell
   * which of its images came from which URL. A product that already carries
   * images keeps them. Known limit: if an earlier publish uploaded only some of the
   * images (the first succeeded, a later one failed), the product now has a main
   * image and the missing ones are NOT added on a re-publish. Every failure is a
   * warning, never an error (see the call).
   */
  private async publishImages(
    externalProductId: string,
    cmd: PublishProductCommand,
    isUpsert: boolean,
  ): Promise<string[]> {
    if (!/^\d+$/.test(externalProductId)) {
      return ['Product images were not sent: the product id is not a Shoper id.'];
    }
    const plan = planShoperImageUploads(cmd);
    const warnings = [...plan.skipped];
    if (plan.urls.length === 0) {
      return warnings;
    }

    try {
      if (isUpsert && (await this.hasImages(externalProductId))) {
        warnings.push('The product already has images in Shoper, so they were left as they are.');
        return warnings;
      }
    } catch (error) {
      warnings.push(`Product images were not sent: the shop's current images could not be read (${reasonOf(error)}).`);
      return warnings;
    }

    const alt = cmd.content?.title?.trim();
    for (const url of plan.urls) {
      const body: ShoperImageWriteBody = {
        product_id: Number(externalProductId),
        url,
        ...(alt !== undefined && alt.length > 0 ? { name: alt } : {}),
      };
      try {
        await this.client.post<unknown>(IMAGES_PATH, body);
      } catch (error) {
        warnings.push(`Shoper did not take the image ${url}: ${reasonOf(error)}`);
      }
    }
    return warnings;
  }

  /** Whether Shoper already holds an image for the product; `main_image` is `null` when it holds none. */
  private async hasImages(externalProductId: string): Promise<boolean> {
    const { data } = await this.client.get<{ main_image?: unknown }>(
      `${PRODUCTS_PATH}/${encodeURIComponent(externalProductId)}`,
    );
    return data.main_image !== null && data.main_image !== undefined;
  }

  /**
   * The live visibility of a product this connection published, for the
   * steady-state shop-status reconcile (#1845). The mapping is the inverse of
   * the write (`mapShoperProductPublicationStatus`). Only Shoper's own "no such
   * resource" 404 reads as `removed`: a bare 404 from something in front of the
   * shop must never stale a listing. Every other failure propagates so the job
   * retries, and so does an answer that carries no readable visibility, which
   * is not guessed into either state.
   *
   * No `getShopVariationStatus`: this publisher refuses multi-variant products,
   * so no record it wrote points at a variant row.
   */
  async getShopProductStatus(externalProductId: string): Promise<ShopProductStatusReadResult> {
    // An empty body is possible on a misbehaving answer; it reads as unreadable below.
    let product: Pick<ShoperProduct, 'translations'> | null;
    try {
      ({ data: product } = await this.client.get<Pick<ShoperProduct, 'translations'> | null>(
        `${PRODUCTS_PATH}/${encodeURIComponent(externalProductId)}`,
      ));
    } catch (error) {
      if (error instanceof ShoperApiError && error.isResourceNotFound()) {
        return { publicationStatus: SHOP_PUBLICATION_STATUS.Removed };
      }
      throw error;
    }

    const { language } = await this.shopContext.get();
    const publicationStatus = mapShoperProductPublicationStatus(product?.translations, language);
    if (publicationStatus === null) {
      throw new ShoperNetworkError(
        `Shoper product ${externalProductId} reports no readable visibility for language ` +
          `"${language}" (connection ${this.connection.id})`,
      );
    }
    return { publicationStatus };
  }

  /**
   * The shop's product attributes, for the structured attribute picker (#1835).
   * See `shoper-attribute.mapper.ts` for how Shoper's attribute model maps onto
   * the neutral one. Read only: this publisher does not yet send `parameters`,
   * so a picked attribute is not linked on publish.
   */
  async listAttributes(): Promise<ShopAttribute[]> {
    const rows = await fetchAllShoperPages<ShoperAttribute>(this.client, ATTRIBUTES_PATH, {
      order: 'attribute_id ASC',
    });
    return mapShoperAttributes(rows);
  }

  /**
   * The predefined values of one attribute. They are embedded in the attribute
   * itself, so this is one `GET /attributes/:id`. A text-field or checkbox
   * attribute has none. A failure (an unknown id included) propagates.
   */
  async listAttributeTerms(attributeId: string): Promise<ShopAttributeTerm[]> {
    const { data } = await this.client.get<ShoperAttribute | null>(
      `${ATTRIBUTES_PATH}/${encodeURIComponent(attributeId)}`,
    );
    return mapShoperAttributeTerms(data);
  }

  async provisionCategory(cmd: ProvisionCategoryCommand): Promise<ProvisionCategoryResult> {
    if (cmd.path.length === 0) {
      throw this.refuse('shoper_category_path_empty', 'There is no category path to create on Shoper.');
    }
    const { language } = await this.shopContext.get();
    if (language.length === 0) {
      throw this.refuse(
        'shoper_language_unknown',
        'The shop did not report a default language, so a category name cannot be addressed.',
      );
    }

    // Every name is checked before anything is created: a path refused halfway
    // would leave its first nodes behind in the shop.
    const names = cmd.path.map((node) => node.name.trim());
    if (names.some((name) => name.length === 0)) {
      throw this.refuse('shoper_category_name_required', 'A category on the path has no name.');
    }

    let directory = await this.readCategories(language);
    let parentId: string | null = null;
    const createdPath: string[] = [];

    for (const name of names) {
      let id = findShoperCategoryChild(directory, parentId, name);
      if (id === null) {
        const createdId = await this.createCategory(parentId, name, language);
        // Shoper does not refuse a duplicate name, so a publish racing this one may
        // have created the same node. Looking again and taking the lowest id makes
        // both settle on one; the loser's empty twin is left for the operator.
        directory = await this.readCategories(language);
        id = findShoperCategoryChild(directory, parentId, name) ?? createdId;
        if (id === createdId) {
          createdPath.push(createdId);
        } else {
          this.logger.warn(
            `Shoper category "${name}" was created concurrently (connection ${this.connection.id}); ` +
              `using ${id}, ${createdId} is an unused duplicate`,
          );
        }
      }
      parentId = id;
    }

    if (parentId === null) {
      throw this.refuse('shoper_category_path_empty', 'There is no category path to create on Shoper.');
    }
    return {
      destinationCategoryId: parentId,
      ...(createdPath.length > 0 ? { createdPath } : {}),
    };
  }

  /**
   * The shop's categories directly under `parentId` (omitted = the root level).
   * Every Shoper category is a valid placement, so there is no leaf flag.
   *
   * Names are read in the shop's default language, the one the publisher writes
   * category names in; a category with no name there falls back to any language
   * that has one (`joinShoperCategories`). Unlike provisioning, an unreported
   * default language is not refused: a read invents nothing, and the fallback
   * still names every category truthfully.
   */
  async browseCategories(parentId?: string): Promise<ShopCategory[]> {
    return selectShoperCategoryChildren(await this.loadBrowseDirectory(), parentId);
  }

  private loadBrowseDirectory(): Promise<Category[]> {
    if (this.browseDirectory === null) {
      this.browseDirectory = this.shopContext
        .get()
        .then(({ language }) => this.readCategories(language))
        .catch((error: unknown) => {
          this.browseDirectory = null;
          throw error;
        });
    }
    return this.browseDirectory;
  }

  private async readCategories(language: string): Promise<Category[]> {
    const raw = await this.categoryReader.read();
    return joinShoperCategories(raw.list, raw.tree, language).categories;
  }

  private async createCategory(parentId: string | null, name: string, language: string): Promise<string> {
    const body: ShoperCategoryWriteBody = {
      parent_id: parentId === null ? 0 : Number(parentId),
      translations: { [language]: { name, active: 1 } },
    };
    const { data } = await this.client.post<unknown>(CATEGORIES_PATH, body);
    // Dropped even when the answer below is unreadable: the category may exist now.
    this.browseDirectory = null;
    const id = String(data);
    if (!/^\d+$/.test(id)) {
      // Refused, not retried as a network fault: the answer was readable, just not an id.
      // A later publish is still safe, because the lookup before every create finds
      // the category if Shoper did create it.
      throw this.refuse(
        'shoper_category_create_answer_unreadable',
        'Shoper answered a category create without a category id. The category may have been created; publish again.',
      );
    }
    return id;
  }

  private async create(body: unknown): Promise<string> {
    try {
      const { data } = await this.client.post<unknown>(PRODUCTS_PATH, body);
      const id = String(data);
      if (!/^\d+$/.test(id)) {
        // The product may already exist, so a retry would create a second one: refuse
        // (terminal) and let the operator check the shop.
        throw this.refuse(
          'shoper_create_answer_unreadable',
          'Shoper answered a product create without a product id. The product may have been created: ' +
            'check the shop before publishing again.',
        );
      }
      return id;
    } catch (error) {
      throw this.toPublishError(error, null);
    }
  }

  private async update(externalProductId: string, body: unknown): Promise<string> {
    try {
      await this.client.put(`${PRODUCTS_PATH}/${encodeURIComponent(externalProductId)}`, body);
      return externalProductId;
    } catch (error) {
      throw this.toPublishError(error, externalProductId);
    }
  }

  private assertCategories(cmd: PublishProductCommand, isUpsert: boolean): void {
    if (cmd.destinationCategoryIds.length === 0) {
      if (!isUpsert) {
        throw this.refuse(
          'shoper_category_required',
          'Shoper needs a category to create a product. Choose a destination category for this publish.',
        );
      }
      return;
    }
    if (parseShoperCategoryIds(cmd.destinationCategoryIds) === null) {
      throw this.refuse(
        'shoper_category_invalid',
        'The destination category is not a Shoper category id: ' +
          `${cmd.destinationCategoryIds.join(', ')}.`,
      );
    }
  }

  private refuse(code: string, message: string): ProductPublishRejectedException {
    return new ProductPublishRejectedException(this.adapterKey(), 0, [{ code, message }]);
  }

  /**
   * An upsert onto a product Shoper says is gone is a stale mapping, which core
   * repairs by recreating; any other 4xx is the shop refusing the payload. The
   * transient ones (408, 429) and everything that is not a Shoper answer
   * propagate so the job retries.
   */
  private toPublishError(error: unknown, externalProductId: string | null): unknown {
    if (!(error instanceof ShoperApiError)) {
      return error;
    }
    if (externalProductId !== null && error.isResourceNotFound()) {
      return new ProductPublishTargetNotFoundException(this.adapterKey(), externalProductId);
    }
    if (error.isAuthRejection() || error.statusCode === 408 || error.statusCode === 429) {
      return error;
    }
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return new ProductPublishRejectedException(this.adapterKey(), error.statusCode, [
        { code: error.errorCode ?? 'shoper_rejected', message: error.message },
      ]);
    }
    return error;
  }

  private adapterKey(): string {
    return this.connection.adapterKey ?? SHOPER_ADAPTER_KEY;
  }
}
