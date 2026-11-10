/**
 * Zero-value line declaration (#3930): read off the prototype, so the test needs
 * no transport or credentials.
 */
import { KsefInvoicingAdapter } from '../ksef-invoicing.adapter';

describe('KsefInvoicingAdapter acceptsZeroValueLine', () => {
  it('should declare true', () => {
    expect(KsefInvoicingAdapter.prototype.acceptsZeroValueLine.call({})).toBe(true);
  });
});
