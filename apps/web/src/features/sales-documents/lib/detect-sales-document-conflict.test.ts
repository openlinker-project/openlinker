import { describe, expect, it } from 'vitest';
import type { SalesDocumentRow } from '../api/sales-documents.types';
import { detectSalesDocumentConflict } from './detect-sales-document-conflict';

function makeRow(overrides: Partial<SalesDocumentRow> = {}): SalesDocumentRow {
  return {
    connectionId: 'conn_1',
    name: 'inFakt',
    platformType: 'infakt',
    status: 'active',
    capability: 'Invoicing',
    documentKind: 'invoice',
    isPrimary: false,
    triggerModel: 'manual',
    ...overrides,
  };
}

describe('detectSalesDocumentConflict', () => {
  it('should report no conflict with zero eligible rows', () => {
    expect(detectSalesDocumentConflict([makeRow({ documentKind: null })])).toBeNull();
  });

  it('should report no conflict with a single eligible row regardless of its primary flag', () => {
    expect(detectSalesDocumentConflict([makeRow({ isPrimary: false })])).toBeNull();
  });

  it('should report no conflict with several eligible rows and exactly one primary', () => {
    const rows = [
      makeRow({ connectionId: 'conn_1', isPrimary: true }),
      makeRow({ connectionId: 'conn_2', isPrimary: false, capability: 'Fiscalization', documentKind: 'fiscal-receipt' }),
    ];

    expect(detectSalesDocumentConflict(rows)).toBeNull();
  });

  it('should report multiple-primaries when more than one eligible row is primary', () => {
    const rows = [
      makeRow({ connectionId: 'conn_1', isPrimary: true }),
      makeRow({ connectionId: 'conn_2', isPrimary: true, capability: 'Fiscalization', documentKind: 'fiscal-receipt' }),
    ];

    expect(detectSalesDocumentConflict(rows)).toBe('multiple-primaries');
  });

  it('should report ambiguous-no-primary when several eligible rows have no primary', () => {
    const rows = [
      makeRow({ connectionId: 'conn_1', isPrimary: false }),
      makeRow({ connectionId: 'conn_2', isPrimary: false, capability: 'Fiscalization', documentKind: 'fiscal-receipt' }),
    ];

    expect(detectSalesDocumentConflict(rows)).toBe('ambiguous-no-primary');
  });

  it('should not count a row with documentKind null toward eligibility', () => {
    const rows = [
      makeRow({ connectionId: 'conn_1', isPrimary: false }),
      makeRow({ connectionId: 'conn_2', isPrimary: false, documentKind: null }),
    ];

    expect(detectSalesDocumentConflict(rows)).toBeNull();
  });

  // Review finding 8: only `active` connections can ever compete for the
  // primary slot at runtime (`AutoIssueTriggerService`, D8).
  it('should NOT count a disabled connection toward eligibility, even with a configured documentKind', () => {
    const rows = [
      makeRow({ connectionId: 'conn_1', isPrimary: false }),
      makeRow({
        connectionId: 'conn_2',
        isPrimary: false,
        status: 'disabled',
        capability: 'Fiscalization',
        documentKind: 'fiscal-receipt',
      }),
    ];

    expect(detectSalesDocumentConflict(rows)).toBeNull();
  });

  it('should NOT count a needs_reauth connection toward eligibility', () => {
    const rows = [
      makeRow({ connectionId: 'conn_1', isPrimary: true }),
      makeRow({
        connectionId: 'conn_2',
        isPrimary: true,
        status: 'needs_reauth',
        capability: 'Fiscalization',
        documentKind: 'fiscal-receipt',
      }),
    ];

    // Would be `multiple-primaries` if the disabled/needs_reauth connection
    // were counted — it cannot be, since it can never actually issue.
    expect(detectSalesDocumentConflict(rows)).toBeNull();
  });
});
