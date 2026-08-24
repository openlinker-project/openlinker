/**
 * Self-Routing Document Kind Capability — type-guard spec
 *
 * Coverage for `isSelfRoutingDocumentKind(adapter)`: true only when
 * `selfRoutesDocumentKind` is callable on the adapter, false when it is absent
 * or not a function, and confirms TypeScript narrows the adapter past the
 * guard. Exercised against a plain structural fake rather than a real
 * `InvoicingPort`/`FiscalizationPort` adapter — the guard is deliberately
 * generic over any adapter shape (see the capability's doc comment).
 *
 * @module libs/core/src/sales-documents/domain/ports/capabilities
 */
import { isSelfRoutingDocumentKind } from './self-routing-document-kind.capability';

function makeAdapter(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    someBaseMethod: jest.fn(),
    ...extra,
  };
}

describe('isSelfRoutingDocumentKind', () => {
  it('returns true when `selfRoutesDocumentKind` is a function', () => {
    expect(
      isSelfRoutingDocumentKind(makeAdapter({ selfRoutesDocumentKind: () => true as const })),
    ).toBe(true);
  });

  it('narrows the adapter type past the guard so `selfRoutesDocumentKind` is callable', () => {
    const adapter = makeAdapter({ selfRoutesDocumentKind: () => true as const });

    if (isSelfRoutingDocumentKind(adapter)) {
      expect(adapter.selfRoutesDocumentKind()).toBe(true);
    } else {
      throw new Error('guard should have narrowed the adapter');
    }
  });

  it('returns false when `selfRoutesDocumentKind` is absent', () => {
    expect(isSelfRoutingDocumentKind(makeAdapter())).toBe(false);
  });

  it('returns false when a `selfRoutesDocumentKind` slot exists but is not callable', () => {
    expect(isSelfRoutingDocumentKind(makeAdapter({ selfRoutesDocumentKind: 'not a function' }))).toBe(
      false,
    );
  });
});
