/**
 * Unit tests for the shipment-line capacity rule (#2727).
 *
 * `checkShipmentLineCapacity` is the pure twin of `CHK_shipment_lines_capacity`.
 * These cases pin the clauses that ARE asserted and, just as importantly, the
 * two that are deliberately absent — a later reader tightening either would
 * break ordinary operation in a way only a best-effort catch would report.
 *
 * @module libs/core/src/shipping/domain/types
 */
import { checkShipmentLineCapacity, netShippedQuantity } from './shipment-line.types';

const line = (over: Partial<Parameters<typeof checkShipmentLineCapacity>[0]> = {}) => ({
  quantity: 5,
  shippedQuantity: 0,
  deliveredQuantity: 0,
  cancelledQuantity: 0,
  ...over,
});

describe('checkShipmentLineCapacity', () => {
  it('should accept a freshly created line with no acts', () => {
    expect(checkShipmentLineCapacity(line())).toBe(true);
  });

  it('should accept a fully shipped, delivered line', () => {
    expect(
      checkShipmentLineCapacity(line({ shippedQuantity: 5, deliveredQuantity: 5 })),
    ).toBe(true);
  });

  it('should reject a negative counter', () => {
    expect(checkShipmentLineCapacity(line({ shippedQuantity: -1 }))).toBe(false);
    expect(checkShipmentLineCapacity(line({ deliveredQuantity: -1 }))).toBe(false);
    expect(checkShipmentLineCapacity(line({ cancelledQuantity: -1 }))).toBe(false);
    expect(checkShipmentLineCapacity(line({ quantity: -1 }))).toBe(false);
  });

  it('should reject delivering more than was shipped', () => {
    expect(
      checkShipmentLineCapacity(line({ shippedQuantity: 2, deliveredQuantity: 3 })),
    ).toBe(false);
  });

  it('should reject cancelling more than was shipped', () => {
    expect(
      checkShipmentLineCapacity(line({ shippedQuantity: 2, cancelledQuantity: 3 })),
    ).toBe(false);
  });

  it('should reject a non-integer counter', () => {
    expect(checkShipmentLineCapacity(line({ shippedQuantity: 1.5 }))).toBe(false);
  });

  // ── The two clauses deliberately ABSENT ────────────────────────────────────

  /**
   * Re-ingestion rewrites `orderSnapshot` wholesale, and a dispatch retry
   * reuses one shipment row (`failed → generated → dispatched`), so a shipped
   * total above the frozen `quantity` happens in ordinary operation. Asserting
   * `shippedQuantity <= quantity` would raise inside the best-effort reconcile
   * and silently stop the read model converging for that order.
   */
  it('should ACCEPT a shipped total above the recorded quantity', () => {
    expect(checkShipmentLineCapacity(line({ quantity: 2, shippedQuantity: 4 }))).toBe(true);
    expect(
      checkShipmentLineCapacity(line({ quantity: 2, shippedQuantity: 4, cancelledQuantity: 2 })),
    ).toBe(true);
  });

  /**
   * A delivered shipment later cancelled is refused in the application
   * (`ShipmentNotCancellableException`), but if it ever happened the honest
   * record is "delivered AND reversed" rather than a row the database refuses.
   */
  it('should ACCEPT delivered units on a fully reversed line', () => {
    expect(
      checkShipmentLineCapacity(
        line({ shippedQuantity: 2, deliveredQuantity: 2, cancelledQuantity: 2 }),
      ),
    ).toBe(true);
  });
});

describe('netShippedQuantity', () => {
  it('should subtract reversals from shipments', () => {
    expect(netShippedQuantity(line({ shippedQuantity: 4, cancelledQuantity: 2 }))).toBe(2);
  });

  /**
   * The cancel-and-reissue case the event-shaped backfill exists for: a
   * cancelled attempt nets to zero, so a reissue does not double-count.
   */
  it('should net a cancelled attempt to zero', () => {
    expect(netShippedQuantity(line({ shippedQuantity: 2, cancelledQuantity: 2 }))).toBe(0);
  });

  it('should never go negative for any line the capacity rule accepts', () => {
    const accepted = [
      line({ shippedQuantity: 5, cancelledQuantity: 5 }),
      line({ shippedQuantity: 3, cancelledQuantity: 1 }),
      line({ quantity: 2, shippedQuantity: 4, cancelledQuantity: 2 }),
    ];
    for (const candidate of accepted) {
      expect(checkShipmentLineCapacity(candidate)).toBe(true);
      expect(netShippedQuantity(candidate)).toBeGreaterThanOrEqual(0);
    }
  });
});
