/**
 * Regulatory Transmitter Capability — type-guard spec
 *
 * Coverage for `isRegulatoryTransmitter(adapter)`: true only when BOTH
 * `submitForClearance` and `getClearanceStatus` are callable on the
 * `InvoicingPort` adapter, false when either is absent or non-callable, and
 * confirms TypeScript narrows the adapter to `InvoicingPort & RegulatoryTransmitter`
 * past the guard. Mirrors `offer-status-reader` / `category-provisioner` specs.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import { isRegulatoryTransmitter } from './regulatory-transmitter.capability';

function makeAdapter(extra: Record<string, unknown> = {}): InvoicingPort {
  return {
    issueInvoice: jest.fn(),
    getInvoice: jest.fn(),
    upsertCustomer: jest.fn(),
    getSupportedDocumentTypes: jest.fn(),
    ...extra,
  } as unknown as InvoicingPort;
}

describe('isRegulatoryTransmitter', () => {
  it('returns true when both clearance methods are functions', () => {
    const adapter = makeAdapter({
      submitForClearance: jest.fn(),
      getClearanceStatus: jest.fn(),
    });
    expect(isRegulatoryTransmitter(adapter)).toBe(true);
  });

  it('narrows the adapter type past the guard so both methods are callable', () => {
    const submitForClearance = jest.fn();
    const getClearanceStatus = jest.fn();
    const adapter = makeAdapter({ submitForClearance, getClearanceStatus });

    if (isRegulatoryTransmitter(adapter)) {
      // After the guard, TypeScript knows these methods exist (compile-time check).
      void adapter.submitForClearance;
      void adapter.getClearanceStatus;
      expect(typeof adapter.submitForClearance).toBe('function');
      expect(typeof adapter.getClearanceStatus).toBe('function');
    } else {
      throw new Error('guard should have narrowed the adapter');
    }
  });

  it('returns false when neither clearance method is present', () => {
    expect(isRegulatoryTransmitter(makeAdapter())).toBe(false);
  });

  it('returns false when only `submitForClearance` is present', () => {
    expect(isRegulatoryTransmitter(makeAdapter({ submitForClearance: jest.fn() }))).toBe(false);
  });

  it('returns false when only `getClearanceStatus` is present', () => {
    expect(isRegulatoryTransmitter(makeAdapter({ getClearanceStatus: jest.fn() }))).toBe(false);
  });

  it('returns false when a clearance slot exists but is not callable', () => {
    const adapter = makeAdapter({
      submitForClearance: jest.fn(),
      getClearanceStatus: 'not a function',
    });
    expect(isRegulatoryTransmitter(adapter)).toBe(false);
  });
});
