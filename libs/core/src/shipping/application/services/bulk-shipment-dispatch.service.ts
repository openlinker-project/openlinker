/**
 * Bulk Shipment Dispatch Service
 *
 * Synchronous bulk surface over the per-order dispatch seam (#964, ADR-019):
 *
 *  - `dispatchBulk` loops `IShipmentDispatchService.dispatch()` once per item,
 *    isolating each order's failure so a partial failure keeps the successful
 *    siblings' labels (AC-6). It owns NO routing / payment-gate / idempotency /
 *    persistence of its own — every per-order guarantee is inherited from the
 *    seam it loops, with zero duplication.
 *  - `generateProtocol` resolves the dispatched shipments' single carrier
 *    connection and narrows the `DispatchProtocolReader` sub-capability to
 *    produce the handover manifest (the per-batch sibling of the #884 per-parcel
 *    label fetch).
 *
 * Deliberately NOT an async batch aggregate (no batch table, worker, or
 * advancement gate) — DPD bulk is a handful of fast calls, not the slow,
 * rate-limited, restart-surviving workload that justifies the bulk-offer
 * machinery. This service is the seam a future async wrapper (#831) would call.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IBulkShipmentDispatchService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

import type { IBulkShipmentDispatchService } from '../interfaces/bulk-shipment-dispatch.service.interface';
import { IShipmentDispatchService } from '../interfaces/shipment-dispatch.service.interface';
import type {
  BulkShipmentDispatchInput,
  BulkShipmentDispatchResult,
  PerOrderDispatchResult,
} from '../types/bulk-shipment-dispatch.types';
import type { LabelDocument } from '../../domain/types/label-document.types';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { DispatchProtocolNotSupportedException } from '../../domain/exceptions/dispatch-protocol-not-supported.exception';
import { InvalidProtocolBatchException } from '../../domain/exceptions/invalid-protocol-batch.exception';
import { isDispatchProtocolReader } from '../../domain/ports/capabilities/dispatch-protocol-reader.capability';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SHIPMENT_DISPATCH_SERVICE_TOKEN, SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

/** Capability the resolved carrier connection must declare to resolve a provider adapter. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

@Injectable()
export class BulkShipmentDispatchService implements IBulkShipmentDispatchService {
  private readonly logger = new Logger(BulkShipmentDispatchService.name);

  constructor(
    @Inject(SHIPMENT_DISPATCH_SERVICE_TOKEN)
    private readonly dispatch: IShipmentDispatchService,
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async dispatchBulk(input: BulkShipmentDispatchInput): Promise<BulkShipmentDispatchResult> {
    const results: PerOrderDispatchResult[] = [];

    // Sequential, NOT Promise.all: the per-order idempotency check
    // (findActiveByOrderId) is best-effort, not concurrency-safe, and the N≤25
    // cap keeps sequential wall-clock acceptable (ADR-019). Distinct orders also
    // avoid any shared-row contention by construction.
    for (const item of input.items) {
      try {
        const result = await this.dispatch.dispatch({
          sourceConnectionId: input.sourceConnectionId,
          ...item,
        });
        results.push(
          result.kind === 'dispatched'
            ? { kind: 'dispatched', orderId: item.orderId, shipment: result.shipment }
            : { kind: 'omp_fulfilled', orderId: item.orderId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Bulk dispatch failed for order ${item.orderId}: ${message}`);
        results.push({ kind: 'failed', orderId: item.orderId, error: message });
      }
    }

    return { results };
  }

  async generateProtocol(input: { shipmentIds: string[] }): Promise<LabelDocument> {
    if (input.shipmentIds.length === 0) {
      throw new InvalidProtocolBatchException('no shipments provided');
    }

    const loaded = await Promise.all(input.shipmentIds.map((id) => this.shipments.findById(id)));
    // Only shipments with a provider id were actually generated — a manifest can
    // only cover real waybills. Silently drop unknown / label-less ids; if none
    // remain the batch is invalid.
    const dispatched = loaded.filter(
      (s): s is Shipment => s !== null && s.providerShipmentId !== null,
    );
    if (dispatched.length === 0) {
      throw new InvalidProtocolBatchException(
        'none of the shipments have a generated label (no provider shipment id)',
      );
    }
    // Observability: in the designed flow the caller passes dispatched ids so
    // nothing drops. A mismatch means an unknown / label-less id slipped in —
    // surface it so a wrong manifest count is diagnosable rather than silent.
    if (dispatched.length < input.shipmentIds.length) {
      this.logger.warn(
        `Protocol covers ${dispatched.length}/${input.shipmentIds.length} requested shipments; ` +
          `the rest are unknown or have no generated label`,
      );
    }

    const connectionIds = new Set(dispatched.map((s) => s.connectionId));
    if (connectionIds.size > 1) {
      throw new InvalidProtocolBatchException(
        `shipments span ${connectionIds.size} carrier connections; a handover protocol is per-carrier-account`,
      );
    }
    const connectionId = dispatched[0].connectionId;

    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      connectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );
    if (!isDispatchProtocolReader(adapter)) {
      throw new DispatchProtocolNotSupportedException(connectionId);
    }

    // Non-null asserted: the filter above kept only providerShipmentId !== null.
    const providerShipmentIds = dispatched.map((s) => s.providerShipmentId as string);
    return adapter.generateProtocol({ providerShipmentIds });
  }
}
