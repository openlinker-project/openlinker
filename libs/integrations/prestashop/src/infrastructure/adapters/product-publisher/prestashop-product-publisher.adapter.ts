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
  type OfferParameter,
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
  PrestashopFeatureAssociation,
  PrestashopFeatureListItem,
  PrestashopFeatureResponse,
  PrestashopFeatureValueListItem,
  PrestashopFeatureValueResponse,
  PrestashopLangField,
  PrestashopProductListItem,
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

    // Provision features hard-fail: associations are structural — a product without
    // its declared features is semantically incomplete, unlike a missing image.
    const featureAssociations =
      cmd.parameters != null && cmd.parameters.length > 0
        ? await this.provisionFeatures(cmd.parameters, languageId)
        : [];

    const body = this.buildProductBody(cmd, languageId, featureAssociations);
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
        // Create-idempotency guard (#1107, Piotr review): a prior attempt may have
        // created the product but died before core persisted the identifier
        // mapping, leaving an orphan. Because `body.reference` = internalVariantId
        // is a stable server-side key, look it up first and ADOPT the orphan
        // (update it) instead of creating a duplicate. A lookup miss → first
        // publish → create. A lookup error propagates (mapped below) rather than
        // falling through to create, so a flaky GET can never spawn a duplicate.
        const orphanId = await this.findExistingByReference(cmd.internalVariantId);
        response =
          orphanId != null
            ? await this.client.updateResource<PrestashopProductResponse>('products', orphanId, {
                id: orphanId,
                ...body,
              })
            : await this.client.createResource<PrestashopProductResponse>('products', body);
      }
    } catch (err) {
      throw this.toPublishError(err);
    }

    const productId = String(response.id);
    await this.updateStock(productId, cmd.stock);

    // Upload images best-effort: per-image failures are warned, not fatal.
    // Mirrors the updateStock posture — an unset image heals on the next sync.
    const warnings: string[] = [];
    if (cmd.content?.imageUrls != null && cmd.content.imageUrls.length > 0) {
      await this.uploadImages(productId, cmd.content.imageUrls, warnings);
    }

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
    featureAssociations: PrestashopFeatureAssociation[],
  ): PrestashopProductWriteBody {
    const title = cmd.content?.title ?? '';
    const slug = (cmd.content?.seo?.slug ?? this.slugify(title)) || 'product';

    const body: PrestashopProductWriteBody = {
      ...(cmd.platformParams ?? {}),
      name: langField(title, languageId),
      link_rewrite: langField(slug, languageId),
      // Stable idempotency key — see findExistingByReference (#1107). Explicit so
      // it always wins over any un-modeled platformParams.reference.
      reference: cmd.internalVariantId,
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

    const hasCategories = cmd.destinationCategoryIds.length > 0;
    const hasFeatures = featureAssociations.length > 0;
    if (hasCategories || hasFeatures) {
      body.associations = {
        ...(hasCategories
          ? { categories: { category: cmd.destinationCategoryIds.map((id) => ({ id: String(id) })) } }
          : {}),
        ...(hasFeatures ? { product_features: { product_feature: featureAssociations } } : {}),
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

  /**
   * Look up an existing product by its stable `reference` (= internalVariantId).
   * Returns the PS product id of a prior orphaned create, or null on a genuine
   * miss (first publish). Throws on a transport/API failure — the caller must NOT
   * treat an ambiguous lookup as "no match" and create, or the duplicate-product
   * hazard this guard closes would reopen (#1107).
   */
  private async findExistingByReference(reference: string): Promise<string | null> {
    const rows = await this.client.listResources<PrestashopProductListItem>('products', {
      custom: { 'filter[reference]': reference },
    });
    const match = rows.find((row) => String(row.reference ?? '') === reference);
    return match ? String(match.id) : null;
  }

  private async updateStock(productId: string, quantity: number): Promise<void> {
    // Fully best-effort: PS creates the product before returning, so if any step
    // here throws the core service won't persist the identifier mapping. The retry
    // no longer duplicates — findExistingByReference adopts the orphan by its
    // stable `reference` (#1107). An unset stock heals on the next inventory sync.
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

  /**
   * Resolve-or-create PS Feature and FeatureValue resources for each parameter.
   * Hard-fail: if PS rejects a feature write the product body would be incomplete,
   * so the error propagates to the caller (unlike best-effort image upload).
   */
  private async provisionFeatures(
    parameters: OfferParameter[],
    languageId: string,
  ): Promise<PrestashopFeatureAssociation[]> {
    const associations: PrestashopFeatureAssociation[] = [];

    for (const param of parameters) {
      const featureName = param.id;

      // Resolve or create the feature
      const existingFeatures = await this.client.listResources<PrestashopFeatureListItem>(
        'product_features',
        { custom: { 'filter[name]': featureName } },
      );
      const existingFeature = existingFeatures.find(
        (f) => this.extractLangText(f.name, languageId) === featureName,
      );

      let featureId: string;
      if (existingFeature) {
        featureId = String(existingFeature.id);
      } else {
        const created = await this.client.createResource<PrestashopFeatureResponse>(
          'product_features',
          { name: langField(featureName, languageId) },
        );
        featureId = String(created.id);
      }

      // Resolve or create each feature value
      for (const value of param.values ?? []) {
        const existingValues = await this.client.listResources<PrestashopFeatureValueListItem>(
          'product_feature_values',
          { custom: { 'filter[id_feature]': featureId } },
        );
        const existingValue = existingValues.find(
          (v) => this.extractLangText(v.value, languageId) === value,
        );

        let featureValueId: string;
        if (existingValue) {
          featureValueId = String(existingValue.id);
        } else {
          const created = await this.client.createResource<PrestashopFeatureValueResponse>(
            'product_feature_values',
            { id_feature: featureId, value: langField(value, languageId) },
          );
          featureValueId = String(created.id);
        }

        associations.push({ id: featureId, id_feature_value: featureValueId });
      }
    }

    return associations;
  }

  /**
   * Upload product images best-effort. Per-image fetch or upload failures are
   * appended to `warnings` and processing continues — mirrors the `updateStock`
   * posture. An unset image can be recovered on the next publish/sync cycle.
   */
  private async uploadImages(
    productId: string,
    imageUrls: string[],
    warnings: string[],
  ): Promise<void> {
    for (const url of imageUrls) {
      try {
        const controller = new AbortController();
        const timeoutMs: number = (this.connection.config?.timeoutMs as number | undefined) ?? 30000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        let bytes: Uint8Array;
        let mimeType: string;
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          const buffer = await response.arrayBuffer();
          bytes = new Uint8Array(buffer);
          mimeType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
        } finally {
          clearTimeout(timeoutId);
        }

        const filename = url.split('/').pop()?.split('?')[0] ?? 'image';
        await this.client.uploadImage(`images/products/${productId}`, bytes, mimeType, filename);
      } catch (err) {
        this.logger.warn(
          `Image upload failed for product ${productId} url="${url}" connection=${this.connection.id} — skipped.`,
          (err as Error).stack,
        );
        warnings.push(
          `imageUrls: failed to upload "${url}" for product ${productId} — ${(err as Error).message}`,
        );
      }
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
