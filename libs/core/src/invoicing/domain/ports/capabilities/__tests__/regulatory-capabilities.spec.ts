/**
 * Regulatory clearance capability guards — unit tests (#1143)
 *
 * Covers the segregation contract: `RegulatoryStatusReader` (read half) vs
 * `RegulatoryTransmitter extends RegulatoryStatusReader` (submit + read), and the
 * `is{Capability}` guards that narrow an `InvoicingPort` to each.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities/__tests__
 */
import type { InvoicingPort } from '../../invoicing.port';
import {
  type RegulatoryStatusReader,
  isRegulatoryStatusReader,
} from '../regulatory-status-reader.capability';
import {
  type RegulatoryTransmitter,
  isRegulatoryTransmitter,
} from '../regulatory-transmitter.capability';

// Minimal base `InvoicingPort` with none of the optional regulatory methods.
const base: InvoicingPort = {
  issueInvoice: jest.fn(),
  getInvoice: jest.fn(),
  upsertCustomer: jest.fn(),
  getSupportedDocumentTypes: jest.fn(),
};

describe('isRegulatoryStatusReader', () => {
  it('returns true when the adapter implements getClearanceStatus', () => {
    const reader: InvoicingPort & RegulatoryStatusReader = {
      ...base,
      getClearanceStatus: jest.fn(),
    };
    expect(isRegulatoryStatusReader(reader)).toBe(true);
  });

  it('returns false on a base InvoicingPort without regulatory read-back', () => {
    expect(isRegulatoryStatusReader(base)).toBe(false);
  });

  it('returns true for a full transmitter (a transmitter is always a reader)', () => {
    const transmitter: InvoicingPort & RegulatoryTransmitter = {
      ...base,
      getClearanceStatus: jest.fn(),
      submitForClearance: jest.fn(),
    };
    expect(isRegulatoryStatusReader(transmitter)).toBe(true);
  });
});

describe('isRegulatoryTransmitter', () => {
  it('returns true when the adapter implements submitForClearance', () => {
    const transmitter: InvoicingPort & RegulatoryTransmitter = {
      ...base,
      getClearanceStatus: jest.fn(),
      submitForClearance: jest.fn(),
    };
    expect(isRegulatoryTransmitter(transmitter)).toBe(true);
  });

  it('returns false on a base InvoicingPort', () => {
    expect(isRegulatoryTransmitter(base)).toBe(false);
  });

  it('returns false on a read-only adapter (segregation: a reader is not a transmitter)', () => {
    const reader: InvoicingPort & RegulatoryStatusReader = {
      ...base,
      getClearanceStatus: jest.fn(),
    };
    expect(isRegulatoryTransmitter(reader)).toBe(false);
  });

  it('returns false on a malformed transmitter that submits but cannot read (both methods required)', () => {
    // A transmitter is necessarily also a reader; the guard must not narrow an
    // adapter that exposes only `submitForClearance` (TS forbids it for a typed
    // `implements RegulatoryTransmitter`, but a hand-rolled object could).
    const malformed = { ...base, submitForClearance: jest.fn() } as InvoicingPort;
    expect(isRegulatoryTransmitter(malformed)).toBe(false);
  });
});

describe('guard narrowing', () => {
  it('narrows the reader method on a positive isRegulatoryStatusReader', () => {
    const reader: InvoicingPort & RegulatoryStatusReader = {
      ...base,
      getClearanceStatus: jest.fn(),
    };
    const adapter: InvoicingPort = reader;
    if (isRegulatoryStatusReader(adapter)) {
      // Compiles only because the guard narrowed `adapter` to include the method.
      expect(typeof adapter.getClearanceStatus).toBe('function');
    } else {
      throw new Error('expected the reader to narrow');
    }
  });

  it('narrows BOTH methods on a positive isRegulatoryTransmitter (the extends contract)', () => {
    const transmitter: InvoicingPort & RegulatoryTransmitter = {
      ...base,
      getClearanceStatus: jest.fn(),
      submitForClearance: jest.fn(),
    };
    const adapter: InvoicingPort = transmitter;
    if (isRegulatoryTransmitter(adapter)) {
      expect(typeof adapter.submitForClearance).toBe('function');
      // `extends RegulatoryStatusReader` ⇒ the read method is in scope too.
      expect(typeof adapter.getClearanceStatus).toBe('function');
    } else {
      throw new Error('expected the transmitter to narrow');
    }
  });
});
