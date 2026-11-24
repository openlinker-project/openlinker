/**
 * Zero-value line declaration (#3930): read off the prototype, so the test needs
 * no transport or credentials.
 */
import { SubiektInvoicingAdapter } from '../subiekt-invoicing.adapter';

describe('SubiektInvoicingAdapter acceptsZeroValueLine', () => {
  it('should declare false', () => {
    expect(SubiektInvoicingAdapter.prototype.acceptsZeroValueLine.call({})).toBe(false);
  });
});
