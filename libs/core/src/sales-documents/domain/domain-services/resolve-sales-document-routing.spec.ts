/**
 * resolveSalesDocumentRouting — unit spec (#2155, #2158, ADR-041 decisions 1, 2, 6, 9, 10)
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 */
import type { Order } from '@openlinker/core/orders/types';

import { SALES_DOCUMENT_KIND_BOTH } from '../types/sales-document-kind.types';
import { SalesDocumentUnresolvedReasonValues } from '../types/sales-document-reason.types';
import { expandSalesDocumentRoutingCandidates } from './expand-sales-document-routing-candidates';
import type { SalesDocumentCandidateConnectionInput } from './expand-sales-document-routing-candidates';
import type { SalesDocumentRoutingCandidate } from './resolve-sales-document-routing';
import { resolveSalesDocumentRouting } from './resolve-sales-document-routing';

/** Minimal `Order` fixture — the resolver reads no field of it in this slice. */
const ORDER: Order = {
  id: 'ol_order_1',
  status: 'pending',
  items: [],
  totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN' },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function candidate(overrides: Partial<SalesDocumentRoutingCandidate>): SalesDocumentRoutingCandidate {
  return {
    connectionId: 'conn-1',
    documentKind: 'invoice',
    isPrimary: false,
    enabledCapabilities: ['Invoicing'],
    selfRoutesDocumentKind: false,
    ...overrides,
  };
}

describe('resolveSalesDocumentRouting (ADR-041)', () => {
  it('should route to the single eligible candidate regardless of the primary flag (decision 4)', () => {
    const only = candidate({ connectionId: 'conn-only', isPrimary: false });

    expect(resolveSalesDocumentRouting(ORDER, [only])).toEqual({
      kind: 'route',
      documentKind: 'invoice',
      connectionId: 'conn-only',
    });
  });

  it('should route to the operator-set primary among several eligible candidates (decision 4)', () => {
    const connections = [
      candidate({ connectionId: 'conn-a', isPrimary: false }),
      candidate({ connectionId: 'conn-b', isPrimary: true }),
      candidate({ connectionId: 'conn-c', isPrimary: false }),
    ];

    expect(resolveSalesDocumentRouting(ORDER, connections)).toEqual({
      kind: 'route',
      documentKind: 'invoice',
      connectionId: 'conn-b',
    });
  });

  it('should resolve unresolved/ambiguous-connection-no-primary when several candidates and none is primary (decision 6)', () => {
    const connections = [
      candidate({ connectionId: 'conn-a', isPrimary: false }),
      candidate({ connectionId: 'conn-b', isPrimary: false }),
    ];

    expect(resolveSalesDocumentRouting(ORDER, connections)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous-connection-no-primary',
    });
  });

  it('should resolve unresolved/ambiguous-connection-no-primary when several candidates carry MORE than one primary (decision 6)', () => {
    const connections = [
      candidate({ connectionId: 'conn-a', isPrimary: true }),
      candidate({ connectionId: 'conn-b', isPrimary: true }),
    ];

    expect(resolveSalesDocumentRouting(ORDER, connections)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous-connection-no-primary',
    });
  });

  it('should resolve unresolved/ambiguous-connection-no-primary when there are zero eligible candidates', () => {
    // Zero candidates at all (none configured with a documentKind).
    expect(resolveSalesDocumentRouting(ORDER, [])).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous-connection-no-primary',
    });

    // Connections exist but none declares a documentKind — same outcome.
    const connections = [candidate({ documentKind: null }), candidate({ documentKind: null })];
    expect(resolveSalesDocumentRouting(ORDER, connections)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous-connection-no-primary',
    });
  });

  it('should resolve unresolved/unsupported-document-kind-on-connection when the sole candidate lacks the required capability (decision 10)', () => {
    const noCapability = candidate({
      connectionId: 'conn-only',
      documentKind: 'invoice',
      enabledCapabilities: [], // Invoicing NOT enabled
    });

    expect(resolveSalesDocumentRouting(ORDER, [noCapability])).toEqual({
      kind: 'unresolved',
      reason: 'unsupported-document-kind-on-connection',
    });
  });

  it('should resolve unresolved/unsupported-document-kind-on-connection for a fiscal-receipt kind on a connection without Fiscalization enabled', () => {
    const noCapability = candidate({
      connectionId: 'conn-only',
      documentKind: 'fiscal-receipt',
      enabledCapabilities: ['Invoicing'], // wrong capability for this kind
    });

    expect(resolveSalesDocumentRouting(ORDER, [noCapability])).toEqual({
      kind: 'unresolved',
      reason: 'unsupported-document-kind-on-connection',
    });
  });

  it('should route a well-known kind when its required capability IS enabled', () => {
    const receipt = candidate({
      connectionId: 'conn-only',
      documentKind: 'fiscal-receipt',
      enabledCapabilities: ['Fiscalization'],
    });

    expect(resolveSalesDocumentRouting(ORDER, [receipt])).toEqual({
      kind: 'route',
      documentKind: 'fiscal-receipt',
      connectionId: 'conn-only',
    });
  });

  it('should route an open-world (unknown) kind without a structural capability check (decision 10)', () => {
    // No entry in the well-known map — validity here is a runtime check
    // against the target, never a type check, so this resolver cannot refuse
    // it structurally and must pass it through to the (future) gate.
    const custom = candidate({
      connectionId: 'conn-only',
      documentKind: 'daily-aggregate-report',
      enabledCapabilities: [],
    });

    expect(resolveSalesDocumentRouting(ORDER, [custom])).toEqual({
      kind: 'route',
      documentKind: 'daily-aggregate-report',
      connectionId: 'conn-only',
    });
  });

  describe('self-routing destinations (decision 9)', () => {
    it('should route to a self-routing candidate with documentKind: null even without a configured documentKind', () => {
      const selfRouting = candidate({
        connectionId: 'conn-self-routing',
        documentKind: null,
        enabledCapabilities: [],
        selfRoutesDocumentKind: true,
      });

      expect(resolveSalesDocumentRouting(ORDER, [selfRouting])).toEqual({
        kind: 'route',
        documentKind: null,
        connectionId: 'conn-self-routing',
      });
    });

    it('should skip the structural capability check for a self-routing candidate even when it also declares a documentKind', () => {
      // A self-routing candidate that ALSO happens to carry a documentKind
      // (e.g. stale operator config) still short-circuits to documentKind:
      // null — decision 9 is unconditional once the guard applies, and there
      // is nothing left to validate against `enabledCapabilities`.
      const selfRouting = candidate({
        connectionId: 'conn-self-routing',
        documentKind: 'invoice',
        enabledCapabilities: [], // would fail the structural check if it were checked
        selfRoutesDocumentKind: true,
      });

      expect(resolveSalesDocumentRouting(ORDER, [selfRouting])).toEqual({
        kind: 'route',
        documentKind: null,
        connectionId: 'conn-self-routing',
      });
    });

    it('should apply the same primary tie-break to self-routing candidates as any other (decision 6)', () => {
      const connections = [
        candidate({
          connectionId: 'conn-a',
          documentKind: null,
          enabledCapabilities: [],
          selfRoutesDocumentKind: true,
          isPrimary: false,
        }),
        candidate({
          connectionId: 'conn-b',
          documentKind: null,
          enabledCapabilities: [],
          selfRoutesDocumentKind: true,
          isPrimary: true,
        }),
      ];

      expect(resolveSalesDocumentRouting(ORDER, connections)).toEqual({
        kind: 'route',
        documentKind: null,
        connectionId: 'conn-b',
      });
    });

    it('should resolve unresolved/ambiguous-connection-no-primary when several self-routing candidates and no primary is set', () => {
      const connections = [
        candidate({
          connectionId: 'conn-a',
          documentKind: null,
          enabledCapabilities: [],
          selfRoutesDocumentKind: true,
        }),
        candidate({
          connectionId: 'conn-b',
          documentKind: null,
          enabledCapabilities: [],
          selfRoutesDocumentKind: true,
        }),
      ];

      expect(resolveSalesDocumentRouting(ORDER, connections)).toEqual({
        kind: 'unresolved',
        reason: 'ambiguous-connection-no-primary',
      });
    });

    it('should let a normal (non-self-routing) candidate win the tie-break over an ineligible self-routing-false candidate', () => {
      const connections = [
        candidate({ connectionId: 'conn-normal', documentKind: 'invoice' }),
        candidate({
          connectionId: 'conn-not-eligible',
          documentKind: null,
          selfRoutesDocumentKind: false,
        }),
      ];

      expect(resolveSalesDocumentRouting(ORDER, connections)).toEqual({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-normal',
      });
    });
  });

  it('should never return a rule-engine-only unresolved reason (decision 5, deferred)', () => {
    const RULE_ENGINE_ONLY_REASONS = [
      'no-matching-rule',
      'conflicting-rules-equal-priority',
      'net-priced-order',
    ];
    // Sanity: these three are indeed declared in the shared union today, so
    // this spec is testing something real rather than a stale list.
    for (const reason of RULE_ENGINE_ONLY_REASONS) {
      expect(SalesDocumentUnresolvedReasonValues).toContain(reason);
    }

    const scenarios: readonly SalesDocumentRoutingCandidate[][] = [
      [],
      [candidate({ documentKind: null })],
      [candidate({ isPrimary: false }), candidate({ connectionId: 'conn-2', isPrimary: false })],
      [candidate({ isPrimary: true }), candidate({ connectionId: 'conn-2', isPrimary: true })],
      [candidate({ enabledCapabilities: [] })],
      [candidate({ isPrimary: false })],
      [candidate({ documentKind: 'fiscal-receipt', enabledCapabilities: ['Fiscalization'] })],
      [candidate({ documentKind: 'an-unknown-open-world-kind' })],
    ];

    for (const connections of scenarios) {
      const decision = resolveSalesDocumentRouting(ORDER, connections);
      if (decision.kind === 'unresolved') {
        expect(RULE_ENGINE_ONLY_REASONS).not.toContain(decision.reason);
      }
    }
  });

  describe('a dual-role connection expanded into two candidate rows (#3195), driven through the real expander (#3364 review)', () => {
    // These rows are built through `expandSalesDocumentRoutingCandidates`
    // rather than hand-assembled: that function copies ONE `isPrimary` value
    // onto BOTH rows it expands for a dual-role connection, so a mixed
    // `isPrimary: false` + `isPrimary: true` pair sharing one `connectionId`
    // is a combination the real code path can never produce. A spec that
    // hand-builds it certifies a behaviour that cannot happen - see
    // `docs/lessons.md`'s #2380 entry for the same shape.
    function dualRoleConnection(
      overrides: Partial<SalesDocumentCandidateConnectionInput> = {},
    ): SalesDocumentCandidateConnectionInput {
      return {
        connectionId: 'conn-both',
        documentKind: SALES_DOCUMENT_KIND_BOTH,
        isPrimary: false,
        enabledCapabilities: ['Invoicing', 'Fiscalization'],
        selfRoutesDocumentKind: false,
        ...overrides,
      };
    }

    it('should route to the one eligible row when it is the only candidate, even though it shares a connectionId with no sibling here', () => {
      const only = candidate({
        connectionId: 'conn-both',
        documentKind: 'invoice',
        enabledCapabilities: ['Invoicing', 'Fiscalization'],
      });

      expect(resolveSalesDocumentRouting(ORDER, [only])).toEqual({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-both',
      });
    });

    it('should resolve unresolved/ambiguous-connection-no-primary for its own two rows when the connection is not primary', () => {
      const rows = expandSalesDocumentRoutingCandidates(dualRoleConnection({ isPrimary: false }));

      expect(resolveSalesDocumentRouting(ORDER, rows)).toEqual({
        kind: 'unresolved',
        reason: 'ambiguous-connection-no-primary',
      });
    });

    it('is STILL ambiguous when the connection is marked primary - the flag has no effect between its own two rows', () => {
      // Marking the connection primary makes BOTH expanded rows primary at
      // once (they share one `isPrimary` value) - 2 primaries among 2
      // eligible candidates is still no unambiguous winner, never a clean
      // route to either kind.
      const rows = expandSalesDocumentRoutingCandidates(dualRoleConnection({ isPrimary: true }));

      expect(resolveSalesDocumentRouting(ORDER, rows)).toEqual({
        kind: 'unresolved',
        reason: 'ambiguous-connection-no-primary',
      });
    });

    it('cannot be made to beat a single-role sibling by marking IT primary - the self-collision persists with a sibling present', () => {
      const sibling = candidate({
        connectionId: 'conn-other',
        documentKind: 'invoice',
        enabledCapabilities: ['Invoicing'],
        isPrimary: false,
      });
      const rows = [
        ...expandSalesDocumentRoutingCandidates(dualRoleConnection({ isPrimary: true })),
        sibling,
      ];

      // 2 primaries (both conn-both rows) among 3 eligible candidates: still
      // ambiguous - the outcome a hand-built mixed-isPrimary fixture used to
      // certify as a clean win never actually occurs.
      expect(resolveSalesDocumentRouting(ORDER, rows)).toEqual({
        kind: 'unresolved',
        reason: 'ambiguous-connection-no-primary',
      });
    });

    it('DOES route to a single-role sibling marked primary, even alongside an un-primaried dual-role connection', () => {
      const sibling = candidate({
        connectionId: 'conn-other',
        documentKind: 'invoice',
        enabledCapabilities: ['Invoicing'],
        isPrimary: true,
      });
      const rows = [
        ...expandSalesDocumentRoutingCandidates(dualRoleConnection({ isPrimary: false })),
        sibling,
      ];

      expect(resolveSalesDocumentRouting(ORDER, rows)).toEqual({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-other',
      });
    });
  });
});
