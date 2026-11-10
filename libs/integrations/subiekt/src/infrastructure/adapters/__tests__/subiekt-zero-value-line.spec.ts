/** Zero-value line declaration (#3930), read off the prototype. */
import { SubiektFiscalizationAdapter } from '../subiekt-fiscalization.adapter';
import { SubiektInvoicingAdapter } from '../subiekt-invoicing.adapter';

describe('Subiekt GT acceptsZeroValueLine', () => {
  it.each([
    ['invoicing', SubiektInvoicingAdapter],
    ['fiscalization', SubiektFiscalizationAdapter],
  ])('should declare false on the %s adapter', (_name, adapter) => {
    expect(adapter.prototype.acceptsZeroValueLine.call({})).toBe(false);
  });
});
