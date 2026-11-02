/**
 * Auto-Dispatch Plan Context Loader (#2729)
 *
 * Loads, for ONE fulfilment work, every fact `planAutoDispatch` needs and
 * decides none of it. The refusal rules live in `@openlinker/core/shipping`
 * (`planAutoDispatch`); this is the thin host-side half that reads them, so the
 * settings preview and the bench label route both feed the SAME decision the
 * `fulfillment.work.autoDispatch` worker handler makes.
 *
 * ## Why it is a host-side loader
 *
 * The reads cross four contexts (orders, products, mappings, integrations) and
 * `libs/core/src/shipping` depends on `products` through none of them - a
 * `shipping -> products` edge would close `products -> listings -> shipping`.
 * ADR-053's rule, applied again: data enters the pure function as arguments, and
 * the context that can reach every source composes them.
 *
 * ## What it never does
 *
 * It writes nothing and buys nothing, and it never throws for a missing fact:
 * an unreadable order is reported as `order: null` and an unresolvable carrier
 * as "no requirements known", so the caller can name that in its answer rather
 * than turning a preview into a 500.
 *
 * @module apps/api/src/fulfillment/application/services
 */
import { Inject, Injectable } from '@nestjs/common';

import type { FulfillmentWorkView } from '@openlinker/core/fulfillment';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  type IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderSnapshotUnavailableError,
  orderFromReadySnapshot,
  type IOrderRecordService,
  type Order,
  type OrderRecord,
} from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  isParcelRequirementsReader,
  resolveCarrierMethod,
  type AutoDispatchParcelProfile,
  type DeliveryIntent,
  type ShippingProviderManagerPort,
} from '@openlinker/core/shipping';

export const AUTO_DISPATCH_PLAN_CONTEXT_LOADER_TOKEN = Symbol('IAutoDispatchPlanContextLoader');

export interface AutoDispatchPlanContext {
  readonly record: OrderRecord;
  /** `null` when the order snapshot is not readable (yet). */
  readonly order: Order | null;
  readonly parcelProfile: AutoDispatchParcelProfile | null;
  readonly variantWeightGrams: ReadonlyMap<string, number | null | undefined>;
  /**
   * The carrier's declared requirements for a delivery intent, or `null` when
   * none can be known (an OMP-fulfilled resolution, a carrier that declares
   * none, or one that could not be resolved).
   */
  readonly requirementsFor: (
    deliveryIntent: DeliveryIntent
  ) => { readonly requiresDimensions: boolean } | null;
}

export interface IAutoDispatchPlanContextLoader {
  /** `null` when the work's order record does not exist. */
  load(work: FulfillmentWorkView): Promise<AutoDispatchPlanContext | null>;
}

@Injectable()
export class AutoDispatchPlanContextLoader implements IAutoDispatchPlanContextLoader {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecords: IOrderRecordService,
    @Inject(PRODUCTS_SERVICE_TOKEN) private readonly products: IProductsService,
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN) private readonly routing: IFulfillmentRoutingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN) private readonly integrations: IIntegrationsService
  ) {}

  async load(work: FulfillmentWorkView): Promise<AutoDispatchPlanContext | null> {
    const record = await this.orderRecords.getOrderRecord(work.orderId);
    if (record === null) {
      return null;
    }

    const resolution = await this.routing.resolve({
      sourceConnectionId: record.sourceConnectionId,
      sourceDeliveryMethodId: record.sourceDeliveryMethodId,
    });

    const variantIds = Array.from(new Set(work.lines.map((line) => line.productVariantId)));
    const variants = variantIds.length === 0 ? [] : await this.products.getVariantsByIds(variantIds);

    return {
      record,
      order: this.readOrder(record),
      parcelProfile: resolution.parcelProfile,
      variantWeightGrams: new Map(variants.map((variant) => [variant.id, variant.weightGrams])),
      requirementsFor: await this.buildRequirementsLookup(resolution),
    };
  }

  private readOrder(record: OrderRecord): Order | null {
    try {
      // `requireBuyer: false` - the buyer-profile gate is invoicing's contract,
      // not a shipping label's (the worker handler's note, verbatim).
      return orderFromReadySnapshot(record, { requireBuyer: false });
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) {
        return null;
      }
      throw error;
    }
  }

  private async buildRequirementsLookup(
    resolution: Awaited<ReturnType<IFulfillmentRoutingService['resolve']>>
  ): Promise<AutoDispatchPlanContext['requirementsFor']> {
    // An OMP-fulfilled resolution buys no label here, so there is nothing to require.
    if (
      resolution.processorKind === FULFILLMENT_PROCESSOR_KIND.OmpFulfilled ||
      resolution.processorConnectionId === null
    ) {
      return () => null;
    }

    let adapter: ShippingProviderManagerPort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
        resolution.processorConnectionId,
        'ShippingProviderManager'
      );
    } catch {
      // A disabled connection or a credential failure: the requirement cannot
      // be known. The caller still gets a decision on everything else.
      return () => null;
    }
    if (!isParcelRequirementsReader(adapter)) {
      return () => null;
    }

    const reader = adapter;
    const supportedMethods = adapter.getSupportedMethods();
    return (deliveryIntent) => {
      const method = resolveCarrierMethod(deliveryIntent, supportedMethods);
      // No resolvable method is `no-delivery-method`, decided by `dispatch()`.
      return method === null ? null : reader.getParcelRequirements(method);
    };
  }
}
