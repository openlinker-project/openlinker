/** Zero-value line declaration (#3930), read off the prototype. */
import { EparagonyFiscalizationAdapter } from '../eparagony-fiscalization.adapter';
import { EparagonyInvoicingAdapter } from '../eparagony-invoicing.adapter';

describe('eparagony acceptsZeroValueLine', () => {
  it.each([
    ['invoicing', EparagonyInvoicingAdapter],
    ['fiscalization', EparagonyFiscalizationAdapter],
  ])('should declare false on the %s adapter (error 41 refuses a zero line)', (_name, adapter) => {
    expect(adapter.prototype.acceptsZeroValueLine.call({})).toBe(false);
  });
});
