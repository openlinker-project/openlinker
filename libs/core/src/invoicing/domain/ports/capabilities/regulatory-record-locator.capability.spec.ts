/**
 * Regulatory Record Locator Capability — type-guard spec
 *
 * Coverage for `isRegulatoryRecordLocator(adapter)`: true only when
 * `locateByQuery` is callable on the `InvoicingPort` adapter, false when it is
 * absent or not a function, and confirms TypeScript narrows the adapter to
 * `InvoicingPort & RegulatoryRecordLocator` past the guard.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import { isRegulatoryRecordLocator } from './regulatory-record-locator.capability';

function makeAdapter(extra: Record<string, unknown> = {}): InvoicingPort {
  return {
    issueInvoice: jest.fn(),
    getInvoice: jest.fn(),
    upsertCustomer: jest.fn(),
    getSupportedDocumentTypes: jest.fn(),
    ...extra,
  } as unknown as InvoicingPort;
}

describe('isRegulatoryRecordLocator', () => {
  it('returns true when `locateByQuery` is a function', () => {
    expect(isRegulatoryRecordLocator(makeAdapter({ locateByQuery: jest.fn() }))).toBe(true);
  });

  it('narrows the adapter type past the guard so `locateByQuery` is callable', () => {
    const locateByQuery = jest.fn();
    const adapter = makeAdapter({ locateByQuery });

    if (isRegulatoryRecordLocator(adapter)) {
      void adapter.locateByQuery;
      expect(typeof adapter.locateByQuery).toBe('function');
    } else {
      throw new Error('guard should have narrowed the adapter');
    }
  });

  it('returns false when `locateByQuery` is absent', () => {
    expect(isRegulatoryRecordLocator(makeAdapter())).toBe(false);
  });

  it('returns false when a `locateByQuery` slot exists but is not callable', () => {
    expect(isRegulatoryRecordLocator(makeAdapter({ locateByQuery: 42 }))).toBe(false);
  });
});
