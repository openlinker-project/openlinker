/**
 * Connection Diagnostics Service Interface
 *
 * @module apps/api/src/integrations/application/interfaces
 */
import type { ConnectionDiagnosticsReads } from '../types/connection-diagnostics.types';

export const CONNECTION_DIAGNOSTICS_SERVICE_TOKEN = Symbol('IConnectionDiagnosticsService');

export interface IConnectionDiagnosticsService {
  /**
   * Read one connection's recent activity across all three sources (sync jobs,
   * fiscal registrations, invoices), degrading per source rather than as a
   * block (#3179). Never calls a destination platform.
   *
   * @throws if the connection does not exist — the only failure that fails the
   *   whole read, because there is nothing to report diagnostics about.
   */
  getDiagnostics(connectionId: string): Promise<ConnectionDiagnosticsReads>;
}
