/**
 * Offer Quantity Ack Reconcile Service
 *
 * Steady-state reconciliation of a connection's outstanding asynchronously-
 * acknowledged quantity writes (#2621). A quantity write to a destination
 * that only acknowledges asynchronously (submit now, confirm later) never
 * blocks the originating job — this service is the "confirm later" half,
 * run on its own schedule by a worker handler for any `OfferManager`-capable
 * connection whose dispatched adapter declares `PendingQuantityAckReconciler`.
 *
 * Deliberately thin: the pending-write bookkeeping is entirely adapter-
 * internal (e.g. Allegro's own `allegro_quantity_commands` table), so this
 * service only resolves the capability and delegates — mirroring how
 * `OfferStatusSyncService` resolves `OfferStatusReader` per connection.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferQuantityAckReconcileService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferManagerPort, PendingQuantityAckReconcileResult } from '@openlinker/core/listings';
import { isPendingQuantityAckReconciler } from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import type { IOfferQuantityAckReconcileService } from './offer-quantity-ack-reconcile.service.interface';

@Injectable()
export class OfferQuantityAckReconcileService implements IOfferQuantityAckReconcileService {
  private readonly logger = new Logger(OfferQuantityAckReconcileService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async reconcile(
    connectionId: string,
    limit: number
  ): Promise<PendingQuantityAckReconcileResult> {
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isPendingQuantityAckReconciler(adapter)) {
      this.logger.debug(
        `Connection ${connectionId} adapter does not support PendingQuantityAckReconciler; nothing to reconcile`
      );
      return { reconciled: 0, stillPending: 0 };
    }

    return adapter.reconcilePendingQuantityAcks(limit);
  }
}
