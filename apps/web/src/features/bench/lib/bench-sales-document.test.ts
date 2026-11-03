/**
 * Which sales-document card the bench shows (#3647)
 *
 * The rule every surface of the documents panel reads. The two properties that
 * matter most: a document that exists is never reported missing, and a value
 * this build does not know is never read as missing either.
 */
import { describe, expect, it } from 'vitest';

import type { BenchDocuments, BenchSalesDocument } from '../api/bench-parcel.types';
import {
  BENCH_DOCUMENTS_IN_PROGRESS_REFETCH_MS,
  BENCH_DOCUMENTS_UNSETTLED_REFETCH_MS,
  benchDocumentsRefetchInterval,
  describeBenchDocumentCard,
  selectReceiptHandover,
} from './bench-sales-document';

const LABEL = {
  state: 'ready',
  shipmentId: 'ol_shipment_1',
  carrier: 'inpost',
  trackingNumber: '620012345678',
  providerCode: null,
  carrierMessage: null,
  carrierMessageRedacted: false,
  failedAt: null,
} as const;

function receipt(over: Partial<BenchSalesDocument> = {}): BenchSalesDocument {
  return {
    kind: 'fiscal-receipt',
    recordId: 'fis-1',
    connectionId: 'conn-ep',
    platformType: 'eparagony',
    status: 'registered',
    failureMode: null,
    documentNumber: '16240',
    completedAt: '2026-09-30T09:00:00Z',
    printable: false,
    verificationUrl: null,
    artefacts: [{ medium: 'link', disposition: 'send', label: 'Receipt', contentType: null }],
    ...over,
  };
}

function invoiceDoc(over: Partial<BenchSalesDocument> = {}): BenchSalesDocument {
  return {
    kind: 'invoice',
    recordId: 'inv-1',
    connectionId: 'conn-ksef',
    platformType: null,
    status: 'issued',
    failureMode: null,
    documentNumber: 'FV/1',
    completedAt: '2026-09-30T09:00:00Z',
    printable: true,
    verificationUrl: null,
    artefacts: null,
    ...over,
  };
}

function docs(document: BenchSalesDocument | null | undefined, over: Partial<BenchDocuments> = {}): BenchDocuments {
  return {
    workId: 'w-1',
    invoice: null,
    document,
    documentKind: null,
    blockReason: null,
    unresolvedReason: null,
    label: LABEL,
    ...over,
  };
}

describe('describeBenchDocumentCard (#3647)', () => {
  it('should name a registered receipt with a link, never a missing invoice', () => {
    expect(describeBenchDocumentCard(docs(receipt()))).toEqual({
      kind: 'receipt-made',
      documentReference: '16240',
      handover: 'link',
      platformType: 'eparagony',
      artefacts: [{ medium: 'link', disposition: 'send', label: 'Receipt', contentType: null }],
    });
  });

  it('should prefer a file over a link on a registered receipt', () => {
    const card = describeBenchDocumentCard(
      docs(
        receipt({
          artefacts: [
            { medium: 'link', disposition: 'send', label: null, contentType: null },
            { medium: 'document', disposition: 'print', label: null, contentType: 'application/pdf' },
          ],
        })
      )
    );
    expect(card).toMatchObject({ kind: 'receipt-made', handover: 'document' });
  });

  it('should report nothing to hand over for a receipt with no artefact', () => {
    expect(describeBenchDocumentCard(docs(receipt({ artefacts: [] })))).toMatchObject({
      kind: 'receipt-made',
      handover: null,
    });
  });

  it.each([
    ['pending', 'receipt-in-progress'],
    ['registering', 'receipt-in-progress'],
  ])('should show a receipt that is %s as in progress', (status, kind) => {
    expect(describeBenchDocumentCard(docs(receipt({ status, artefacts: null }))).kind).toBe(kind);
  });

  it('should tell a rejected receipt from one OpenLinker is unsure about', () => {
    expect(
      describeBenchDocumentCard(docs(receipt({ status: 'failed', failureMode: 'rejected' }))).kind
    ).toBe('receipt-rejected');
    expect(
      describeBenchDocumentCard(docs(receipt({ status: 'failed', failureMode: 'in-doubt' }))).kind
    ).toBe('receipt-not-confirmed');
  });

  it('should read a failed record with no mode as not confirmed, never as did-not-go-through', () => {
    expect(
      describeBenchDocumentCard(docs(receipt({ status: 'failed', failureMode: null }))).kind
    ).toBe('receipt-not-confirmed');
    expect(
      describeBenchDocumentCard(docs(invoiceDoc({ status: 'failed', failureMode: null }))).kind
    ).toBe('invoice-not-confirmed');
  });

  it.each([
    [{ status: 'issuing' }, 'invoice-in-progress'],
    [{ status: 'pending' }, 'invoice-in-progress'],
    [{ status: 'issued', printable: true }, 'invoice-ready'],
    [{ status: 'issued', printable: false }, 'invoice-not-printable'],
    [{ status: 'failed', failureMode: 'rejected' }, 'invoice-rejected'],
  ] as const)('should map an invoice %o to %s', (over, kind) => {
    expect(describeBenchDocumentCard(docs(invoiceDoc(over))).kind).toBe(kind);
  });

  it('should report missing, with its reason, only when there is no document of any kind', () => {
    expect(
      describeBenchDocumentCard(
        docs(null, { blockReason: 'trigger-model-manual', unresolvedReason: null })
      )
    ).toEqual({ kind: 'missing', blockReason: 'trigger-model-manual', unresolvedReason: null });
  });

  it('should never read an unrecognised kind or status as missing', () => {
    expect(describeBenchDocumentCard(docs(receipt({ kind: 'credit-memo' }))).kind).toBe('unknown');
    expect(describeBenchDocumentCard(docs(receipt({ status: 'archived' }))).kind).toBe('unknown');
    expect(describeBenchDocumentCard(docs(invoiceDoc({ status: 'voided' }))).kind).toBe('unknown');
  });

  it('should fall back to the invoice-only answer of an API older than #3646', () => {
    const legacy = docs(undefined, {
      invoice: {
        state: 'ready',
        invoiceId: 'inv-1',
        documentNumber: 'FV/1',
        issuedAt: null,
        verificationUrl: null,
        blockReason: null,
        unresolvedReason: null,
      },
    });
    expect(describeBenchDocumentCard(legacy)).toEqual({ kind: 'invoice-ready', documentNumber: 'FV/1' });
  });
});

describe('benchDocumentsRefetchInterval (#3647)', () => {
  it('should ask again every 5 s while a document is being made', () => {
    expect(benchDocumentsRefetchInterval(docs(receipt({ status: 'registering', artefacts: null })))).toBe(
      BENCH_DOCUMENTS_IN_PROGRESS_REFETCH_MS
    );
    expect(benchDocumentsRefetchInterval(docs(invoiceDoc({ status: 'issuing' })))).toBe(
      BENCH_DOCUMENTS_IN_PROGRESS_REFETCH_MS
    );
  });

  it('should ask again every 30 s while there is none or it failed', () => {
    expect(benchDocumentsRefetchInterval(docs(null))).toBe(BENCH_DOCUMENTS_UNSETTLED_REFETCH_MS);
    expect(
      benchDocumentsRefetchInterval(docs(receipt({ status: 'failed', failureMode: 'in-doubt' })))
    ).toBe(BENCH_DOCUMENTS_UNSETTLED_REFETCH_MS);
  });

  it('should stop asking once the document is made', () => {
    expect(benchDocumentsRefetchInterval(docs(receipt()))).toBe(false);
    expect(benchDocumentsRefetchInterval(docs(invoiceDoc()))).toBe(false);
    expect(benchDocumentsRefetchInterval(undefined)).toBe(false);
  });
});

describe('selectReceiptHandover (#3647)', () => {
  it('should hand over nothing a person cannot be given', () => {
    expect(
      selectReceiptHandover([{ medium: 'code', disposition: 'display', label: null, contentType: null }])
    ).toBeNull();
    expect(selectReceiptHandover(null)).toBeNull();
  });
});
