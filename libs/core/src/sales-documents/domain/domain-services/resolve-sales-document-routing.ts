/**
 * Resolve Sales-Document Routing (#2155, #2158, ADR-041 decisions 1, 2, 6, 9, 10)
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
 * SELF-ROUTING DESTINATIONS BYPASS MATCHING AND THE CAPABILITY CHECK (decision
 * 9, #2158): a candidate whose adapter declared `SelfRoutingDocumentKind`
 * (`isSelfRoutingDocumentKind`, `@openlinker/core/sales-documents`) is
 * eligible for selection independent of whether it has a configured
 * `documentKind` at all — the destination decides its own kind, so the
 * operator never configures one for it. Once such a candidate is selected,
 * the resolver returns `documentKind: null` directly, skipping decision 10's
 * structural capability check (there is no kind to validate against
 * `enabledCapabilities`). Candidate selection itself (single-candidate-wins /
 * operator-primary-among-several / ambiguous-unresolved) is UNCHANGED — a
 * self-routing candidate still has to win that same tie-break like any other,
 * because decision 3a still allows only one connection. No adapter in this
 * repo declares the capability yet (#2158 ships the mechanism, not a first
 * consumer); pinned by a fake candidate in the spec instead.
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
 *
 * Exported (review finding, optional improvements) so
 * `SalesDocumentCapabilityGuardService` (`apps/api/src/sales-documents/`) can
 * import this exact map for its save-time check instead of hand-duplicating
 * it — the two checks answer the same question ("does this connection have
 * the capability `documentKind` needs enabled?") and a second, drifted copy
 * would silently diverge from this one.
 */
export const REQUIRED_CAPABILITY_BY_CORE_KIND: Readonly<Record<CoreSalesDocumentKind, string>> = {
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
 *
 * `selfRoutesDocumentKind` (decision 9, #2158) is the caller's structural
 * check — `isSelfRoutingDocumentKind(adapter)` against the resolved
 * `InvoicingPort` / `FiscalizationPort` adapter for this connection — reduced
 * to the one bit the resolver needs. A self-routing connection is eligible
 * for selection even with `documentKind: null`, since the destination decides
 * its own kind and the operator never configures one for it.
 */
export interface SalesDocumentRoutingCandidate {
  readonly connectionId: string;
  readonly documentKind: SalesDocumentKind | null;
  readonly isPrimary: boolean;
  readonly enabledCapabilities: readonly string[];
  readonly selfRoutesDocumentKind: boolean;
}

function isEligibleCandidate(candidate: SalesDocumentRoutingCandidate): boolean {
  return candidate.documentKind !== null || candidate.selfRoutesDocumentKind;
}

/** Exported alongside {@link REQUIRED_CAPABILITY_BY_CORE_KIND} for the same reason — see its doc comment. */
export function isCoreSalesDocumentKind(value: SalesDocumentKind): value is CoreSalesDocumentKind {
  return (CoreSalesDocumentKindValues as readonly string[]).includes(value);
}

/**
 * Resolve AT MOST ONE originating (documentKind, connectionId) pair for
 * `_order` from its candidate connections (decisions 1, 2, 6, 9, 10).
 *
 * Resolution:
 * 1. Narrow to ELIGIBLE candidates — one that declares a `documentKind`
 *    (decision 4), OR one whose adapter self-routes (`selfRoutesDocumentKind`,
 *    decision 9): a connection with neither is not a routing candidate at
 *    all.
 * 2. Exactly one such candidate wins outright, primary flag irrelevant
 *    (mirrors `selectPrimaryInvoicingConnection`'s single-candidate rule): a
 *    single-connection install must not require the operator to also set
 *    `isPrimary`.
 * 3. Several candidates: the operator-set primary among THEM wins; none or
 *    more than one is `unresolved` (`'ambiguous-connection-no-primary'`,
 *    decision 6) — silence-and-pick-one is forbidden. This tie-break applies
 *    identically whether or not the candidates involved self-route — decision
 *    9 bypasses kind matching and the capability check, never "which
 *    connection wins."
 * 4. Zero candidates ALSO resolves `unresolved`
 *    (`'ambiguous-connection-no-primary'`) rather than a bespoke reason: the
 *    closed `SalesDocumentDecision` shape (decision 11) has no `none` arm,
 *    and "no unambiguous primary among the candidates" is equally true
 *    whether there are zero or several non-primary candidates. A caller that
 *    already knows it has zero eligible connections is expected to
 *    short-circuit before calling this resolver (mirroring
 *    `selectPrimaryInvoicingConnection`'s own `'none'` pre-check today) —
 *    this branch is a defensive fallback, not the common path.
 * 5. SELF-ROUTING SHORT-CIRCUIT (decision 9): if the winning candidate
 *    self-routes, return `documentKind: null` immediately — there is no OL-
 *    chosen kind to validate, so step 6's structural capability check does
 *    not apply to it.
 * 6. Otherwise, the winning candidate's OWN declared kind is checked against
 *    its OWN enabled capabilities (decision 10's structural half) —
 *    `'invoice'` needs `Invoicing`, `'fiscal-receipt'` needs `Fiscalization`.
 *    A mismatch resolves `unresolved` (`'unsupported-document-kind-on-connection'`)
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
  return resolveSalesDocumentRoutingFromCandidates(connections);
}

/**
 * The same resolve, without the unused `Order` parameter (#2516).
 *
 * `resolveSalesDocumentRouting` has never read the order - decision 2 keeps
 * the parameter in its signature so a future order-sensitive mode stays
 * additive - but a READ-side caller composing this projection holds an
 * `OrderRecord` snapshot rather than a clean `Order`, and fabricating one just
 * to satisfy a parameter the function ignores would be a cast dressed up as a
 * value. This is the one function; the order-taking signature above delegates
 * to it, so the two can never answer differently.
 */
export function resolveSalesDocumentRoutingFromCandidates(
  connections: readonly SalesDocumentRoutingCandidate[],
): SalesDocumentDecision {
  const eligible = connections.filter(isEligibleCandidate);

  let selected: SalesDocumentRoutingCandidate | undefined;
  if (eligible.length === 1) {
    selected = eligible[0];
  } else if (eligible.length > 1) {
    const primaries = eligible.filter((candidate) => candidate.isPrimary);
    selected = primaries.length === 1 ? primaries[0] : undefined;
  }

  if (selected === undefined) {
    return { kind: 'unresolved', reason: 'ambiguous-connection-no-primary' };
  }

  if (selected.selfRoutesDocumentKind) {
    return { kind: 'route', documentKind: null, connectionId: selected.connectionId };
  }

  const { documentKind } = selected;
  if (documentKind === null) {
    // Eligibility (`isEligibleCandidate`) only admits a null `documentKind`
    // when `selfRoutesDocumentKind` is true, and that branch already
    // returned above — unreachable in practice, kept as a typed narrowing
    // step rather than a non-null cast.
    return { kind: 'unresolved', reason: 'ambiguous-connection-no-primary' };
  }

  const requiredCapability = isCoreSalesDocumentKind(documentKind)
    ? REQUIRED_CAPABILITY_BY_CORE_KIND[documentKind]
    : undefined;
  if (
    requiredCapability !== undefined &&
    !selected.enabledCapabilities.includes(requiredCapability)
  ) {
    return { kind: 'unresolved', reason: 'unsupported-document-kind-on-connection' };
  }

  return {
    kind: 'route',
    documentKind,
    connectionId: selected.connectionId,
  };
}
