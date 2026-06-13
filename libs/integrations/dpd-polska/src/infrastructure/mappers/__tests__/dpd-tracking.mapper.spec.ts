/**
 * DPD Tracking Mapper — unit tests
 *
 * Covers event-code classification, the offset-less Europe/Warsaw timestamp
 * parse, and the terminal-precedence snapshot fold (#965).
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/mappers
 */
import type { DpdWaybillEvent } from '../../../domain/types/dpd-tracking.types';
import {
  classifyDpdEventCode,
  parseDpdEventTime,
  toTrackingSnapshot,
} from '../dpd-tracking.mapper';

describe('classifyDpdEventCode', () => {
  it.each([
    ['030103', 'generated'],
    ['040101', 'dispatched'],
    ['500500', 'dispatched'],
    ['040200', 'generated'], // failed pickup / reception → pre-dispatch
    ['050101', 'in-transit'],
    ['170101', 'in-transit'],
    ['200201', 'in-transit'], // undelivered attempt (non-terminal)
    ['190101', 'delivered'],
    ['190204', 'delivered'],
    ['230403', 'failed'], // return to sender
    ['230408', 'failed'],
    ['230402', 'in-transit'], // redirect
  ])('maps %s → %s (recognized)', (code, expected) => {
    const result = classifyDpdEventCode(code);
    expect(result.status).toBe(expected);
    expect(result.recognized).toBe(true);
  });

  it('degrades a genuinely unknown code to in-transit (unrecognized)', () => {
    expect(classifyDpdEventCode('999999')).toEqual({ status: 'in-transit', recognized: false });
  });
});

describe('parseDpdEventTime', () => {
  it('parses an offset-less timestamp as Europe/Warsaw summer time (CEST, +02:00)', () => {
    // 2026-06-11 14:30 Warsaw (CEST) = 12:30 UTC.
    expect(parseDpdEventTime('2026-06-11T14:30:00')?.toISOString()).toBe('2026-06-11T12:30:00.000Z');
  });

  it('parses winter time as CET (+01:00)', () => {
    // 2026-01-08 11:18:52 Warsaw (CET) = 10:18:52 UTC.
    expect(parseDpdEventTime('2026-01-08T11:18:52.122')?.toISOString()).toBe('2026-01-08T10:18:52.000Z');
  });

  it('returns undefined for missing/malformed input', () => {
    expect(parseDpdEventTime(undefined)).toBeUndefined();
    expect(parseDpdEventTime('not-a-date')).toBeUndefined();
  });
});

describe('toTrackingSnapshot', () => {
  it('returns generated for an empty history', () => {
    expect(toTrackingSnapshot([])).toEqual({ status: 'generated' });
  });

  it('takes the latest non-terminal event by time, regardless of input order', () => {
    const events: DpdWaybillEvent[] = [
      { businessCode: '170101', eventTime: '2026-06-11T10:00:00' }, // out for delivery
      { businessCode: '040101', eventTime: '2026-06-10T08:00:00' }, // collected (earlier)
    ];
    const snap = toTrackingSnapshot(events);
    expect(snap.status).toBe('in-transit');
    expect(snap.providerStatus).toBe('170101');
    expect(snap.dispatchedAt?.toISOString()).toBe('2026-06-10T06:00:00.000Z');
  });

  it('lets a terminal delivered win even when a later non-terminal event exists', () => {
    const events: DpdWaybillEvent[] = [
      { businessCode: '190101', eventTime: '2026-06-11T14:30:00' }, // delivered
      { businessCode: '170304', eventTime: '2026-06-11T15:00:00' }, // later notification
    ];
    const snap = toTrackingSnapshot(events);
    expect(snap.status).toBe('delivered');
    expect(snap.deliveredAt?.toISOString()).toBe('2026-06-11T12:30:00.000Z');
  });

  it('prefers the latest terminal when both delivered and failed are present (failed-after-delivered)', () => {
    const events: DpdWaybillEvent[] = [
      { businessCode: '190101', eventTime: '2026-06-11T09:00:00' },
      { businessCode: '230403', eventTime: '2026-06-12T09:00:00' }, // return — later terminal
    ];
    expect(toTrackingSnapshot(events).status).toBe('failed');
  });

  it('handles a single event (no array collapse assumptions)', () => {
    expect(toTrackingSnapshot([{ businessCode: '190101', eventTime: '2026-06-11T14:30:00' }]).status).toBe(
      'delivered',
    );
  });

  it('maps a redirect to in-transit (new waybill is captured in eventData)', () => {
    const snap = toTrackingSnapshot([
      { businessCode: '230402', eventTime: '2026-06-11T10:00:00', eventData: ['0000010923567L'] },
    ]);
    expect(snap.status).toBe('in-transit');
    expect(snap.providerStatus).toBe('230402');
  });
});
