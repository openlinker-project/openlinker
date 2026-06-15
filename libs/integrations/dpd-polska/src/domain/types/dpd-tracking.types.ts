/**
 * DPD Polska Tracking Types
 *
 * Neutral shapes for the DPD InfoServices `getEventsForWaybillV1` flow (#965,
 * ADR-022). `DpdWaybillEvent` is the post-parse representation of one
 * `<eventsList>` entry; the SOAP client maps the raw XML to it and the
 * tracking mapper folds a list of them into a `TrackingSnapshot`.
 *
 * @module libs/integrations/dpd-polska/src/domain/types
 */

/**
 * One DPD waybill event (a parsed `<eventsList>` entry).
 *
 * `eventTime` is the DPD wire value — an **offset-less** ISO string in
 * `Europe/Warsaw` wall-clock (e.g. `2014-11-26T11:39:39`); the mapper converts
 * it to a proper instant, never `new Date(raw)` directly.
 */
export interface DpdWaybillEvent {
  /** DPD 6-digit `businessCode` (the status code the mapper classifies). */
  businessCode: string;
  /** Offset-less `Europe/Warsaw` timestamp string, when present. */
  eventTime?: string;
  /** Human description, when the response carries one (diagnostics only). */
  description?: string;
  /**
   * Raw `eventDataList/value` strings for this event. For redirect/return codes
   * (`230402` / `230403` / `230408`) the first value is the **new tracking
   * number**; for other events it's incidental (signatory name, etc.). The
   * mapper interprets it per business code — the transport just passes it
   * through. OL keeps polling the original waybill (auto-follow is out of scope
   * for #965 — see ADR-022).
   */
  eventData?: string[];
}

/** `EventsSelectTypeEnum` — full history (vs `ONLY_LAST`). We need history for
 * terminal-precedence + dispatched/delivered timestamps. */
export const DPD_EVENTS_SELECT_ALL = 'ALL';

/** Two-letter description language requested from DPD. */
export const DPD_EVENT_LANGUAGE = 'EN';
