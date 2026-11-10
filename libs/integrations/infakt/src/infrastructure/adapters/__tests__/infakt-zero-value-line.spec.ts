/**
 * Zero-value line declaration (#3930): read off the prototype, so the test needs
 * no transport or credentials.
 */
import { InfaktInvoicingAdapter } from '../infakt-invoicing.adapter';

describe('InfaktInvoicingAdapter acceptsZeroValueLine', () => {
  it('should declare true', () => {
    expect(InfaktInvoicingAdapter.prototype.acceptsZeroValueLine.call({})).toBe(true);
  });
});
