/**
 * Bundle Offer Preview Service
 *
 * Reports, per bundle variant, how it would be published as a product-set offer
 * (#3520): each component's mode (own offer, catalogue card, new product or
 * missing), what blocks it, the category the destination will require, and how
 * many whole sets are sellable now. The bulk wizard asks this on Review so a
 * component the marketplace would refuse is named before submit.
 *
 * Read-only: components are resolved by the same builder the publish path uses,
 * and the destination plans them through its optional `ProductSetPlanner`
 * capability, which only reads. Nothing is created, uploaded or enqueued.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IBundleOfferPreviewService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { AVAILABILITY_SERVICE_TOKEN, type IAvailabilityService } from '@openlinker/core/inventory';
import type { OfferManagerPort, OfferProductSetComponent } from '@openlinker/core/listings';
import { isProductSetPlanner } from '@openlinker/core/listings';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';

import { OFFER_BUILDER_SERVICE_TOKEN } from '../../listings.tokens';
import type { IBundleOfferPreviewService } from '../interfaces/bundle-offer-preview.service.interface';
import { IOfferBuilderService } from '../interfaces/offer-builder.service.interface';
import type {
  BundleOfferPreviewComponent,
  BundleOfferPreviewEntry,
  BundleOfferPreviewInput,
  BundleOfferPreviewItem,
  BundleOfferPreviewResult,
} from '../types/bundle-offer-preview.types';

@Injectable()
export class BundleOfferPreviewService implements IBundleOfferPreviewService {
  private readonly logger = new Logger(BundleOfferPreviewService.name);

  constructor(
    @Inject(OFFER_BUILDER_SERVICE_TOKEN)
    private readonly offerBuilder: IOfferBuilderService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availability: IAvailabilityService
  ) {}

  async preview(input: BundleOfferPreviewInput): Promise<BundleOfferPreviewResult> {
    if (input.items.length === 0) return { entries: [] };
    const destination = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      input.connectionId,
      'OfferManager'
    );
    // Sequential: each bundle reads the marketplace, and the adapter caches
    // what repeats across bundles that share components.
    const entries: BundleOfferPreviewEntry[] = [];
    for (const item of input.items) {
      entries.push(await this.previewOne(item, input.connectionId, destination));
    }
    return { entries };
  }

  private async previewOne(
    item: BundleOfferPreviewItem,
    connectionId: string,
    destination: OfferManagerPort
  ): Promise<BundleOfferPreviewEntry> {
    const base = { internalVariantId: item.internalVariantId };
    try {
      const components = await this.offerBuilder.resolveBundleComponents({
        connectionId,
        internalVariantId: item.internalVariantId,
        ...(item.categoryId ? { categoryId: item.categoryId } : {}),
      });
      if (!components) return { ...base, status: 'not-a-bundle' };
      if (!isProductSetPlanner(destination)) {
        return { ...base, status: 'failed', reason: 'planning-unsupported' };
      }
      let plans = await destination.previewProductSet({
        ...(item.categoryId ? { categoryId: item.categoryId } : {}),
        components,
      });
      // With no category chosen, the destination can still tell which category
      // the first component's card sits in; the offer will be created there, so
      // the other components are planned under it (a barcode lookup is per
      // category and would otherwise read every one of them as "not found").
      const suggested = plans.find((plan) => plan.variantId === components[0]?.variantId)
        ?.cardCategoryId;
      if (!item.categoryId && suggested) {
        plans = await destination.previewProductSet({ categoryId: suggested, components });
      }
      const planByVariant = new Map(plans.map((plan) => [plan.variantId, plan]));
      const variants = await this.productsService.getVariantsByIds(
        components.map((component) => component.variantId)
      );
      const skuByVariant = new Map(variants.map((variant) => [variant.id, variant.sku ?? null]));

      const result: BundleOfferPreviewComponent[] = components.map((component) => {
        const plan = planByVariant.get(component.variantId);
        return {
          variantId: component.variantId,
          productId: component.productId,
          name: component.name,
          sku: skuByVariant.get(component.variantId) ?? null,
          quantity: component.quantity,
          giftSlot: component.giftSlot === true,
          imageUrl: component.imageUrls[0] ?? null,
          mode: plan?.mode ?? 'missing',
          ...(plan?.externalOfferId ? { externalOfferId: plan.externalOfferId } : {}),
          ...(plan?.cardCategoryId ? { cardCategoryId: plan.cardCategoryId } : {}),
          problems: plan?.problems ?? [],
        };
      });
      const sets = await this.availableSets(connectionId, components);
      return {
        ...base,
        status: 'ok',
        components: result,
        suggestedCategoryId: result[0]?.cardCategoryId ?? null,
        availableSets: sets.availableSets,
        limitingComponentVariantId: sets.limitingComponentVariantId,
      };
    } catch (error) {
      this.logger.warn(
        `Bundle offer preview failed for variant=${item.internalVariantId} connection=${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { ...base, status: 'failed', reason: 'preview-failed' };
    }
  }

  /**
   * Whole sets sellable now: min over components of floor(available / quantity).
   * `null` when any component's availability is unknown, because a guess in
   * either direction would publish the wrong stock.
   */
  private async availableSets(
    connectionId: string,
    components: readonly OfferProductSetComponent[]
  ): Promise<{ availableSets: number | null; limitingComponentVariantId: string | null }> {
    const answers = await this.availability.getPromisableQuantities({
      variantIds: components.map((component) => component.variantId),
      scope: { kind: 'channel', connectionId },
    });
    let sets: number | null = null;
    let limiting: string | null = null;
    for (const [index, component] of components.entries()) {
      const answer = answers[index];
      if (!answer || answer.provenance === 'unknown' || answer.quantity === null) {
        return { availableSets: null, limitingComponentVariantId: null };
      }
      const whole = Math.floor(answer.quantity / Math.max(1, component.quantity));
      if (sets === null || whole < sets) {
        sets = whole;
        limiting = component.variantId;
      }
    }
    return { availableSets: sets, limitingComponentVariantId: limiting };
  }
}
