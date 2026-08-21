# ADR-053: `fulfillment-authority` as a dependency-free vocabulary leaf; resolution in the owning contexts

- **Status**: Proposed — draft (brainstorm output; number provisional, re-verify before filing)
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

[ADR-052](./052-independently-assignable-fulfillment-authorities.md)'s six authorities need shared
vocabulary (kinds, scopes, selection outcomes, block reasons) consumed by `inventory`, `orders`,
`listings`, `returns` and a new `fulfillment` context — a shape that invites either a god-context
or a DI cycle. Two shipped precedents apply: `sales-documents` (a zero-outbound-edge leaf holding
decision-11 reason unions, safely value-imported by two contexts) and #2047's four-part
exactly-one-authority mechanism (pure selection function; untrusted-config coercion; write-path
guard + lock; gate-reports/caller-persists).

## Decision

Create `libs/core/src/fulfillment-authority/` as a **types-and-pure-functions leaf**: no NestJS
module, service, repository, port or tokens file (the documented `sales-documents` exemption),
pinned by the barrel-purity spec. It publishes `AuthorityKind`, `AuthorityScope` (discriminated:
global/location/channel/order/work), `AuthorityAssignment`, the generic `selectAuthorityHolder()`
(generalising `selectPrimaryInvoicingConnection`, single-candidate rule included),
`parseAuthorityConfig()`, and `FulfillmentAuthorityBlockOutcome` (`none | blocked | indeterminate`)
with reason unions. **Resolution services live in the context that owns each write**: A1 in
`inventory`, A2/A3 in `fulfillment`, A4 in the lifecycle projection, A5 in `returns`, A6 in
`orders`. Per-order gates follow ADR-041's persistence discipline: the gate returns an outcome, the
caller in `orders` persists it level-triggered (`none` clears, `indeterminate` leaves the prior
value), columns excluded from `toOrm`.

## Alternatives considered

- **One `oms-policy` context resolving everything**: ADR-041's router sits above two contexts only
  because neither may own the question; here each authority has exactly one owning context.
  Centralising creates a module with inbound edges from five contexts and outbound edges to five
  more — the DI-cycle shape that forced `AutoIssueTriggerService` into gate-reports/caller-persists.
- **Vocabulary duplicated per context**: the FE/SQL mirrors and the selection rule would drift;
  #2047's rule exists once today and should exist once tomorrow.
- **A shared runtime service in `integrations`**: gives the leaf a module and a dependency
  direction, forfeiting the safe value-import property both consumers need.

## Consequences

**Pros:**
- Zero CJS load-cycle risk by construction; the barrel-purity walker enforces it.
- One selection rule, one config-coercion idiom, one block-outcome shape across all six
  authorities.

**Cons / trade-offs:**
- Six resolution sites to keep consistent — mitigated by the shared pure function being the only
  place the rules live.
- A second vocabulary leaf (`order-lifecycle`, [ADR-059](./059-order-lifecycle-derived-phase.md))
  coexists; the two concerns stay separate deliberately.

## References

- Related issues: #2047, #2100
- Related ADRs: [ADR-041](./041-sales-document-routing-policy.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §2.1
