/**
 * Offline Resubmitter Capability — type-guard spec
 *
 * Coverage for `isOfflineResubmitter(adapter)`: true only when `resubmit` is
 * callable on the `InvoicingPort` adapter, false when it is absent or not a
 * function, and confirms TypeScript narrows the adapter to
 * `InvoicingPort & OfflineResubmitter` past the guard.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import { isOfflineResubmitter } from './offline-resubmitter.capability';

function makeAdapter(extra: Record<string, unknown> = {}): InvoicingPort {
  return {
    issueInvoice: jest.fn(),
    getInvoice: jest.fn(),
    upsertCustomer: jest.fn(),
    getSupportedDocumentTypes: jest.fn(),
    ...extra,
  } as unknown as InvoicingPort;
}

describe('isOfflineResubmitter', () => {
  it('returns true when `resubmit` is a function', () => {
    expect(isOfflineResubmitter(makeAdapter({ resubmit: jest.fn() }))).toBe(true);
  });

  it('narrows the adapter type past the guard so `resubmit` is callable', () => {
    const resubmit = jest.fn();
    const adapter = makeAdapter({ resubmit });

    if (isOfflineResubmitter(adapter)) {
      void adapter.resubmit;
      expect(typeof adapter.resubmit).toBe('function');
    } else {
      throw new Error('guard should have narrowed the adapter');
    }
  });

  it('returns false when `resubmit` is absent', () => {
    expect(isOfflineResubmitter(makeAdapter())).toBe(false);
  });

  it('returns false when a `resubmit` slot exists but is not callable', () => {
    expect(isOfflineResubmitter(makeAdapter({ resubmit: 'not a function' }))).toBe(false);
  });
});
