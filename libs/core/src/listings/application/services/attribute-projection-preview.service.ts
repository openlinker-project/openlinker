/**
 * Attribute Projection Preview Service
 *
 * Previews, per variant, the destination parameters an offer will be created
 * with from the operator's attribute mappings and #1841 rules (#3995). Before
 * this the rules ran only inside the worker's publish, so the offer wizard could
 * neither show what they fill nor let them satisfy its required-parameter gate:
 * the operator typed every rule-covered value by hand, per variant.
 *
 * The projection input is assembled exactly as `OfferBuilderService` assembles
 * it - same master connection, same variant attributes, same
 * `buildProjectionMetadata`, same borrowed taxonomy - because the wizard
 * promises that what it shows is what the marketplace receives. A preview built
 * from different inputs would make that promise false in exactly the cases
 * (manufacturer- or phrase-scoped rules, `place-value` rules) the operator can
 * least easily check.
 *
 * Read-only: nothing is created and no job is enqueued. The cost is one master
 * product read per distinct product and one category-schema read per category,
 * which the destination adapter caches.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IAttributeProjectionPreviewService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { CONNECTION_PORT_TOKEN, ConnectionPort } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferManagerPort, TaxonomyOwner } from '@openlinker/core/listings';
import { isTaxonomyBorrower } from '@openlinker/core/listings';
import type { Product, ProductMasterPort } from '@openlinker/core/products';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';

import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import { ATTRIBUTE_PROJECTION_SERVICE_TOKEN } from '../../listings.tokens';
import type { IAttributeProjectionPreviewService } from '../interfaces/attribute-projection-preview.service.interface';
import { IAttributeProjectionService } from '../interfaces/attribute-projection.service.interface';
import type {
  AttributeProjectionPreviewEntry,
  AttributeProjectionPreviewInput,
  AttributeProjectionPreviewItem,
  AttributeProjectionPreviewResult,
} from '../types/attribute-projection-preview.types';
import { buildProjectionMetadata } from './build-projection-metadata';
import { readMasterCatalogConnectionId } from './read-master-catalog-connection-id';

interface PreviewContext {
  connectionId: string;
  masterConnectionId: string;
  productMaster: ProductMasterPort;
  borrowedTaxonomy: TaxonomyOwner | undefined;
  /** One master read per product, shared by its siblings. */
  products: Map<string, Promise<Product>>;
}

@Injectable()
export class AttributeProjectionPreviewService implements IAttributeProjectionPreviewService {
  private readonly logger = new Logger(AttributeProjectionPreviewService.name);

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

  async preview(input: AttributeProjectionPreviewInput): Promise<AttributeProjectionPreviewResult> {
    if (input.items.length === 0) return { entries: [] };

    const connection = await this.connectionPort.get(input.connectionId);
    const masterConnectionId = readMasterCatalogConnectionId(connection.config);
    if (!masterConnectionId) {
      throw new MasterCatalogConnectionNotConfiguredException(input.connectionId);
    }

    const [productMaster, destination] = await Promise.all([
      this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
        masterConnectionId,
        'ProductMaster'
      ),
      this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        input.connectionId,
        'OfferManager'
      ),
    ]);

    const context: PreviewContext = {
      connectionId: input.connectionId,
      masterConnectionId,
      productMaster,
      borrowedTaxonomy: isTaxonomyBorrower(destination)
        ? destination.getBorrowedTaxonomy()
        : undefined,
      products: new Map(),
    };

    // Sequential on purpose: the schema read is per category and cached by the
    // adapter after the first variant, and the master read is per product, so
    // fanning out would multiply live calls without making the answer faster.
    const entries: AttributeProjectionPreviewEntry[] = [];
    for (const item of input.items) {
      entries.push(await this.previewOne(item, context));
    }
    return { entries };
  }

  private async previewOne(
    item: AttributeProjectionPreviewItem,
    context: PreviewContext
  ): Promise<AttributeProjectionPreviewEntry> {
    const base = { internalVariantId: item.internalVariantId, categoryId: item.categoryId };
    const variant = await this.productsService.getVariant(item.internalVariantId);
    if (!variant) return { ...base, status: 'failed', reason: 'variant-not-found' };

    try {
      const product = await this.productFor(variant.productId, context);
      // Same precedence as the builder: the operator's EAN override first.
      const effectiveBarcode = item.ean ?? variant.ean ?? variant.gtin ?? null;
      const projection = await this.attributeProjection.project({
        sourceConnectionId: context.masterConnectionId,
        destinationConnectionId: context.connectionId,
        destinationCategoryId: item.categoryId,
        attributes: variant.attributes ?? {},
        metadata: buildProjectionMetadata(product, variant, effectiveBarcode),
        ...(context.borrowedTaxonomy ? { borrowedTaxonomy: context.borrowedTaxonomy } : {}),
      });
      return {
        ...base,
        status: 'ok',
        parameters: projection.parameters,
        unresolvedRequired: projection.unresolvedRequired,
        restrictionIssues: projection.restrictionIssues,
        origins: projection.origins,
      };
    } catch (error) {
      this.logger.warn(
        `Projection preview failed for variant=${item.internalVariantId} ` +
          `connection=${context.connectionId} category=${item.categoryId}: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return { ...base, status: 'failed', reason: 'projection-failed' };
    }
  }

  private productFor(productId: string, context: PreviewContext): Promise<Product> {
    let pending = context.products.get(productId);
    if (!pending) {
      pending = context.productMaster.getProduct(productId);
      context.products.set(productId, pending);
    }
    return pending;
  }
}
