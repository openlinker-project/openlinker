/**
 * Connection Payment Methods Service Interface (#3774)
 *
 * @module apps/api/src/orders/application/interfaces
 */
import type { ConnectionPaymentMethodsView } from '../types/connection-payment-methods.types';

export const CONNECTION_PAYMENT_METHODS_SERVICE_TOKEN = Symbol('IConnectionPaymentMethodsService');

export interface IConnectionPaymentMethodsService {
  /**
   * The payment identifiers the connection's recent orders carried, each with
   * how the platform and the operator's map would classify it. Throws only
   * `ConnectionNotFoundException` (404); an unreachable adapter is reported as
   * `mapSupport: 'unknown'`, with the observed identifiers still returned.
   */
  listObserved(connectionId: string): Promise<ConnectionPaymentMethodsView>;
}
