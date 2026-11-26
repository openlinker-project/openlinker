/**
 * Mirakl Source Options
 *
 * The `SourceOptionsReader` half of the Mirakl order source (#4276): the
 * values the mapping screens offer for orders from this operator.
 *
 * - Delivery methods come live from SH12 (`GET /api/shipping/types`), keyed by
 *   the same `code` the order mapper writes to `shipping.methodId`. On Empik
 *   that includes `STORE` (delivery to an Empik store) and `DIGITAL`.
 * - Order statuses are Mirakl's fixed order states; there is no endpoint.
 * - Payment methods are the two the order mapper derives: the operator takes
 *   payment online, or the carrier collects it (`*_POD` shipping types).
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {SourceOptionsReader}
 */
import type { MappingOption, SourceOptionsReader } from '@openlinker/core/orders';
import {
  MiraklOrderStateValues,
  type MiraklShippingType,
} from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';

const SHIPPING_TYPES_PATH = '/api/shipping/types';

const ORDER_STATE_LABELS: Readonly<Record<string, string>> = {
  STAGING: 'Staging (fraud check)',
  WAITING_ACCEPTANCE: 'Waiting for acceptance',
  WAITING_DEBIT: 'Waiting for debit',
  WAITING_DEBIT_PAYMENT: 'Waiting for payment',
  SHIPPING: 'To ship',
  SHIPPED: 'Shipped',
  TO_COLLECT: 'Waiting at pickup point',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  REFUSED: 'Refused',
  CANCELED: 'Cancelled',
};

export class MiraklSourceOptions implements SourceOptionsReader {
  constructor(private readonly httpClient: IMiraklHttpClient) {}

  listOrderStatuses(): Promise<MappingOption[]> {
    return Promise.resolve(
      MiraklOrderStateValues.map((state) => ({
        value: state,
        label: ORDER_STATE_LABELS[state] ?? state,
      }))
    );
  }

  async listDeliveryMethods(): Promise<MappingOption[]> {
    const { data } = await this.httpClient.get<{ shipping_types?: readonly MiraklShippingType[] }>(
      SHIPPING_TYPES_PATH
    );
    const options: MappingOption[] = [];
    const seen = new Set<string>();
    for (const type of data?.shipping_types ?? []) {
      if (!type.code || seen.has(type.code)) continue;
      seen.add(type.code);
      options.push({ value: type.code, label: type.label?.trim() || type.code });
    }
    return options;
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return Promise.resolve([
      { value: 'online', label: 'Online payment' },
      { value: 'cash_on_delivery', label: 'Cash on delivery' },
    ]);
  }
}
