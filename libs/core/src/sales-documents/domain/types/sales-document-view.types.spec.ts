/**
 * Sales-Document View Types - unit tests (#2515, ADR-065)
 *
 * These assert SHAPE, not behaviour: the projection's whole job is to make the
 * two states ADR-065 names unrepresentable-or-distinguishable at the type
 * level, so the tests that matter are the ones the compiler runs.
 */
import type {
  SalesDocumentInvoiceView,
  SalesDocumentReceiptView,
  SalesDocumentRecordView,
  SalesDocumentView,
} from './sales-document-view.types';

const identity = {
  recordId: 'inv-1',
  connectionId: 'conn-1',
  providerType: 'infakt',
  documentNumber: 'FV/2026/08/1',
  createdAt: '2026-08-26T10:00:00.000Z',
  completedAt: '2026-08-26T10:00:05.000Z',
  inFlightUntil: null,
} as const;

describe('SalesDocumentView', () => {
  describe('the two invoice axes', () => {
    it('should represent an invoice issued and then rejected by the authority', () => {
      const rejectedByAuthority: SalesDocumentInvoiceView = {
        kind: 'invoice',
        documentType: 'invoice',
        status: 'issued',
        failureMode: null,
        failureCode: null,
        failureReason: null,
        regulatoryStatus: 'rejected',
        clearanceReference: null,
        identity,
      };

      expect(rejectedByAuthority.status).toBe('issued');
      expect(rejectedByAuthority.regulatoryStatus).toBe('rejected');
    });

    it('should distinguish an authority rejection from a failed issuance', () => {
      const failedIssuance: SalesDocumentInvoiceView = {
        kind: 'invoice',
        documentType: 'invoice',
        status: 'failed',
        failureMode: 'rejected',
        failureCode: 'buyer-tax-id-invalid',
        failureReason: 'Buyer tax id missing',
        regulatoryStatus: 'not-applicable',
        clearanceReference: null,
        identity: { ...identity, documentNumber: null, completedAt: null },
      };

      const rejectedByAuthority: SalesDocumentInvoiceView = {
        kind: 'invoice',
        documentType: 'invoice',
        status: 'issued',
        failureMode: null,
        failureCode: null,
        failureReason: null,
        regulatoryStatus: 'rejected',
        clearanceReference: 'KSEF-REF-1',
        identity,
      };

      // The pair, not either field alone, is what tells them apart: both are
      // "rejected" in one vocabulary and not in the other, which is precisely
      // why the flattened single enum was rejected.
      expect(failedIssuance.status).not.toBe(rejectedByAuthority.status);
      expect(failedIssuance.regulatoryStatus).not.toBe(rejectedByAuthority.regulatoryStatus);
      expect(rejectedByAuthority.clearanceReference).not.toBeNull();
      expect(failedIssuance.clearanceReference).toBeNull();
    });
  });

  describe('a fiscal receipt has no authority axis', () => {
    it('should not accept a regulatory status on a receipt', () => {
      const receipt: SalesDocumentReceiptView = {
        kind: 'fiscal-receipt',
        status: 'registered',
        failureMode: null,
        failureReason: null,
        artefactCount: 0,
        identity: { ...identity, recordId: 'fis-1', providerType: 'eparagony' },
      };

      // @ts-expect-error a receipt cannot carry an authority answer (ADR-042):
      // the field does not exist on the type, so no surface can render one.
      expect(receipt.regulatoryStatus).toBeUndefined();
      // An empty artefact list on a registered row is a SUCCESS, not a failure.
      expect(receipt.artefactCount).toBe(0);
      expect(receipt.status).toBe('registered');
    });

    it('should narrow the union on `kind` alone', () => {
      const records: SalesDocumentRecordView[] = [
        {
          kind: 'invoice',
          documentType: 'invoice',
          status: 'issued',
          failureMode: null,
          failureCode: null,
          failureReason: null,
          regulatoryStatus: 'cleared',
          clearanceReference: 'KSEF-REF-2',
          identity,
        },
        {
          kind: 'fiscal-receipt',
          status: 'registering',
          failureMode: null,
          failureReason: null,
          artefactCount: 0,
          identity: { ...identity, recordId: 'fis-2', completedAt: null },
        },
      ];

      const clearances = records.map((record) =>
        record.kind === 'invoice' ? record.regulatoryStatus : null,
      );

      expect(clearances).toEqual(['cleared', null]);
    });
  });

  describe('the unconfigured and undecided states', () => {
    it('should express "routing has not decided" without inventing a kind', () => {
      const view: SalesDocumentView = {
        orderId: 'ol_order_1',
        documentKind: null,
        document: null,
        blockReason: 'unresolved-routing',
        unresolvedReason: 'no-configuration-for-country',
        blockDetail: null,
        otherRecords: [],
      };

      expect(view.documentKind).toBeNull();
      expect(view.document).toBeNull();
      expect(view.unresolvedReason).toBe('no-configuration-for-country');
    });

    it('should express "routing decided, nothing issued yet"', () => {
      const view: SalesDocumentView = {
        orderId: 'ol_order_2',
        documentKind: 'fiscal-receipt',
        document: null,
        blockReason: 'trigger-model-manual',
        unresolvedReason: null,
        blockDetail: null,
        otherRecords: [],
      };

      expect(view.documentKind).toBe('fiscal-receipt');
      expect(view.document).toBeNull();
      expect(view.unresolvedReason).toBeNull();
    });

    it('should report a record held on another connection rather than hide it', () => {
      const view: SalesDocumentView = {
        orderId: 'ol_order_3',
        documentKind: 'invoice',
        document: {
          kind: 'invoice',
          documentType: 'invoice',
          status: 'issued',
          failureMode: null,
          failureCode: null,
          failureReason: null,
          regulatoryStatus: 'submitted',
          clearanceReference: null,
          identity,
        },
        blockReason: null,
        unresolvedReason: null,
        blockDetail: null,
        otherRecords: [
          { connectionId: 'conn-2', kind: 'invoice', blocksFurtherIssuance: false },
        ],
      };

      expect(view.otherRecords).toHaveLength(1);
      expect(view.otherRecords[0].blocksFurtherIssuance).toBe(false);
    });
  });
});
