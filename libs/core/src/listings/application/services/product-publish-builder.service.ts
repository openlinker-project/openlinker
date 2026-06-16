/**
 * Product Publish Builder Service
 *
 * Assembles a platform-neutral `PublishProductCommand` from an OL internal
 * variant id. Fetches variant metadata via `IProductsService`, resolves the
 * parent master product via `ProductMasterPort` (name/description/images/price/
 * categories), **provisions** the destination category on the shop
 * (open-provenance, via `CategoryProvisioner` when the destination supports it),
 * projects the variant's attributes into neutral `OfferParameter[]` via
 * `IAttributeProjectionService`, and validates required fields — throwing
 * `ProductPublishBuilderValidationException` so `ProductPublishExecutionService`
 * maps it to `business_failure` (ADR-007).
 *
 * Shop-side sibling of `OfferBuilderService`. Two deliberate departures:
 *  - Category placement is **provisioning-only** here (not the marketplace
 *    `CategoryResolutionService` chain, which resolves `'OfferManager'` and runs
 *    on the offer hot path). No provisioner / no source categories → publish
 *    uncategorised (not a gate failure).
 *  - The publish gate has no offer/product section split — every unresolved
 *    required destination parameter blocks.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IProductPublishBuilderService}
 */

import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';
import { CONNECTION_PORT_TOKEN, ConnectionPort } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type {
  OfferParameter,
  ProvisionCategoryCommand,
  PublishProductCommand,
  PublishProductContent,
  ShopProductManagerPort,
} from '@openlinker/core/listings';
import { isCategoryProvisioner } from '@openlinker/core/listings';
import type { Category, ProductMasterPort } from '@openlinker/core/products';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';

import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import type { ProductPublishBuilderValidationIssue } from '../../domain/exceptions/product-publish-builder-validation.exception';
import { ProductPublishBuilderValidationException } from '../../domain/exceptions/product-publish-builder-validation.exception';
import { ATTRIBUTE_PROJECTION_SERVICE_TOKEN } from '../../listings.tokens';
import { IAttributeProjectionService } from '../interfaces/attribute-projection.service.interface';
import type { IProductPublishBuilderService } from '../interfaces/product-publish-builder.service.interface';
import type { BuildPublishProductCommandInput } from '../types/product-publish-builder.types';

@Injectable()
export class ProductPublishBuilderService implements IProductPublishBuilderService {
  private readonly logger = new Logger(ProductPublishBuilderService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(ATTRIBUTE_PROJECTION_SERVICE_TOKEN)
    private readonly attributeProjection: IAttributeProjectionService
  ) {}

  async buildPublishProductCommand(
    input: BuildPublishProductCommandInput
  ): Promise<PublishProductCommand> {
    const issues: ProductPublishBuilderValidationIssue[] = [];

    const variant = await this.productsService.getVariant(input.internalVariantId);
    if (!variant) {
      throw new ProductPublishBuilderValidationException([
        {
          field: 'internalVariantId',
          code: 'NOT_FOUND',
          message: `Variant ${input.internalVariantId} not found`,
        },
      ]);
    }

    const connection = await this.connectionPort.get(input.connectionId);
    const masterConnectionId = this.readMasterCatalogConnectionId(connection.config);
    if (!masterConnectionId) {
      throw new MasterCatalogConnectionNotConfiguredException(input.connectionId);
    }

    const productMaster = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
      masterConnectionId,
      'ProductMaster'
    );
    const product = await productMaster.getProduct(variant.productId);

    const price = this.resolvePrice(input, product, issues);
    if (issues.length > 0) {
      throw new ProductPublishBuilderValidationException(issues);
    }

    const destinationCategoryIds = await this.provisionCategory(input.connectionId, productMaster, variant.productId);
    const parameters = await this.projectParameters(
      input,
      masterConnectionId,
      destinationCategoryIds[0] ?? null,
      variant.attributes ?? {}
    );

    const content = this.buildContent(input.content, product);

    const command: PublishProductCommand = {
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      destinationCategoryIds,
      // `price` is guaranteed defined here — `issues` would have caught it above.
      price: price as { amount: number; currency: string },
      stock: input.stock,
      status: input.status,
      ...(content ? { content } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };

    this.logger.debug(
      `Built PublishProductCommand for variant=${input.internalVariantId} connection=${input.connectionId} categories=${destinationCategoryIds.length} params=${parameters.length} status=${input.status}`
    );

    return command;
  }

  /**
   * Provision the destination category path (open-provenance, ADR-024 §2) when
   * the shop adapter supports `CategoryProvisioner`. Best-effort: no provisioner
   * or no source categories → `[]` (publish uncategorised). The source path is
   * built from the master product's categories ordered root→leaf by `depth`.
   */
  private async provisionCategory(
    connectionId: string,
    productMaster: ProductMasterPort,
    productId: string
  ): Promise<string[]> {
    const adapter = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      connectionId,
      'ProductPublisher'
    );
    if (!isCategoryProvisioner(adapter)) {
      return [];
    }

    const categories = await productMaster.getProductCategories(productId);
    const path = this.toProvisionPath(categories);
    if (path.length === 0) {
      return [];
    }

    const cmd: ProvisionCategoryCommand = { connectionId, path };
    const result = await adapter.provisionCategory(cmd);
    return [result.destinationCategoryId];
  }

  /**
   * Order the product's source categories root→leaf and map them to the
   * provision path shape. MVP best-effort: sorts by `depth` ascending
   * (root→leaf); platforms without a depth report keep the returned order.
   * Assumes a single category branch — multi-branch products provision the
   * combined ordered list (a documented MVP limitation, refined alongside
   * multi-category placement).
   */
  private toProvisionPath(categories: Category[]): { sourceCategoryId: string; name: string }[] {
    return [...categories]
      .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))
      .map((c) => ({ sourceCategoryId: c.id, name: c.name }));
  }

  /**
   * Project the variant's attributes into neutral `OfferParameter[]` and gate
   * on unresolved required destination parameters (all sections — shops have no
   * offer/product split). `destinationCategoryId` null (uncategorised) ⇒ skip
   * projection (no category schema to project against).
   */
  private async projectParameters(
    input: BuildPublishProductCommandInput,
    sourceConnectionId: string,
    destinationCategoryId: string | null,
    attributes: Record<string, string>
  ): Promise<OfferParameter[]> {
    if (!destinationCategoryId) {
      return [];
    }
    const projection = await this.attributeProjection.project({
      sourceConnectionId,
      destinationConnectionId: input.connectionId,
      destinationCategoryId,
      attributes,
      // Shop connections expose the schema reader under `ProductPublisher`, not
      // the marketplace `OfferManager` (which they don't support — resolving it
      // would throw `CapabilityNotSupportedException`).
      destinationCapability: 'ProductPublisher',
    });

    if (projection.unresolvedRequired.length > 0) {
      throw new ProductPublishBuilderValidationException(
        projection.unresolvedRequired.map((param) => ({
          field: `parameters.${param.name}`,
          code: 'PARAMETER_REQUIRED',
          message: `Required destination parameter "${param.name}" (id=${param.id}) has no resolvable value; map the source attribute or supply it explicitly`,
        }))
      );
    }

    if (projection.unmappedSourceKeys.length > 0) {
      this.logger.warn(
        `Omitting ${projection.unmappedSourceKeys.length} unmapped source attribute(s) for variant=${input.internalVariantId} connection=${input.connectionId}: ${projection.unmappedSourceKeys.join(', ')}`
      );
    }

    return projection.parameters;
  }

  /**
   * Merge caller content overrides with master-product fallbacks, stripping
   * null/undefined so adapters see a consistent "absent field". Returns
   * `undefined` when nothing resolved (keeps the command shape tidy).
   */
  private buildContent(
    overrides: PublishProductContent | undefined,
    product: { name: string; description: string | null; images: string[] | null }
  ): PublishProductContent | undefined {
    const title = overrides?.title ?? product.name;
    const description = overrides?.description ?? product.description;
    const imageUrls = overrides?.imageUrls ?? product.images;

    const content: PublishProductContent = {};
    if (title != null) content.title = title;
    if (description != null) content.description = description;
    if (imageUrls != null) content.imageUrls = imageUrls;
    if (overrides?.seo != null) content.seo = overrides.seo;

    return Object.keys(content).length > 0 ? content : undefined;
  }

  private resolvePrice(
    input: BuildPublishProductCommandInput,
    product: { price: number | null; currency: string | null },
    issues: ProductPublishBuilderValidationIssue[]
  ): { amount: number; currency: string } | null {
    if (input.price) {
      return input.price;
    }
    const amount = product.price;
    const currency = product.currency;
    if (typeof amount !== 'number') {
      issues.push({
        field: 'price.amount',
        code: 'REQUIRED',
        message:
          'Price amount could not be resolved from input or master product; provide input.price explicitly',
      });
      return null;
    }
    if (amount <= 0) {
      issues.push({
        field: 'price.amount',
        code: 'NON_POSITIVE',
        message: `Master product price (${amount}) is not a positive value; provide input.price explicitly`,
      });
      return null;
    }
    if (!currency) {
      issues.push({
        field: 'price.currency',
        code: 'REQUIRED',
        message:
          'Currency could not be resolved from input or master product; provide input.price explicitly',
      });
      return null;
    }
    return { amount, currency };
  }

  private readMasterCatalogConnectionId(
    config: Record<string, unknown> | null | undefined
  ): string | null {
    if (!config) return null;
    const value = config['masterCatalogConnectionId'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
