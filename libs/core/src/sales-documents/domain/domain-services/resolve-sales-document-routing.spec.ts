/**
 * resolveSalesDocumentRouting — unit spec (#2155, ADR-041 decisions 1, 2, 6, 10)
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 */
import type { Order } from '@openlinker/core/orders/types';

import { SalesDocumentUnresolvedReasonValues } from '../types/sales-document-reason.types';
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
});
