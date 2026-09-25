import { describe, expect, it } from 'vitest';

import { cancelShipmentCopy } from './cancel-shipment-copy';

describe('cancelShipmentCopy', () => {
  it('always says what voiding the label does, and names the carrier', () => {
    const copy = cancelShipmentCopy('generated', 'InPost');
    expect(copy.effect).toContain('InPost');
    expect(copy.effect).toContain('cannot be undone');
  });

  // Before dispatch nobody outside OpenLinker has been told anything, so
  // there is nothing outstanding - and inventing a warning there would train
  // an operator to read past the one that matters.
  it('reports nothing outstanding before dispatch', () => {
    for (const status of ['draft', 'generated'] as const) {
      expect(cancelShipmentCopy(status, 'InPost').alsoOutstanding).toBeNull();
    }
  });

  // The whole point: the channel was told the parcel shipped and OpenLinker
  // sends nothing to withdraw that, so the operator has to.
  it('warns that the channel has already been told, and that OpenLinker will not take it back', () => {
    const copy = cancelShipmentCopy('dispatched', 'InPost');
    expect(copy.alsoOutstanding).not.toBeNull();
    expect(copy.alsoOutstanding).toContain('cannot take that back');
    expect(copy.alsoOutstanding).toContain('tell the channel yourself');
  });

  // The warning must not claim OpenLinker did something it did not. It says
  // the channel was told; it must never say the shipment was un-told, or that
  // the customer's order was cancelled.
  it('never claims the notification was withdrawn or the order cancelled', () => {
    const copy = cancelShipmentCopy('dispatched', 'InPost');
    expect(copy.alsoOutstanding).not.toMatch(/withdrawn|order (has been )?cancelled/i);
  });
});
