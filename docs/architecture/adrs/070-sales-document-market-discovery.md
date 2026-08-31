# ADR-070: Market discovery, and what OpenLinker may recommend

- **Status**: Proposed
- **Date**: 2026-08-26
- **Authors**: @norbert-kulus-blockydevs

## Context

A clean OpenLinker instance has **no sales-document routing at all**, and it should not: which document a sale needs is a legal question about the seller's business, and [ADR-041](./041-sales-document-routing-policy.md) is explicit that OpenLinker executes configured routing rather than deciding tax obligations.

The consequence today is silence. Orders arrive, no document is issued, and nothing on any screen says which markets the operator would need to configure. The failure is invisible until someone notices no documents exist - which on the live demo is exactly what happened for Poland, where three configured rules key on a buyer tax ID that OpenLinker never records, so every Polish order resolves to no document while the settings page presents the configuration as working.

OpenLinker does already know where orders are delivered: every `order_records` row carries its delivery-address country - the same field [ADR-041](./041-sales-document-routing-policy.md) decision 5 routes on. So the set of markets that need a decision is derivable, and leaving it underived is a choice, not a limitation.

Separately, we have researched starter rules for exactly **one** market (Poland, sourced from public guidance) and none for any other. A generic "suggested setup" affordance would therefore imply guidance we do not have.

## Decision

**Two decisions, and the second bounds the first.**

1. **A country that orders are delivered to is surfaced as a first-class market, whether or not it is configured.** The settings page lists detected markets alongside configured ones, each with its order count over a window. The count is what makes an operator act; "not configured" alone does not. This is a **read**: discovery never creates a rule, a default, or any routing on its own.

2. **A suggested setup is offered only where researched guidance exists, and its scarcity is stated.** Templates are country-keyed data with a citable source. Poland is the only entry. A detected market without one gets a plain *set up* affordance, never a recommendation we cannot back, and the UI says which markets we have guidance for rather than implying every market has some.

One presentational rule follows and is load-bearing: **a detected, unconfigured market is a neutral state, not a fault.** A fresh install is not broken. Rendering it as an error tells a new operator their instance is misconfigured on day one, when in truth nobody has made a decision yet.

## Alternatives considered

- **Ask the operator to enumerate their markets by hand.** Rejected: it asks for information the system already holds, and a forgotten market fails silently, which is the exact defect this closes.
- **Auto-apply the Poland template when Polish orders are detected.** Rejected outright. Issuing a fiscal document nobody chose is a legal act taken on the operator's behalf, and ADR-041 forbids OpenLinker deciding what a sale requires.
- **A generic "suggested setup" for every market, generated from the routing model.** Rejected: it would present a shape as advice. We have guidance for one market; saying so is the honest surface.
- **Detect by billing address rather than delivery country.** Rejected: routing evaluates on the delivery country the rules are written against ([ADR-041](./041-sales-document-routing-policy.md) decision 5), so discovery must use the same field or it would name markets the evaluator never sees - a billing-address order that ships elsewhere would surface a market routing never matches.

## Consequences

**Pros:**
- An unconfigured market is visible before an operator discovers it through missing documents.
- The order count turns "you have no routing" into "47 orders here are waiting", which is actionable.
- Template scarcity is explicit, so the absence of advice is itself informative.

**Cons / trade-offs:**
- One more read on the orders store, and a window to choose. A short window under-reports a seasonal market; a long one lists markets the seller has left. The window is a documented constant, not a per-operator setting, until there is evidence one is needed.
- A market appearing in the list is not a recommendation to configure it, and the copy has to carry that distinction.

**Migration path:**
- Additive and read-only. An existing install gains the list; nothing about its routing changes.

## References

- Related issues: #2503, #2513, #2518, #2528, #2529, #2530
- Related ADRs: [ADR-041](./041-sales-document-routing-policy.md), [ADR-065](./065-sales-document-read-surface.md)
- UX mockup: [`docs/plans/mockups/sales-document-routing.html`](../../plans/mockups/sales-document-routing.html) - `#page=settings`, states *brand new* and *orders arriving, nothing set up*
