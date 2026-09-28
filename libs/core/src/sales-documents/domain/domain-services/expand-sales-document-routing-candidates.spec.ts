/**
 * expandSalesDocumentRoutingCandidates — unit spec (#3195)
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 */
import { expandSalesDocumentRoutingCandidates } from './expand-sales-document-routing-candidates';
import type { SalesDocumentCandidateConnectionInput } from './expand-sales-document-routing-candidates';

function connection(
  overrides: Partial<SalesDocumentCandidateConnectionInput> = {},
): SalesDocumentCandidateConnectionInput {
  return {
    connectionId: 'conn-1',
    documentKind: 'invoice',
    isPrimary: false,
    enabledCapabilities: ['Invoicing'],
    selfRoutesDocumentKind: false,
    ...overrides,
  };
}

describe('expandSalesDocumentRoutingCandidates (#3195)', () => {
  it('should expand a single-kind connection into exactly one row, byte-identical to the input', () => {
    const input = connection({ documentKind: 'invoice', isPrimary: true });

    expect(expandSalesDocumentRoutingCandidates(input)).toEqual([
      {
        connectionId: 'conn-1',
        documentKind: 'invoice',
        isPrimary: true,
        enabledCapabilities: ['Invoicing'],
        selfRoutesDocumentKind: false,
      },
    ]);
  });

  it('should expand a null documentKind (not a routing candidate) into one null-kind row', () => {
    const input = connection({ documentKind: null });

    expect(expandSalesDocumentRoutingCandidates(input)).toEqual([
      expect.objectContaining({ documentKind: null }),
    ]);
  });

  it('should expand an open-world (unrecognized) kind into one row unchanged', () => {
    const input = connection({ documentKind: 'a-future-regime-kind' });

    expect(expandSalesDocumentRoutingCandidates(input)).toEqual([
      expect.objectContaining({ documentKind: 'a-future-regime-kind' }),
    ]);
  });

  it("should expand documentKind: 'both' into TWO rows sharing the connectionId, one per concrete kind", () => {
    const input = connection({
      documentKind: 'both',
      isPrimary: true,
      enabledCapabilities: ['Invoicing', 'Fiscalization'],
    });

    const result = expandSalesDocumentRoutingCandidates(input);

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      {
        connectionId: 'conn-1',
        documentKind: 'invoice',
        isPrimary: true,
        enabledCapabilities: ['Invoicing', 'Fiscalization'],
        selfRoutesDocumentKind: false,
      },
      {
        connectionId: 'conn-1',
        documentKind: 'fiscal-receipt',
        isPrimary: true,
        enabledCapabilities: ['Invoicing', 'Fiscalization'],
        selfRoutesDocumentKind: false,
      },
    ]);
  });

  it("should carry selfRoutesDocumentKind through the 'both' expansion verbatim", () => {
    const input = connection({ documentKind: 'both', selfRoutesDocumentKind: true });

    const result = expandSalesDocumentRoutingCandidates(input);

    expect(result.every((row) => row.selfRoutesDocumentKind === true)).toBe(true);
  });
});
