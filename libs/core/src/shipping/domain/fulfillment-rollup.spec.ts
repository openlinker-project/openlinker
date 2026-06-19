/**
 * Unit tests for deriveFulfillmentRollup (#1108).
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

  it('should return delivered when any shipment is delivered (highest precedence)', () => {
    expect(deriveFulfillmentRollup(['delivered'])).toBe('delivered');
    // delivered wins over an in-progress sibling and a failed sibling
    expect(deriveFulfillmentRollup(['failed', 'delivered', 'dispatched'])).toBe('delivered');
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
