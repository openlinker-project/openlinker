/**
 * Offer Builder Service
 *
 * Assembles a platform-neutral `CreateOfferCommand` from an OL internal variant
 * id. Fetches variant metadata from the local repository, resolves the parent
 * master product via `ProductMasterPort` (for name/description/images/price),
 * resolves the marketplace category via `ICategoryResolutionService`, and
 * validates required fields. Throws `OfferBuilderValidationException` with a
 * list of issues when anything is missing so callers can surface all problems
 * at once.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferBuilderService}
 */

import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import {
  CreateOfferCommand,
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  ProductMasterPort,
  ProductVariantRepositoryPort,
} from '@openlinker/core/products';

import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import {
  OfferBuilderValidationException,
  OfferBuilderValidationIssue,
} from '../../domain/exceptions/offer-builder-validation.exception';
import { CATEGORY_RESOLUTION_SERVICE_TOKEN } from '../../listings.tokens';
import { ICategoryResolutionService } from '../interfaces/category-resolution.service.interface';
import { IOfferBuilderService } from '../interfaces/offer-builder.service.interface';
import { BuildCreateOfferCommandInput } from '../types/offer-builder.types';

@Injectable()
export class OfferBuilderService implements IOfferBuilderService {
  private readonly logger = new Logger(OfferBuilderService.name);

  constructor(
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly variantRepository: ProductVariantRepositoryPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CATEGORY_RESOLUTION_SERVICE_TOKEN)
    private readonly categoryResolution: ICategoryResolutionService,
  ) {}

  async buildCreateOfferCommand(input: BuildCreateOfferCommandInput): Promise<CreateOfferCommand> {
    const issues: OfferBuilderValidationIssue[] = [];

    const variant = await this.variantRepository.findById(input.internalVariantId);
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
      'ProductMaster',
    );
    const product = await productMaster.getProduct(variant.productId);

    const categoryId = await this.resolveCategory(input, variant.ean ?? variant.gtin ?? null);
    if (!categoryId) {
      issues.push({
        field: 'overrides.categoryId',
        code: 'REQUIRED',
        message:
          'No automatic category match for variant barcode and no override provided; supply overrides.categoryId',
      });
    }

    const price = this.resolvePrice(input, product, issues);

    if (issues.length > 0) {
      throw new OfferBuilderValidationException(issues);
    }

    const title = input.overrides?.title ?? product.name;
    // product.description / product.images are `T | null` on the unified Product
    // interface, but CreateOfferOverrides expects `T | undefined`. Coerce null
    // back to undefined at this boundary. Follow-up: widen CreateOfferOverrides.
    const description = input.overrides?.description ?? product.description ?? undefined;
    const imageUrls = input.overrides?.imageUrls ?? product.images ?? undefined;

    const overrides = {
      title,
      description,
      categoryId: categoryId ?? undefined,
      imageUrls,
      platformParams: input.overrides?.platformParams,
    };

    // Drop undefined so serialization stays tidy.
    const cleanedOverrides: CreateOfferCommand['overrides'] = {};
    if (overrides.title !== undefined) cleanedOverrides.title = overrides.title;
    if (overrides.description !== undefined) cleanedOverrides.description = overrides.description;
    if (overrides.categoryId !== undefined) cleanedOverrides.categoryId = overrides.categoryId;
    if (overrides.imageUrls !== undefined) cleanedOverrides.imageUrls = overrides.imageUrls;
    if (overrides.platformParams !== undefined) {
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
    };

    this.logger.debug(
      `Built CreateOfferCommand for variant=${input.internalVariantId} connection=${input.connectionId} categoryId=${categoryId ?? 'null'}`,
    );

    return command;
  }

  private async resolveCategory(
    input: BuildCreateOfferCommandInput,
    barcode: string | null,
  ): Promise<string | null> {
    if (input.overrides?.categoryId) {
      return input.overrides.categoryId;
    }
    if (!barcode) {
      return null;
    }
    const result = await this.categoryResolution.resolveCategory({
      connectionId: input.connectionId,
      barcode,
    });
    return result.allegroCategoryId;
  }

  private resolvePrice(
    input: BuildCreateOfferCommandInput,
    product: { price: number | null; currency?: string },
    issues: OfferBuilderValidationIssue[],
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

  private readMasterCatalogConnectionId(config: Record<string, unknown> | null | undefined): string | null {
    if (!config) return null;
    const value = config['masterCatalogConnectionId'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
