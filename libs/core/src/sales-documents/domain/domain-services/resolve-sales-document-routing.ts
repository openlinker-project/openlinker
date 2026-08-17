/**
 * Resolve Sales-Document Routing (#2155, ADR-041 decisions 1, 2, 6, 10)
 *
 * The `sales-documents` policy module's one pure resolve (decision 1): given
 * an order and the candidate connections that could receive its originating
 * fiscal document, names EXACTLY ONE (documentKind, connectionId) pair — or
 * reports why it could not. Plain function, no NestJS, no I/O.
 *
 * NO ORDER READ (decision 2): `Order` arrives as a caller-supplied VALUE
 * parameter, typed via `import type` from the cycle-breaker
 * `@openlinker/core/orders/types` sub-barrel — never the main
 * `@openlinker/core/orders` barrel (which re-exports `OrdersModule`) and
 * never an injected orders service/token. That is what keeps the candidate
 * `orders -> invoicing -> sales-documents -> orders` three-node cycle from
 * ever existing. The parameter is named `_order` and unused in THIS first
 * slice: `operator-configured` mode (decision 4) resolves purely from
 * connection config, because the rule engine that would consult order facts
 * (decision 5: delivery country, gross amount) is explicitly deferred. It
 * stays in the signature now so a future rule-engine mode is additive rather
 * than a breaking signature change.
 *
 * PICKS EXACTLY ONE, NEVER A LIST (decision 3a): invoice XOR receipt, never
 * both, never the same kind on two connections.
 *
 * NEVER SILENTLY PICKS ONE (decision 6): ambiguous input resolves
 * `unresolved`, never an incidental choice — a wrong pick for a fiscal
 * document is a legal event.
 *
 * RULE-ENGINE REASONS ARE UNREACHABLE HERE (decision 5, deferred): this
 * resolver never returns `no-matching-rule`, `conflicting-rules-equal-priority`,
 * or `net-priced-order` — those need the rule engine, which does not exist
 * yet. Pinned by `resolve-sales-document-routing.spec.ts`.
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import type { Order } from '@openlinker/core/orders/types';

import type { SalesDocumentDecision } from '../types/sales-document-decision.types';
import { CoreSalesDocumentKindValues } from '../types/sales-document-kind.types';
import type { CoreSalesDocumentKind, SalesDocumentKind } from '../types/sales-document-kind.types';

/**
 * Which capability a WELL-KNOWN document kind dispatches to (decision 10).
 * Purely structural — this is the one slice of "is this kind actually
 * supported here" the resolver can answer without an adapter call: whether
 * the candidate connection has the REQUIRED capability enabled at all. The
 * deeper check (an adapter's `InvoicingPort.getSupportedDocumentTypes()`
 * actually listing the kind) needs a live adapter dispatch and stays with the
 * future gate (`AutoIssueTriggerService`, decision 7); an open-world kind
 * this map does not recognize is left entirely to that deeper check —
 * "validity is a runtime check against the target, never a type check"
 * (decision 10).
 */
const REQUIRED_CAPABILITY_BY_CORE_KIND: Readonly<Record<CoreSalesDocumentKind, string>> = {
  invoice: 'Invoicing',
  'fiscal-receipt': 'Fiscalization',
};

/**
 * One candidate connection, reduced to what the resolve depends on.
 * Structural on purpose — mirrors `InvoicingConnectionCandidate`
 * (`libs/core/src/invoicing/domain/types/invoicing-primary.types.ts`): the
 * resolve is a pure function that needs no `Connection` entity (and
 * therefore no cross-context value import here, preserving this concern's
 * dependency-free-leaf property). The caller resolves `documentKind` /
 * `isPrimary` via `readSalesDocumentRouting(connection.config)` and
 * `enabledCapabilities` from `Connection.enabledCapabilities` before
 * building this list.
 */
export interface SalesDocumentRoutingCandidate {
  readonly connectionId: string;
  readonly documentKind: SalesDocumentKind | null;
  readonly isPrimary: boolean;
  readonly enabledCapabilities: readonly string[];
}

type EligibleCandidate = SalesDocumentRoutingCandidate & { readonly documentKind: SalesDocumentKind };

function hasDocumentKind(candidate: SalesDocumentRoutingCandidate): candidate is EligibleCandidate {
  return candidate.documentKind !== null;
}

function isCoreSalesDocumentKind(value: SalesDocumentKind): value is CoreSalesDocumentKind {
  return (CoreSalesDocumentKindValues as readonly string[]).includes(value);
}

/**
 * Resolve AT MOST ONE originating (documentKind, connectionId) pair for
 * `_order` from its candidate connections (decisions 1, 2, 6, 10).
 *
 * Resolution:
 * 1. Narrow to candidates that declare a `documentKind` at all (decision 4) —
 *    a connection with no configured kind is not a routing candidate.
 * 2. Exactly one such candidate wins outright, primary flag irrelevant
 *    (mirrors `selectPrimaryInvoicingConnection`'s single-candidate rule): a
 *    single-connection install must not require the operator to also set
 *    `isPrimary`.
 * 3. Several candidates: the operator-set primary among THEM wins; none or
 *    more than one is `unresolved` (`'ambiguous-connection-no-primary'`,
 *    decision 6) — silence-and-pick-one is forbidden.
 * 4. Zero candidates ALSO resolves `unresolved`
 *    (`'ambiguous-connection-no-primary'`) rather than a bespoke reason: the
 *    closed `SalesDocumentDecision` shape (decision 11) has no `none` arm,
 *    and "no unambiguous primary among the candidates" is equally true
 *    whether there are zero or several non-primary candidates. A caller that
 *    already knows it has zero eligible connections is expected to
 *    short-circuit before calling this resolver (mirroring
 *    `selectPrimaryInvoicingConnection`'s own `'none'` pre-check today) —
 *    this branch is a defensive fallback, not the common path.
 * 5. The winning candidate's OWN declared kind is checked against its OWN
 *    enabled capabilities (decision 10's structural half) — `'invoice'`
 *    needs `Invoicing`, `'fiscal-receipt'` needs `Fiscalization`. A mismatch
 *    resolves `unresolved` (`'unsupported-document-kind-on-connection'`)
 *    rather than routing to a connection that cannot dispatch the kind at
 *    all. An open-world kind (not in `CoreSalesDocumentKindValues`) has no
 *    known required capability and passes this structural check — its "is
 *    this kind actually supported" answer is a deeper, adapter-level check
 *    the future gate performs (decision 7), never a type check (decision 10).
 */
export function resolveSalesDocumentRouting(
  _order: Order,
  connections: readonly SalesDocumentRoutingCandidate[],
): SalesDocumentDecision {
  const eligible = connections.filter(hasDocumentKind);

  let selected: EligibleCandidate | undefined;
  if (eligible.length === 1) {
    selected = eligible[0];
  } else if (eligible.length > 1) {
    const primaries = eligible.filter((candidate) => candidate.isPrimary);
    selected = primaries.length === 1 ? primaries[0] : undefined;
  }

  if (selected === undefined) {
    return { kind: 'unresolved', reason: 'ambiguous-connection-no-primary' };
  }

  const requiredCapability = isCoreSalesDocumentKind(selected.documentKind)
    ? REQUIRED_CAPABILITY_BY_CORE_KIND[selected.documentKind]
    : undefined;
  if (
    requiredCapability !== undefined &&
    !selected.enabledCapabilities.includes(requiredCapability)
  ) {
    return { kind: 'unresolved', reason: 'unsupported-document-kind-on-connection' };
  }

  return {
    kind: 'route',
    documentKind: selected.documentKind,
    connectionId: selected.connectionId,
  };
}
