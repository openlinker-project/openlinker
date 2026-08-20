import { describe, it, expect } from 'vitest';
import {
  canRetryFiscalReceipt,
  deriveFiscalReceiptDisplayStatus,
} from './derive-fiscal-receipt-display';
import type { FiscalRegistrationRecord } from '../api/fiscalization.types';

function makeRecord(over: Partial<FiscalRegistrationRecord> = {}): FiscalRegistrationRecord {
  return {
    id: 'fr_1',
    connectionId: 'c1',
    orderId: 'o1',
    providerType: 'eparagony',
    idempotencyKey: 'fiscal:c1:o1',
    status: 'registered',
    providerReference: null,
    documentReference: null,
    signingIdentity: null,
    registeredAt: null,
    regimeExtras: null,
    artefacts: null,
    failureMode: null,
    failureReason: null,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...over,
  };
}

describe('deriveFiscalReceiptDisplayStatus', () => {
  it('returns not-registered for no record', () => {
    expect(deriveFiscalReceiptDisplayStatus(null)).toBe('not-registered');
  });

  it('passes through pending/registering/registered unchanged', () => {
    expect(deriveFiscalReceiptDisplayStatus(makeRecord({ status: 'pending' }))).toBe('pending');
    expect(deriveFiscalReceiptDisplayStatus(makeRecord({ status: 'registering' }))).toBe(
      'registering',
    );
    expect(deriveFiscalReceiptDisplayStatus(makeRecord({ status: 'registered' }))).toBe(
      'registered',
    );
  });

  it('maps failed + rejected to rejected', () => {
    const status = deriveFiscalReceiptDisplayStatus(
      makeRecord({ status: 'failed', failureMode: 'rejected' }),
    );
    expect(status).toBe('rejected');
  });

  it('maps failed + in-doubt to in-doubt', () => {
    const status = deriveFiscalReceiptDisplayStatus(
      makeRecord({ status: 'failed', failureMode: 'in-doubt' }),
    );
    expect(status).toBe('in-doubt');
  });

  it('maps failed + null failureMode to in-doubt (the safe default)', () => {
    const status = deriveFiscalReceiptDisplayStatus(
      makeRecord({ status: 'failed', failureMode: null }),
    );
    expect(status).toBe('in-doubt');
  });
});

describe('canRetryFiscalReceipt', () => {
  it('is true only for failed + rejected', () => {
    expect(
      canRetryFiscalReceipt(makeRecord({ status: 'failed', failureMode: 'rejected' })),
    ).toBe(true);
  });

  it('is false for failed + in-doubt', () => {
    expect(
      canRetryFiscalReceipt(makeRecord({ status: 'failed', failureMode: 'in-doubt' })),
    ).toBe(false);
  });

  it('is false for a registered record', () => {
    expect(canRetryFiscalReceipt(makeRecord({ status: 'registered' }))).toBe(false);
  });
});
