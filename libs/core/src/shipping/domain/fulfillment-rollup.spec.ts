/**
 * Unit tests for deriveFulfillmentRollup (#1108, precedence revised #2727).
 *
 * @module libs/core/src/shipping/domain
 */
import { deriveFulfillmentRollup } from './fulfillment-rollup';

describe('deriveFulfillmentRollup', () => {
  it('should return not-shipped for an order with no shipments', () => {
    expect(deriveFulfillmentRollup([])).toBe('not-shipped');
  });

  it('should return not-shipped when only draft shipments exist', () => {
    expect(deriveFulfillmentRollup(['draft'])).toBe('not-shipped');
    expect(deriveFulfillmentRollup(['draft', 'draft'])).toBe('not-shipped');
  });

  it('should return delivered when every shipment is finished and one delivered', () => {
    expect(deriveFulfillmentRollup(['delivered'])).toBe('delivered');
    expect(deriveFulfillmentRollup(['failed', 'delivered'])).toBe('delivered');
    expect(deriveFulfillmentRollup(['cancelled', 'delivered'])).toBe('delivered');
  });

  // ── #2727: the status half of the precedence fix ───────────────────────────

  /**
   * PRE-#2727 THIS ASSERTED `'delivered'`. The old rule was `any delivered ⇒
   * delivered`, so an order with one parcel delivered and one still in transit
   * reported as fully delivered — the defect #2727 exists to fix. An
   * in-progress shipment now outranks a delivered sibling.
   */
  it('should return dispatched when a delivered parcel has an in-progress sibling', () => {
    expect(deriveFulfillmentRollup(['failed', 'delivered', 'dispatched'])).toBe('dispatched');
    expect(deriveFulfillmentRollup(['delivered', 'in-transit'])).toBe('dispatched');
    expect(deriveFulfillmentRollup(['delivered', 'generated'])).toBe('dispatched');
  });

  // ── #2727: the quantity half ───────────────────────────────────────────────

  /**
   * The status half cannot see this case — every shipment really is finished.
   * Only the line-grain coverage reveals that the order put just some of its
   * units in a parcel.
   */
  it('should demote a fully-terminal delivered order that covers only some units', () => {
    expect(deriveFulfillmentRollup(['delivered'], { ordered: 3, delivered: 1 })).toBe('dispatched');
  });

  it('should stay delivered when coverage accounts for every ordered unit', () => {
    expect(deriveFulfillmentRollup(['delivered'], { ordered: 3, delivered: 3 })).toBe('delivered');
  });

  /**
   * ABSENT coverage means "no line data" — a pre-backfill install, or an order
   * whose snapshot carried no items — and must NEVER read as "zero delivered",
   * which would demote every such order and quietly empty the delivered bucket.
   */
  it('should treat absent coverage as not-known rather than zero', () => {
    expect(deriveFulfillmentRollup(['delivered'])).toBe('delivered');
    expect(deriveFulfillmentRollup(['delivered'], undefined)).toBe('delivered');
  });

  /** An order requiring no units cannot be under-delivered. */
  it('should not demote on a coverage record that accounts for nothing', () => {
    expect(deriveFulfillmentRollup(['delivered'], { ordered: 0, delivered: 0 })).toBe('delivered');
  });

  /**
   * The rule is DEMOTE-ONLY. An over-attributed numerator (each shipment of a
   * line is credited the line's full quantity) can only make `delivered` too
   * LARGE, so it can never promote anything — which is what makes the arm sound
   * despite a lossy numerator.
   */
  it('should never promote a non-delivered order on the strength of coverage', () => {
    expect(deriveFulfillmentRollup(['failed'], { ordered: 2, delivered: 5 })).toBe('failed');
    expect(deriveFulfillmentRollup([], { ordered: 2, delivered: 2 })).toBe('not-shipped');
    expect(deriveFulfillmentRollup(['draft'], { ordered: 2, delivered: 2 })).toBe('not-shipped');
  });

  it('should return dispatched for any in-progress shipment (generated/dispatched/in-transit)', () => {
    expect(deriveFulfillmentRollup(['generated'])).toBe('dispatched');
    expect(deriveFulfillmentRollup(['dispatched'])).toBe('dispatched');
    expect(deriveFulfillmentRollup(['in-transit'])).toBe('dispatched');
    // in-progress wins over a failed/draft sibling
    expect(deriveFulfillmentRollup(['cancelled', 'in-transit'])).toBe('dispatched');
    expect(deriveFulfillmentRollup(['draft', 'generated'])).toBe('dispatched');
  });

  it('should return failed only when every shipment is terminal failed/cancelled', () => {
    expect(deriveFulfillmentRollup(['failed'])).toBe('failed');
    expect(deriveFulfillmentRollup(['cancelled'])).toBe('failed');
    expect(deriveFulfillmentRollup(['failed', 'cancelled'])).toBe('failed');
  });

  it('should not return failed when a non-terminal shipment coexists', () => {
    // a draft alongside a failed re-issue means the order can still ship
    expect(deriveFulfillmentRollup(['failed', 'draft'])).toBe('not-shipped');
  });
});
