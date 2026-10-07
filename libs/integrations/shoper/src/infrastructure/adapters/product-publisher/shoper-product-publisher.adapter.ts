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
  type DescriptionFormat,
  type PublishProductCommand,
  type PublishProductResult,
  type ShopProductManagerPort,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import type { ShoperImageWriteBody } from '../../../domain/types/shoper-product-write.types';
import { SHOPER_ADAPTER_KEY } from '../../../shoper.constants';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import {
  buildShoperProductBody,
  parseShoperCategoryIds,
  planShoperImageUploads,
} from '../../mappers/shoper-product-write.mapper';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';
import { SHOPER_DESCRIPTION_FORMAT } from './shoper-description-format';

const PRODUCTS_PATH = '/products';

const IMAGES_PATH = '/product-images';

/** A short, token-free reason for a warning. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ShoperProductPublisherAdapter implements ShopProductManagerPort {
  private readonly logger = new Logger(ShoperProductPublisherAdapter.name);

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly connection: Connection,
  ) {}

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
   * images keeps them. Every failure is a warning, never an error (see the call).
   */
  private async publishImages(
    externalProductId: string,
    cmd: PublishProductCommand,
    isUpsert: boolean,
  ): Promise<string[]> {
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
      warnings.push(`Product images were not sent: the shop's current images could not be read (${describe(error)}).`);
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
        warnings.push(`Shoper did not take the image ${url}: ${describe(error)}`);
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

  private async create(body: unknown): Promise<string> {
    try {
      const { data } = await this.client.post<unknown>(PRODUCTS_PATH, body);
      const id = String(data);
      if (!/^\d+$/.test(id)) {
        throw new ShoperNetworkError('Shoper answered a product create without a product id');
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
