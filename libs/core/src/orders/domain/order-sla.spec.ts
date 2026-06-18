/**
 * Unit tests for deriveSlaState (#1108).
 *
 * @module libs/core/src/orders/domain
 */
import { deriveSlaState } from './order-sla';
import { SLA_AT_RISK_WINDOW_MS } from './types/order-sla.types';

describe('deriveSlaState', () => {
  const now = new Date('2026-06-18T12:00:00.000Z');
  const future = (ms: number): Date => new Date(now.getTime() + ms);
  const past = (ms: number): Date => new Date(now.getTime() - ms);

  it('should return none when the order has already shipped (dispatched)', () => {
    // even with an overdue deadline, a shipped order carries no SLA pressure
    expect(deriveSlaState(past(60_000), 'dispatched', now)).toBe('none');
  });

  it('should return none when the order has already shipped (delivered)', () => {
    expect(deriveSlaState(past(60_000), 'delivered', now)).toBe('none');
  });

  it('should return none when there is no ship-by deadline', () => {
    expect(deriveSlaState(null, 'not-shipped', now)).toBe('none');
    expect(deriveSlaState(null, null, now)).toBe('none');
  });

  it('should return overdue when the deadline has passed and not shipped', () => {
    expect(deriveSlaState(past(1), 'not-shipped', now)).toBe('overdue');
    // NULL fulfillment is treated as not-shipped
    expect(deriveSlaState(past(1), null, now)).toBe('overdue');
    // a failed shipment does not clear SLA pressure (still needs dispatch)
    expect(deriveSlaState(past(1), 'failed', now)).toBe('overdue');
  });

  it('should return overdue exactly at the deadline (deadline <= now)', () => {
    expect(deriveSlaState(new Date(now), 'not-shipped', now)).toBe('overdue');
  });

  it('should return at_risk when the deadline is within the at-risk window', () => {
    expect(deriveSlaState(future(60_000), 'not-shipped', now)).toBe('at_risk');
    expect(deriveSlaState(future(SLA_AT_RISK_WINDOW_MS), 'not-shipped', now)).toBe('at_risk');
  });

  it('should return on_track when the deadline is beyond the at-risk window', () => {
    expect(deriveSlaState(future(SLA_AT_RISK_WINDOW_MS + 1), 'not-shipped', now)).toBe('on_track');
  });
});
