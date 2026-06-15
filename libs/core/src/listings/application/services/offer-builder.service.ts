/**
 * Offer Builder Service
 *
 * Assembles a platform-neutral `CreateOfferCommand` from an OL internal variant
 * id. Fetches variant metadata via `IProductsService`, resolves the parent
 * master product via `ProductMasterPort` (for name/description/images/price),
 * resolves the marketplace category via `ICategoryResolutionService`
 * (barcode → per-source-category mapping → manual, provenance-aware), projects
 * the variant's attributes into neutral `OfferParameter[]` via
 * `IAttributeProjectionService`, and validates required fields. Throws
 * `OfferBuilderValidationException` with a list of issues when anything is
 * missing so callers can surface all problems at once — `OfferCreationExecution`
 * maps that to `business_failure` (ADR-007).
 *
 * Two publish gates (ADR-023 §5):
 *  1. unresolved category / price → `business_failure`.
 *  2. unresolved **offer-section** required parameters → `business_failure`.
 *     Product-section required params are deferred to the adapter / marketplace
 *     because Allegro catalog smart-link (#431/#808) inherits them from the
 *     card; gating them here would false-fail card-linked / bulk (#824) offers.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferBuilderService}
 */

import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';
import { CONNECTION_PORT_TOKEN, ConnectionPort } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { CreateOfferCommand, OfferParameter } from '@openlinker/core/listings';
import type { ProductMasterPort } from '@openlinker/core/products';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
} from '@openlinker/core/products';

import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import type { OfferBuilderValidationIssue } from '../../domain/exceptions/offer-builder-validation.exception';
import { OfferBuilderValidationException } from '../../domain/exceptions/offer-builder-validation.exception';
import {
  ATTRIBUTE_PROJECTION_SERVICE_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
} from '../../listings.tokens';
import { IAttributeProjectionService } from '../interfaces/attribute-projection.service.interface';
import { ICategoryResolutionService } from '../interfaces/category-resolution.service.interface';
import type { IOfferBuilderService } from '../interfaces/offer-builder.service.interface';
import type { BuildCreateOfferCommandInput } from '../types/offer-builder.types';

@Injectable()
export class OfferBuilderService implements IOfferBuilderService {
  private readonly logger = new Logger(OfferBuilderService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CATEGORY_RESOLUTION_SERVICE_TOKEN)
    private readonly categoryResolution: ICategoryResolutionService,
    @Inject(ATTRIBUTE_PROJECTION_SERVICE_TOKEN)
    private readonly attributeProjection: IAttributeProjectionService
  ) {}

  async buildCreateOfferCommand(input: BuildCreateOfferCommandInput): Promise<CreateOfferCommand> {
    const issues: OfferBuilderValidationIssue[] = [];

    const variant = await this.productsService.getVariant(input.internalVariantId);
    if (!variant) {
      throw new OfferBuilderValidationException([
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

    const categoryId = await this.resolveCategory(
      input,
      variant.ean ?? variant.gtin ?? null,
      product.categories
    );
    if (!categoryId) {
      issues.push({
        field: 'overrides.categoryId',
        code: 'REQUIRED',
        message:
          'No automatic category match for variant barcode and no override provided; supply overrides.categoryId',
      });
    }

    const price = this.resolvePrice(input, product, issues);

    // Gate 1 — category / price. Throw before projection: projection needs a
    // resolved category, and surfacing all field problems at once is the
    // builder's contract.
    if (issues.length > 0) {
      throw new OfferBuilderValidationException(issues);
    }

    // `categoryId` is guaranteed non-null here — Gate 1 pushed a `REQUIRED`
    // issue and threw otherwise.
    const parameters = await this.projectParameters(
      input,
      masterConnectionId,
      categoryId as string,
      variant.attributes ?? {}
    );

    const title = input.overrides?.title ?? product.name;
    const description = input.overrides?.description ?? product.description;
    const imageUrls = input.overrides?.imageUrls ?? product.images;

    const overrides = {
      title,
      description,
      categoryId,
      imageUrls,
      platformParams: input.overrides?.platformParams,
    };

    // Strip both null and undefined so the command shape stays tidy and
    // adapters see a consistent "absent field" regardless of whether the
    // source was a missing override or a null Product field.
    const cleanedOverrides: CreateOfferCommand['overrides'] = {};
    if (overrides.title != null) cleanedOverrides.title = overrides.title;
    if (overrides.description != null) cleanedOverrides.description = overrides.description;
    if (overrides.categoryId != null) cleanedOverrides.categoryId = overrides.categoryId;
    if (overrides.imageUrls != null) cleanedOverrides.imageUrls = overrides.imageUrls;
    if (overrides.platformParams != null) {
      cleanedOverrides.platformParams = overrides.platformParams;
    }

    const command: CreateOfferCommand = {
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      // `price` is guaranteed defined here because `issues` would have caught it above.
      price: price as { amount: number; currency: string },
      stock: input.stock,
      publishImmediately: input.publishImmediately ?? false,
      overrides: Object.keys(cleanedOverrides).length > 0 ? cleanedOverrides : undefined,
      idempotencyKey: input.idempotencyKey,
      // Neutral projected parameters (#1039). The adapter merges these with any
      // operator-supplied `platformParams.parameters`/`productParameters` and
      // shapes them to platform wire. Omitted when empty so offers with no
      // mappable attributes keep their existing command shape.
      ...(parameters.length > 0 ? { parameters } : {}),
      // #431 — smart-link by barcode. Pre-resolved here so adapters that
      // need it (Allegro) don't have to re-fetch the variant.
      variantBarcode: variant.ean ?? variant.gtin ?? null,
      // #808 — smart-link by pre-resolved catalogue card. When the wizard
      // already matched a unique product card by EAN, thread its id straight
      // through so the adapter links it (and inherits its required product
      // parameters) instead of re-resolving — kept off `overrides` so the
      // adapter sees it as a top-level hint alongside `variantBarcode`.
      productCardId: input.overrides?.productCardId ?? null,
    };

    this.logger.debug(
      `Built CreateOfferCommand for variant=${input.internalVariantId} connection=${input.connectionId} categoryId=${categoryId ?? 'null'} params=${parameters.length} productCardId=${command.productCardId ?? 'null'}`
    );

    return command;
  }

  private async resolveCategory(
    input: BuildCreateOfferCommandInput,
    barcode: string | null,
    sourceCategoryIds: string[] | undefined
  ): Promise<string | null> {
    if (input.overrides?.categoryId) {
      return input.overrides.categoryId;
    }
    const hasSourceCategories = sourceCategoryIds != null && sourceCategoryIds.length > 0;
    // Nothing to resolve from: no override, no barcode, no source categories.
    if (!barcode && !hasSourceCategories) {
      return null;
    }
    const result = await this.categoryResolution.resolveCategory({
      connectionId: input.connectionId,
      barcode,
      // Only include when present so the call shape stays minimal (the chain
      // treats an absent list the same as an empty one).
      ...(hasSourceCategories ? { sourceCategoryIds } : {}),
    });
    return result.destinationCategoryId;
  }

  /**
   * Project the variant's attributes into neutral `OfferParameter[]` and apply
   * Gate 2 (offer-section required params). Returns the projected parameters
   * for the command; the adapter merges them with operator-supplied params.
   */
  private async projectParameters(
    input: BuildCreateOfferCommandInput,
    sourceConnectionId: string,
    destinationCategoryId: string,
    attributes: Record<string, string>
  ): Promise<OfferParameter[]> {
    const projection = await this.attributeProjection.project({
      sourceConnectionId,
      destinationConnectionId: input.connectionId,
      destinationCategoryId,
      attributes,
    });

    // Gate 2 — offer-section required params only. Product-section required
    // params are deferred to the adapter / marketplace (Allegro catalog-card
    // inheritance, #431/#808; bulk self-link, #824). Operator-supplied
    // offer-section params (FE wizard, carried on `platformParams.parameters`)
    // satisfy the requirement, so subtract their ids before gating.
    const operatorOfferParamIds = this.readOperatorOfferParamIds(input.overrides?.platformParams);
    const blockingRequired = projection.unresolvedRequired.filter(
      (param) => param.section === 'offer' && !operatorOfferParamIds.has(param.id)
    );
    if (blockingRequired.length > 0) {
      throw new OfferBuilderValidationException(
        blockingRequired.map((param) => ({
          field: `parameters.${param.name}`,
          code: 'PARAMETER_REQUIRED',
          message: `Required offer parameter "${param.name}" (id=${param.id}) has no resolvable value; map the source attribute or supply it explicitly`,
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
   * Collect the ids of operator-supplied **offer-section** parameters from the
   * (transitional) FE channel `platformParams.parameters`. Ids only, narrowed
   * with a type guard — used solely to keep Gate 2 from false-failing a wizard
   * offer whose required param the operator already supplied. Removed once the
   * FE migrates to the neutral channel (#1071).
   */
  private readOperatorOfferParamIds(
    platformParams: Record<string, unknown> | undefined
  ): Set<string> {
    const ids = new Set<string>();
    const raw = platformParams?.['parameters'];
    if (!Array.isArray(raw)) return ids;
    for (const entry of raw) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === 'string'
      ) {
        ids.add((entry as { id: string }).id);
      }
    }
    return ids;
  }

  private resolvePrice(
    input: BuildCreateOfferCommandInput,
    product: { price: number | null; currency: string | null },
    issues: OfferBuilderValidationIssue[]
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
    // Marketplaces reject non-positive prices; distinguish "missing" from "zero/negative"
    // so the caller can see which fix is needed.
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
