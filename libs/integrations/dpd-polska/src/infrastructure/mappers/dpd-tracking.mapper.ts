/**
 * DPD Tracking Mapper
 *
 * Folds a DPD InfoServices waybill-event history (`DpdWaybillEvent[]`) into a
 * neutral `TrackingSnapshot` (#965, ADR-022). Pure — no I/O.
 *
 * Status derivation (see the plan + `Events`/`Ending statuses` xlsx):
 *  - **Terminal-precedence**: if any event maps to a terminal OL status (core
 *    `TerminalShipmentStatusValues` = delivered/failed/cancelled), the latest
 *    terminal event wins — a parcel doesn't "un-deliver" if a stray later event
 *    arrives, and `failed` after `delivered` ⇒ `failed`.
 *  - Otherwise the latest event (by `eventTime`) decides.
 *  - DPD `businessCode` → OL status by group/prefix; unrecognized codes degrade
 *    to `in-transit` with a `logger.warn`.
 *  - `eventTime` is offset-less `Europe/Warsaw` wall-clock — converted to a true
 *    UTC instant via `parseDpdEventTime`, never `new Date(raw)`.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/mappers
 */
import { Logger } from '@openlinker/shared/logging';
import {
  TerminalShipmentStatusValues,
  type ShipmentStatus,
  type TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { DpdWaybillEvent } from '../../domain/types/dpd-tracking.types';

const logger = new Logger('DpdTrackingMapper');

/** Carrier-of-record for every DPD shipment — DPD Polska self-delivers (no
 * brokerage), so the neutral snapshot always advertises `'dpd'`. Lets the
 * status-sync backfill populate `Shipment.carrier`, mirroring InPost's
 * always-set `'inpost'` (#769). */
const DPD_CARRIER = 'dpd';

const DPD_TIMEZONE = 'Europe/Warsaw';
const REDIRECT_CODE = '230402';
const RETURN_CODES = new Set(['230403', '230408']);
const REGISTERED_CODE = '030103';
const COLLECTED_ABROAD_CODE = '500500';

/** DPD event-group 2-digit prefixes that are legitimately mid-transit (hub,
 * depot, sort, customs, out-for-delivery, undelivered-attempt, notifications,
 * pickup-point). Used to distinguish a known in-transit code from a genuinely
 * unknown one (which warns). */
const IN_TRANSIT_PREFIXES = [
  '05', '11', '12', '15', '16', '17', '20', '21', '23', '25', '26', '32', '33', '37', '41', '45', '50',
];

const TERMINAL = new Set<ShipmentStatus>(TerminalShipmentStatusValues);

interface ClassifiedEvent {
  event: DpdWaybillEvent;
  status: ShipmentStatus;
  instant: number | undefined; // epoch ms, or undefined when eventTime is absent/unparseable
}

/**
 * Classify a single DPD `businessCode` → OL `ShipmentStatus`. `recognized` is
 * false only for codes that match no known rule/group (the caller warns).
 */
export function classifyDpdEventCode(code: string): { status: ShipmentStatus; recognized: boolean } {
  if (code.startsWith('1901') || code.startsWith('1902')) {
    return { status: 'delivered', recognized: true };
  }
  if (RETURN_CODES.has(code)) {
    return { status: 'failed', recognized: true };
  }
  if (code === REDIRECT_CODE) {
    return { status: 'in-transit', recognized: true };
  }
  if (code === REGISTERED_CODE) {
    return { status: 'generated', recognized: true };
  }
  if (code.startsWith('0401') || code === COLLECTED_ABROAD_CODE) {
    return { status: 'dispatched', recognized: true };
  }
  // Failed pickup / reception (parcel never collected) — still pre-dispatch.
  if (code.startsWith('0402') || code.startsWith('0405') || code.startsWith('0406')) {
    return { status: 'generated', recognized: true };
  }
  if (IN_TRANSIT_PREFIXES.includes(code.slice(0, 2))) {
    return { status: 'in-transit', recognized: true };
  }
  return { status: 'in-transit', recognized: false };
}

/**
 * Parse a DPD offset-less `eventTime` (`YYYY-MM-DDTHH:mm:ss(.SSS)?`, interpreted
 * as `Europe/Warsaw` wall-clock) into a UTC `Date`. Returns undefined for a
 * missing/malformed value.
 */
export function parseDpdEventTime(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) {
    return undefined;
  }
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  // Offset the zone applies around this instant (handles CET/CEST DST).
  const offsetMs = warsawOffsetMs(asUtc);
  return new Date(asUtc - offsetMs);
}

/** Europe/Warsaw UTC offset (ms) at the given instant, via Intl (no tz lib). */
function warsawOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: DPD_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return asIfUtc - utcMs;
}

/**
 * Fold an event history into a `TrackingSnapshot`. Empty history → `generated`.
 */
export function toTrackingSnapshot(events: DpdWaybillEvent[]): TrackingSnapshot {
  if (events.length === 0) {
    return { status: 'generated', carrier: DPD_CARRIER };
  }

  const unrecognized = new Set<string>();
  const classified: ClassifiedEvent[] = events.map((event) => {
    const { status, recognized } = classifyDpdEventCode(event.businessCode);
    if (!recognized) {
      unrecognized.add(event.businessCode);
    }
    return { event, status, instant: parseDpdEventTime(event.eventTime)?.getTime() };
  });
  // Warn once per distinct unknown code (not per event) to avoid per-poll spam.
  if (unrecognized.size > 0) {
    logger.warn(
      `DPD InfoServices: unrecognized businessCode(s) [${[...unrecognized].join(', ')}] — defaulting to in-transit`,
    );
  }

  // Stable chronological order (events without a parsable time keep input order).
  const ordered = classified
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      if (a.c.instant !== undefined && b.c.instant !== undefined) {
        return a.c.instant - b.c.instant || a.index - b.index;
      }
      if (a.c.instant === undefined && b.c.instant === undefined) {
        return a.index - b.index;
      }
      return a.c.instant === undefined ? -1 : 1; // undefined-time events sort earliest
    })
    .map((x) => x.c);

  const terminalEvents = ordered.filter((c) => TERMINAL.has(c.status));
  const selected = terminalEvents.length > 0 ? terminalEvents[terminalEvents.length - 1] : ordered[ordered.length - 1];

  const dispatchedEvent = ordered.find((c) => c.status === 'dispatched');

  // Redirect: parcel moved to a new waybill; OL keeps polling the old one (stall).
  if (selected.event.businessCode === REDIRECT_CODE) {
    const newWaybill = selected.event.eventData?.[0];
    logger.warn(
      `DPD redirected waybill → ${newWaybill ?? 'unknown'}; OL keeps polling the original — auto-follow is out of scope (#965/ADR-022)`,
    );
  }

  const snapshot: TrackingSnapshot = {
    status: selected.status,
    providerStatus: selected.event.businessCode,
    carrier: DPD_CARRIER,
  };
  // deliveredAt only when the snapshot is actually delivered — `selected` is the
  // delivered terminal in that case. A return-after-delivery resolves to
  // `failed`, where a deliveredAt would be semantically muddy for #838.
  if (selected.status === 'delivered') {
    const deliveredAt = parseDpdEventTime(selected.event.eventTime);
    if (deliveredAt) {
      snapshot.deliveredAt = deliveredAt;
    }
  }
  // dispatchedAt reflects pickup regardless of final status (it was dispatched).
  const dispatchedAt = dispatchedEvent && parseDpdEventTime(dispatchedEvent.event.eventTime);
  if (dispatchedAt) {
    snapshot.dispatchedAt = dispatchedAt;
  }
  return snapshot;
}
