import { describe, expect, it } from 'vitest';
import { resolveSalesDocumentCellState } from './sales-document-cell-state';
import type { SalesDocumentIdentity, SalesDocumentView } from '../api/orders.types';

function identity(): SalesDocumentIdentity {
  return {
    recordId: 'rec-1',
    connectionId: 'conn-1',
    providerType: 'ksef',
    documentNumber: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    inFlightUntil: null,
  };
}

function baseView(over: Partial<SalesDocumentView> = {}): SalesDocumentView {
  return {
    orderId: 'ol_order_1',
    documentKind: null,
    document: null,
    blockReason: null,
    unresolvedReason: null,
    blockDetail: null,
    otherRecords: [],
    ...over,
  };
}

describe('resolveSalesDocumentCellState (#2552)', () => {
  // #2761 review: absence is a configuration state, not an error. A fresh
  // install (nothing routed yet) and an FE running against an API predating the
  // field would otherwise paint a red line on EVERY row - the same "large red
  // number on a healthy install" regression #2554 exists to prevent.
  it('reports an idle "No document" when the row carries no view at all', () => {
    const state = resolveSalesDocumentCellState(undefined);
    expect(state).toMatchObject({
      kind: null,
      word: 'No document',
      tone: 'idle',
      attention: false,
    });
  });

  it('reports an idle "No document" when documentKind is null with no persisted reason', () => {
    const state = resolveSalesDocumentCellState(baseView());
    expect(state).toMatchObject({
      kind: null,
      word: 'No document',
      tone: 'idle',
      attention: false,
    });
  });

  it('keeps the error tone when the BACKEND persisted an unresolved-routing reason', () => {
    // The distinction that matters: a routing failure the gate actually
    // recorded IS an error and stays one. What must not be an error is a field
    // that simply is not there.
    const state = resolveSalesDocumentCellState(
      baseView({ blockReason: 'unresolved-routing', unresolvedReason: 'no-configuration-for-country' }),
    );
    expect(state.kind).toBeNull();
    expect(state.tone).toBe('error');
    expect(state.attention).toBe(true);
    expect(state.reasonDetail).not.toBeNull();
  });

  it('renders "Issue on request" (idle, no attention) for trigger-model-manual with no document yet', () => {
    const state = resolveSalesDocumentCellState(
      baseView({ documentKind: 'invoice', blockReason: 'trigger-model-manual' }),
    );
    expect(state.attention).toBe(false);
    expect(state.keepsAction).toBe(true);
    expect(state.tone).toBe('idle');
  });

  it('renders the gate reason copy for a genuinely blocked order', () => {
    const state = resolveSalesDocumentCellState(
      baseView({ documentKind: 'invoice', blockReason: 'unresolved-routing', unresolvedReason: 'no-matching-rule' }),
    );
    expect(state.attention).toBe(true);
    expect(state.word).toBe('No rule matched');
  });

  it('renders "Not issued" when routing decided but nothing blocks and nothing was attempted', () => {
    const state = resolveSalesDocumentCellState(baseView({ documentKind: 'invoice' }));
    expect(state).toMatchObject({ word: 'Not issued', tone: 'idle', attention: true, keepsAction: true });
  });

  it('prefers the authority answer over issuance when an invoice was rejected by the authority', () => {
    const state = resolveSalesDocumentCellState(
      baseView({
        documentKind: 'invoice',
        document: {
          kind: 'invoice',
          documentType: 'vat',
          status: 'issued',
          failureMode: null,
          failureCode: null,
          failureReason: null,
          regulatoryStatus: 'rejected',
          clearanceReference: null,
          identity: identity(),
        },
      }),
    );
    expect(state).toMatchObject({ word: 'Authority rejected', tone: 'error', attention: true });
  });

  it('reports "Issued" for a fully cleared invoice, plain ink (done)', () => {
    const state = resolveSalesDocumentCellState(
      baseView({
        documentKind: 'invoice',
        document: {
          kind: 'invoice',
          documentType: 'vat',
          status: 'issued',
          failureMode: null,
          failureCode: null,
          failureReason: null,
          regulatoryStatus: 'accepted',
          clearanceReference: 'ref-1',
          identity: identity(),
        },
      }),
    );
    expect(state).toMatchObject({ word: 'Issued', tone: 'done', attention: false });
  });

  it('reports "Registered" for a completed fiscal receipt', () => {
    const state = resolveSalesDocumentCellState(
      baseView({
        documentKind: 'fiscal-receipt',
        document: {
          kind: 'fiscal-receipt',
          status: 'registered',
          failureMode: null,
          failureReason: null,
          artefactCount: 1,
          identity: identity(),
        },
      }),
    );
    expect(state).toMatchObject({ word: 'Registered', tone: 'done', attention: false });
  });

  it('reports "Rejected" for a terminally rejected fiscal registration', () => {
    const state = resolveSalesDocumentCellState(
      baseView({
        documentKind: 'fiscal-receipt',
        document: {
          kind: 'fiscal-receipt',
          status: 'failed',
          failureMode: 'rejected',
          failureReason: 'refused',
          artefactCount: 0,
          identity: identity(),
        },
      }),
    );
    expect(state).toMatchObject({ word: 'Rejected', tone: 'error', attention: true });
  });

  it('reports "Unconfirmed" for an in-doubt fiscal registration failure', () => {
    const state = resolveSalesDocumentCellState(
      baseView({
        documentKind: 'fiscal-receipt',
        document: {
          kind: 'fiscal-receipt',
          status: 'failed',
          failureMode: 'in-doubt',
          failureReason: 'poll timeout',
          artefactCount: 0,
          identity: identity(),
        },
      }),
    );
    expect(state).toMatchObject({ word: 'Unconfirmed', tone: 'warning', attention: true });
  });
});
