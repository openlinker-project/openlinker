/**
 * Source Fulfillment Status Service
 *
 * Composes "what does the SOURCE marketplace say about this order right now"
 * (#3365) from three existing seams: the order record, its source-side
 * identifier mapping, and the connection's own `OrderSource` adapter narrowed
 * to `OrderFulfillmentReadback`.
 *
 * ## Why it lives in `apps/api` and not in `libs/core`
 *
 * It composes an `orders` read with an `integrations` adapter resolution, which
 * is exactly the `RateLimitStatusService` / `AuthorityStatusService` shape: the
 * host's interface layer already has both, and putting it in `libs/core/orders`
 * would be a fourth trust-shaped context for one read surface.
 *
 * ## It never throws for a marketplace-side condition
 *
 * An unreachable source, a source with no readback at all, and an order that
 * carries no external id are three DIFFERENT states on the returned view, and
 * each has a different operator action. Reporting any of them as a 5xx would
 * tell an operator that OpenLinker is broken when the honest answer is "we
 * asked and got nothing" or "there is nothing to ask". The only throw is
 * `OrderRecordNotFoundException`, which the controller maps to a 404.
 *
 * @module apps/api/src/orders/application/services
 * @implements {ISourceFulfillmentStatusService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  IOrderRecordService,
  ORDER_RECORD_SERVICE_TOKEN,
  OrderRecordNotFoundException,
  isOrderFulfillmentReadback,
  unsupportedSourceFulfillmentReadback,
  unavailableSourceFulfillmentReadback,
  type OrderSourcePort,
} from '@openlinker/core/orders';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import type { ISourceFulfillmentStatusService } from '../interfaces/source-fulfillment-status.service.interface';
import type { SourceFulfillmentStatusView } from '../types/source-fulfillment-status.types';

@Injectable()
export class SourceFulfillmentStatusService implements ISourceFulfillmentStatusService {
  private readonly logger = new Logger(SourceFulfillmentStatusService.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService
  ) {}

  async read(internalOrderId: string): Promise<SourceFulfillmentStatusView> {
    const record = await this.orderRecords.getOrderRecord(internalOrderId);
    if (!record) {
      throw new OrderRecordNotFoundException(internalOrderId);
    }

    const sourceConnectionId = record.sourceConnectionId;
    const readAt = new Date().toISOString();
    const sourceConnectionName = await this.resolveConnectionName(sourceConnectionId);

    const externalOrderId = await this.resolveExternalOrderId(internalOrderId, sourceConnectionId);
    if (externalOrderId === null) {
      // An OpenLinker-side fact, deliberately NOT folded into `unavailable`:
      // nothing was asked, because there was nothing to ask about.
      return {
        internalOrderId,
        sourceConnectionId,
        sourceConnectionName,
        externalOrderId: null,
        readback: null,
        unmappedReason: 'no-source-mapping',
        readAt,
      };
    }

    const readback = await this.readFromSource(sourceConnectionId, externalOrderId);
    return {
      internalOrderId,
      sourceConnectionId,
      sourceConnectionName,
      externalOrderId,
      readback,
      unmappedReason: null,
      readAt,
    };
  }

  /**
   * Resolve the source-native order id.
   *
   * Scoped to the order's OWN source connection: an order can legitimately
   * carry destination-side mappings too, and asking a destination about a
   * source's fulfilment would answer a different question with a
   * confident-looking number.
   */
  private async resolveExternalOrderId(
    internalOrderId: string,
    sourceConnectionId: string
  ): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      internalOrderId
    );
    const match = mappings.find((m) => m.connectionId === sourceConnectionId);
    return match?.externalId ?? null;
  }

  private async readFromSource(
    connectionId: string,
    externalOrderId: string
  ): Promise<SourceFulfillmentStatusView['readback']> {
    let adapter: OrderSourcePort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<OrderSourcePort>(
        connectionId,
        'OrderSource'
      );
    } catch (error) {
      // A disabled connection, a credential failure, or no OrderSource at all.
      // Transient from the operator's point of view - the remedy is to fix the
      // connection - so it is `unavailable`, not `unsupported`.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `source_fulfillment_adapter_unresolved: could not resolve an OrderSource for connection ${connectionId}: ${message}`
      );
      return unavailableSourceFulfillmentReadback(
        'The order source could not be resolved - check the connection is active and its credentials are valid.'
      );
    }

    if (!isOrderFulfillmentReadback(adapter)) {
      return unsupportedSourceFulfillmentReadback(
        'This marketplace does not report an order’s fulfilment back to OpenLinker.'
      );
    }

    // The capability's own contract forbids throwing for a marketplace-side
    // condition, but this is a read surface and an out-of-tree adapter is not
    // bound by a docblock - a throw here would be a 500 for a momentarily
    // unreachable marketplace.
    try {
      return await adapter.readFulfillment({ externalOrderId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `source_fulfillment_readback_threw: ${connectionId} raised instead of reporting an outcome: ${message}`
      );
      return unavailableSourceFulfillmentReadback('The order source did not answer.');
    }
  }

  /**
   * Metadata-only lookup - `getAdapter` constructs no adapter instance and
   * resolves no credentials. A failure degrades to `null` rather than costing
   * the whole read: the name is a convenience for the surface, never part of
   * the answer, and a disabled connection throws here while still having a
   * perfectly readable id.
   */
  private async resolveConnectionName(connectionId: string): Promise<string | null> {
    try {
      const { connection } = await this.integrations.getAdapter(connectionId);
      return connection.name ?? null;
    } catch {
      return null;
    }
  }
}
