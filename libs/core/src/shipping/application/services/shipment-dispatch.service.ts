/**
 * Shipment Dispatch Service
 *
 * Converges fulfillment dispatch onto the #832 routing model (#835): resolves
 * the processor for an order, and for a label-generating processor kind
 * (`ol_managed_carrier` / `source_brokered`) creates a `Shipment` and calls
 * `generateLabel` on the resolved connection's `ShippingProviderManagerPort`.
 *
 * This is the single dispatch entry point — it owns the `resolve()` call, so
 * there is no parallel routing mechanism by construction. It is unwired in
 * #835 (no trigger); the manual/auto call-site is #769/#771, exactly as #832
 * shipped `resolve()` without a live caller.
 *
 * `ol_managed_carrier` and `source_brokered` share one path: both implement
 * `ShippingProviderManagerPort` and the source-vs-distinct-connection topology
 * is enforced at rule-creation (#832 `assertCompatible`), not here. So #833's
 * Allegro Delivery adapter dispatches through this same code with zero changes
 * the day it declares the capability.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentDispatchService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  type IFulfillmentRoutingService,
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
} from '@openlinker/core/mappings';

import type { IShipmentDispatchService } from '../interfaces/shipment-dispatch.service.interface';
import type {
  ShipmentDispatchInput,
  ShipmentDispatchResult,
} from '../types/shipment-dispatch.types';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { UndispatchableResolutionException } from '../../domain/exceptions/undispatchable-resolution.exception';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { SHIPMENT_STATUS } from '../../domain/types/shipment-status.types';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

/** Capability the resolved processor connection must declare to issue a label. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

@Injectable()
export class ShipmentDispatchService implements IShipmentDispatchService {
  private readonly logger = new Logger(ShipmentDispatchService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN)
    private readonly routing: IFulfillmentRoutingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async dispatch(input: ShipmentDispatchInput): Promise<ShipmentDispatchResult> {
    const resolution = await this.routing.resolve({
      sourceConnectionId: input.sourceConnectionId,
      sourceDeliveryMethodId: input.sourceDeliveryMethodId,
    });

    switch (resolution.processorKind) {
      case FULFILLMENT_PROCESSOR_KIND.OmpFulfilled:
        // Branch-1: the OMP ships via its own carrier setup — OL generates no
        // label. Read-back is #834. Covers both the fan-out default (null
        // connection) and a configured omp_fulfilled rule (non-null connection).
        return { kind: 'omp_fulfilled' };

      case FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier:
      case FULFILLMENT_PROCESSOR_KIND.SourceBrokered: {
        const shipment = await this.dispatchViaShippingProvider(
          input,
          resolution.processorConnectionId,
        );
        return { kind: 'dispatched', shipment };
      }

      default: {
        // Exhaustiveness guard — a new processor kind must fail loud, not
        // silently skip dispatch (mirrors #832's assertCompatible).
        const exhaustive: never = resolution.processorKind;
        throw new UndispatchableResolutionException(
          `unknown processor kind: ${String(exhaustive)}`,
        );
      }
    }
  }

  /**
   * Resolve the provider-side delivery-method id the adapter sends, from the
   * source-side method — the **compatibility seam** ADR-012 keeps the OQ-B1
   * namespace question behind. v1 is identity: it assumes the order's
   * `delivery.method.id` is the value the source-brokered provider expects.
   * If a sandbox probe shows the namespaces diverge, only this body changes
   * (e.g. a co-keyed source→service mapping lookup, mirroring `CarrierMapping`)
   * — the adapter and routing model never reshape. Returns `undefined` for the
   * omp-fulfilled default (no source method); source-brokered adapters that
   * require the id throw a readable error when it is absent.
   */
  private resolveProviderDeliveryMethodId(input: ShipmentDispatchInput): string | undefined {
    return input.sourceDeliveryMethodId ?? undefined;
  }

  private async dispatchViaShippingProvider(
    input: ShipmentDispatchInput,
    processorConnectionId: string | null,
  ): Promise<Shipment> {
    if (!processorConnectionId) {
      // A label-generating rule always carries a processor connection (it can't
      // pass #832's compatibility gate otherwise). Defensive — unreachable.
      throw new UndispatchableResolutionException(
        'a label-generating processor resolved without a connection id',
      );
    }

    // Idempotency (best-effort): don't issue a second label/fee while a
    // non-terminal shipment for this order is in flight. The cancel + re-issue
    // flow flips the prior row to `cancelled` first, so a genuine re-dispatch is
    // still allowed. NOTE: this find→create is NOT atomic — two concurrent
    // dispatches for the same order can both pass it and double-create (the
    // schema allows N shipments/order by design, so there is no DB guard). The
    // live call-site (#769/#771) must serialise dispatch per order
    // (debounce / job-level dedup).
    const active = await this.shipments.findActiveByOrderId(input.orderId);
    if (active) {
      return active;
    }

    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      processorConnectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );

    const shipment = await this.shipments.create({
      orderId: input.orderId,
      connectionId: processorConnectionId,
      shippingMethod: input.shippingMethod,
      paczkomatId: input.paczkomatId,
      sourceDeliveryMethodId: input.sourceDeliveryMethodId ?? undefined,
    });

    // NOTE: if generateLabel commits provider-side but its response fails, the
    // shipment is marked `failed` (catch below) and a later re-dispatch starts a
    // fresh attempt — which could double-create at the provider. The command
    // carries `shipmentId`; adapters (#812/#833) should use it as a
    // provider-side idempotency key to close that at-least-once hazard.
    try {
      const result = await adapter.generateLabel({
        shipmentId: shipment.id,
        connectionId: processorConnectionId,
        orderId: input.orderId,
        shippingMethod: input.shippingMethod,
        paczkomatId: input.paczkomatId,
        deliveryMethodId: this.resolveProviderDeliveryMethodId(input),
        recipient: input.recipient,
        parcel: input.parcel,
      });

      return await this.shipments.update(shipment.id, {
        status: SHIPMENT_STATUS.Generated,
        providerShipmentId: result.providerShipmentId,
        // Some providers issue tracking asynchronously; leave null when absent.
        trackingNumber: result.trackingNumber ?? undefined,
        labelPdfRef: result.labelPdfRef,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `generateLabel failed for shipment ${shipment.id} (order ${input.orderId}): ${message}`,
      );
      // Persist the visible failure (surfaces in /shipments + enables retry),
      // then propagate the domain error so the caller can render it.
      await this.shipments.update(shipment.id, {
        status: SHIPMENT_STATUS.Failed,
        failedAt: new Date(),
        errorMessage: message,
      });
      throw error;
    }
  }
}
