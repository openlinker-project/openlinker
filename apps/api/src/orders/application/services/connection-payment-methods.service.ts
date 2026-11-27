/**
 * Connection Payment Methods Service (#3774)
 *
 * Discovery read behind the operator's payment-method map: composes OL's own
 * observed identifiers (`orders`) with the connection's adapter (`integrations`),
 * so it lives in the host interface layer like `SourceFulfillmentStatusService`.
 *
 * Classification goes through the SAME resolver ingestion uses
 * (`resolveSourcePaymentMethod`), so what is reported is what is written.
 * A failed orders read is a 5xx - an empty list there would read as "no
 * gateways seen" - while an unresolvable adapter only degrades `mapSupport`.
 *
 * @module apps/api/src/orders/application/services
 * @implements {IConnectionPaymentMethodsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  IOrderRecordService,
  ORDER_RECORD_SERVICE_TOKEN,
  isPlatformPaymentMethodClassifier,
  readPaymentMethodMap,
  resolveSourcePaymentMethod,
  type OrderSourcePort,
  type PlatformPaymentMethodClassifier,
} from '@openlinker/core/orders';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import type { IConnectionPaymentMethodsService } from '../interfaces/connection-payment-methods.service.interface';
import type {
  ConnectionPaymentMethodsView,
  PaymentMethodMapSupport,
} from '../types/connection-payment-methods.types';

const WINDOW_DAYS = 90;
const MAX_ITEMS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ConnectionPaymentMethodsService implements IConnectionPaymentMethodsService {
  private readonly logger = new Logger(ConnectionPaymentMethodsService.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService
  ) {}

  async listObserved(connectionId: string): Promise<ConnectionPaymentMethodsView> {
    let connection: Connection | null = null;
    try {
      connection = (await this.integrations.getAdapter(connectionId)).connection;
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        throw error;
      }
      this.logger.warn(
        `payment_methods_connection_unresolved: ${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
    const observed = await this.orderRecords.listObservedSourcePaymentMethods(
      connectionId,
      since,
      MAX_ITEMS
    );

    const { mapSupport, classifier } = await this.resolveClassifier(connectionId, connection);
    const map = readPaymentMethodMap(connection?.config);

    const items = observed.map((row) => {
      if (classifier === null) {
        return {
          ...row,
          platformMethod: null,
          operatorMethod: null,
          resolvedMethod: null,
          resolvedBy: null,
        };
      }
      const platformMethod = classifier.classifyPlatformPaymentMethod(row.sourcePaymentMethod);
      const resolved = resolveSourcePaymentMethod({
        platformMethod,
        sourcePaymentMethod: row.sourcePaymentMethod,
        map,
      });
      return {
        ...row,
        platformMethod,
        operatorMethod: map.get(row.sourcePaymentMethod) ?? null,
        resolvedMethod: resolved.method,
        resolvedBy: resolved.resolvedBy,
      };
    });

    return { mapSupport, windowDays: WINDOW_DAYS, items };
  }

  private async resolveClassifier(
    connectionId: string,
    connection: Connection | null
  ): Promise<{
    mapSupport: PaymentMethodMapSupport;
    classifier: PlatformPaymentMethodClassifier | null;
  }> {
    if (connection === null) {
      return { mapSupport: 'unknown', classifier: null };
    }
    try {
      const adapter = await this.integrations.getCapabilityAdapter<OrderSourcePort>(
        connectionId,
        'OrderSource'
      );
      if (!isPlatformPaymentMethodClassifier(adapter)) {
        return { mapSupport: 'unsupported', classifier: null };
      }
      return { mapSupport: 'supported', classifier: adapter };
    } catch (error) {
      this.logger.warn(
        `payment_methods_adapter_unresolved: ${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { mapSupport: 'unknown', classifier: null };
    }
  }
}
