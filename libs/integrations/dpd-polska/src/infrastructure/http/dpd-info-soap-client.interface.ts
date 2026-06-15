/**
 * DPD InfoServices SOAP Client Port
 *
 * Narrow transport contract for the DPD InfoServices `getEventsForWaybillV1`
 * SOAP operation (#965, ADR-022). Keeping it an interface (not the concrete
 * client) lets the adapter + its unit specs mock tracking without a real
 * `fetch`/SOAP round-trip, per engineering-standards §"Interface and
 * Implementation Separation".
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/http
 */
import type { DpdWaybillEvent } from '../../domain/types/dpd-tracking.types';

export interface IDpdInfoSoapClient {
  /**
   * Fetch the full event history for one waybill (`eventsSelectType=ALL`).
   * Returns the parsed events (possibly empty); throws `DpdUnauthorizedException`
   * on auth failure, `DpdTrackingException` on a SOAP fault / unparseable body,
   * `DpdNetworkException` on exhausted transient retries.
   */
  getEventsForWaybill(input: { waybill: string }): Promise<DpdWaybillEvent[]>;
}
