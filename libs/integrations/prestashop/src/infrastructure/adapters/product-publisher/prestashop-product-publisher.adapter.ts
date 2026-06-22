/**
 * PrestaShop Product Publisher Adapter (#1107)
 *
 * Implements `ShopProductManagerPort` (capability `'ProductPublisher'`) plus the
 * `CategoryProvisioner` sub-capability against the PrestaShop WebService XML API.
 * Pure transport: the core `ProductPublishExecutionService` owns identifier mapping
 * and record lifecycle — this adapter shapes the neutral `PublishProductCommand`
 * onto PrestaShop's `products` / `categories` / `stock_availables` resources and
 * maps failures back to the neutral `ProductPublishRejectedException`.
 *
 * Publish model (ADR-024 §1/§3): each OL variant publishes as its own simple
 * product (create on first publish, upsert via `externalProductId` thereafter).
 * Stock is set via the auto-created `stock_availables` row after create/upsert —
 * PS WS does not accept `quantity` inline on the product body.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/product-publisher
 */
import { Logger } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ProductPublishRejectedException,
  type CategoryProvisioner,
  type ProvisionCategoryCommand,
  type ProvisionCategoryResult,
  type PublishProductCommand,
  type PublishProductResult,
  type PublishProductStatus,
  type ShopProductManagerPort,
} from '@openlinker/core/listings';
import { PrestashopApiException } from '@openlinker/integrations-prestashop';

import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type {
  PrestashopCategoryListItem,
  PrestashopCategoryResponse,
  PrestashopLangField,
  PrestashopProductResponse,
  PrestashopProductWriteBody,
  PrestashopStockAvailableItem,
} from './prestashop-product-publish.types';

const DEFAULT_ADAPTER_KEY = 'prestashop.webservice.v1';

function langField(value: string, languageId = '1'): PrestashopLangField {
  return { language: [{ '@_id': languageId, '#text': value }] };
}

export class PrestashopProductPublisherAdapter
  implements ShopProductManagerPort, CategoryProvisioner
{
  private readonly logger = new Logger(PrestashopProductPublisherAdapter.name);

  constructor(
    private readonly client: IPrestashopWebserviceClient,
    private readonly connection: Connection,
  ) {}

  async publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
    const languageId = String(
      cmd.platformParams?.languageId ?? (this.connection.config?.langId as number | undefined) ?? 1,
    );

    // Collect v1 deferral warnings before the API call so the caller knows what was skipped.
    const warnings: string[] = [];

    // v1 deferral: PS WS images require binary multipart upload to
    // /images/products/{id} — unlike WooCommerce's URL reference model, each
    // image needs a separate POST with raw bytes. Not yet implemented; the
    // operator is warned so products are not silently image-less.
    if (cmd.content?.imageUrls != null && cmd.content.imageUrls.length > 0) {
      warnings.push(
        'imageUrls: image upload is not yet supported for PrestaShop in this adapter version — ' +
          'images skipped. PrestaShop WebService images require binary multipart upload to /images/products/{id}.',
      );
    }

    // v1 deferral: PrestaShop parameters would map to product Features + FeatureValues
    // (separate PS WS resources requiring multi-step provisioning). Not yet
    // implemented; the operator is warned so attributes are not silently dropped.
    if (cmd.parameters != null && cmd.parameters.length > 0) {
      warnings.push(
        'parameters: category/attribute parameters are not yet supported for PrestaShop in this ' +
          'adapter version — parameters skipped. PrestaShop features require separate ' +
          'feature + feature_value resources.',
      );
    }

    const body = this.buildProductBody(cmd, languageId);
    const isUpsert = cmd.externalProductId != null && cmd.externalProductId !== '';

    this.logger.debug(
      `Publishing variant=${cmd.internalVariantId} connection=${this.connection.id} ` +
        `mode=${isUpsert ? 'upsert' : 'create'} status=${cmd.status}`,
    );

    let response: PrestashopProductResponse;
    try {
      if (isUpsert) {
        response = await this.client.updateResource<PrestashopProductResponse>(
          'products',
          String(cmd.externalProductId),
          { id: String(cmd.externalProductId), ...body },
        );
      } else {
        response = await this.client.createResource<PrestashopProductResponse>('products', body);
      }
    } catch (err) {
      throw this.toPublishError(err);
    }

    const productId = String(response.id);
    await this.updateStock(productId, cmd.stock);

    // Derive the observed status from response.active (the contract says
    // PublishProductResult.status is the state observed after the call, not the
    // requested state — PS always echoes back what it persisted).
    const status: PublishProductStatus = String(response.active) === '1' ? 'published' : 'draft';
    return {
      externalProductId: productId,
      status,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  async provisionCategory(cmd: ProvisionCategoryCommand): Promise<ProvisionCategoryResult> {
    const languageId = String(
      (this.connection.config?.langId as number | undefined) ?? 1,
    );
    // PS category tree: id 1 = Root (hidden), id 2 = Home (first visible level).
    // Creating under id_parent='0' is not a valid PS parent and may be rejected or
    // land outside the visible tree. Default to Home (2); operators with a custom
    // root can set connection.config.rootCategoryId to override.
    let parentId = String(
      (this.connection.config?.rootCategoryId as number | string | undefined) ?? 2,
    );
    const createdPath: string[] = [];

    for (const node of cmd.path) {
      const rows = await this.client.listResources<PrestashopCategoryListItem>('categories', {
        custom: { 'filter[name]': node.name, 'filter[id_parent]': parentId },
      });

      const match = rows.find((row) => this.extractLangText(row.name, languageId) === node.name);

      if (match) {
        parentId = String(match.id);
        continue;
      }

      const created = await this.client.createResource<PrestashopCategoryResponse>('categories', {
        name: langField(node.name, languageId),
        id_parent: parentId,
        link_rewrite: langField(this.slugify(node.name), languageId),
        active: '1',
      });

      parentId = String(created.id);
      createdPath.push(parentId);
    }

    return {
      destinationCategoryId: parentId,
      ...(createdPath.length > 0 ? { createdPath } : {}),
    };
  }

  private buildProductBody(
    cmd: PublishProductCommand,
    languageId: string,
  ): PrestashopProductWriteBody {
    const title = cmd.content?.title ?? '';
    const slug = (cmd.content?.seo?.slug ?? this.slugify(title)) || 'product';

    const body: PrestashopProductWriteBody = {
      ...(cmd.platformParams ?? {}),
      name: langField(title, languageId),
      link_rewrite: langField(slug, languageId),
      price: cmd.price.amount.toFixed(2),
      active: cmd.status === 'published' ? '1' : '0',
      // Fall back to PS Home category (id 2) when no category is provided — '0' is
      // not a valid PS parent and may be rejected. Home is the first visible level
      // in the PS category tree; operators can override via connection.config.rootCategoryId.
      id_category_default:
        cmd.destinationCategoryIds[0] ??
        String((this.connection.config?.rootCategoryId as number | string | undefined) ?? 2),
    };

    if (cmd.content?.description != null) {
      body.description = langField(cmd.content.description, languageId);
    }

    if (cmd.destinationCategoryIds.length > 0) {
      body.associations = {
        categories: {
          category: cmd.destinationCategoryIds.map((id) => ({ id: String(id) })),
        },
      };
    }

    if (cmd.content?.seo?.title != null) {
      body.meta_title = langField(cmd.content.seo.title, languageId);
    }
    if (cmd.content?.seo?.description != null) {
      body.meta_description = langField(cmd.content.seo.description, languageId);
    }

    return body;
  }

  private async updateStock(productId: string, quantity: number): Promise<void> {
    // Fully best-effort: PS creates the product before returning, so if any step here
    // throws the core service won't persist the identifier mapping and the retry will
    // call createResource again — producing a duplicate orphaned PS product. An unset
    // stock heals on the next inventory sync; a duplicate product has no auto-recovery.
    try {
      const rows = await this.client.listResources<PrestashopStockAvailableItem>('stock_availables', {
        custom: { 'filter[id_product]': productId },
      });

      const row = rows[0];
      if (!row) {
        this.logger.warn(
          `No stock_available row found for product ${productId} on connection ${this.connection.id} — stock not updated.`,
        );
        return;
      }

      const saId = String(row.id);
      await this.client.updateResource('stock_availables', saId, {
        id: saId,
        id_product: productId,
        quantity: String(quantity),
      });
    } catch (err) {
      this.logger.warn(
        `Stock update failed for product ${productId} on connection ${this.connection.id} — left unset. Will self-heal on next inventory sync.`,
        (err as Error).stack,
      );
    }
  }

  private toPublishError(error: unknown): unknown {
    if (
      error instanceof PrestashopApiException &&
      error.statusCode != null &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      const adapterKey = this.connection.adapterKey ?? DEFAULT_ADAPTER_KEY;
      return new ProductPublishRejectedException(adapterKey, error.statusCode, [
        { code: String(error.statusCode), message: error.message },
      ]);
    }
    return error;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private extractLangText(value: string | PrestashopLangField, languageId: string): string {
    if (typeof value === 'string') return value;
    return (
      value.language.find((l) => l['@_id'] === languageId)?.['#text'] ??
      value.language[0]?.['#text'] ??
      ''
    );
  }
}
