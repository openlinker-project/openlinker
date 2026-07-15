# ADR-035: Per-line tax rate on the neutral OrderItem contract

- **Status**: Accepted
- **Date**: 2026-07-15
- **Authors**: @norbert-kulus-blockydevs

## Context

OpenLinker's neutral `OrderItem` (`libs/core/src/orders`) carries no per-line
tax rate. When an order is invoiced, `order-to-issue-invoice-command.mapper.ts`
emits `taxRate: ''` on every `InvoiceLine`, and each provider adapter substitutes
its connection-level `defaultTaxRate` on every line. Any order that mixes rates
(23% + 8%/5% — routine for general-merchandise Polish e-commerce) is therefore
invoiced with a single flat rate on all lines, producing a legally incorrect
FA(3) tax breakdown (#1586).

This exact gap was raised once before and closed as accepted-risk in #1290, on
the reasoning that a country-agnostic core (ADR-026) must not carry Polish VAT
vocabulary. That constraint is real, but it conflated two separate things: naming
a *country's tax semantics* in core (rightly forbidden) versus carrying an
*opaque, source-reported rate code* through the neutral pipeline (which does not
name any country's semantics). #1586 reopens the decision to draw that line
explicitly.

## Decision

Add an **optional** `taxRate?: string` to the neutral `OrderItem`, carrying a
source-reported per-line rate as an **opaque neutral string code** reusing the
vocabulary already established by `InvoiceLine.taxRate` (the provider's own rate
keys — e.g. KSeF's `FA3_TAX_RATE_MAP` keys `'23' | '8' | '5' | '0' | 'zw' |
'np'`). `toInvoiceLine()` forwards `item.taxRate ?? ''`. Roll out in phases:

- **Phase 1 (this ADR / #1586 Phase 1)**: add the field + mapper forwarding.
  Behaviour-preserving — no adapter populates it yet, so every line still falls
  back to `''` ⇒ the provider's connection-level default (today's behaviour).
- **Phase 2**: order-source adapters that genuinely expose a per-line rate
  populate `OrderItem.taxRate`; the provider builder emits the correct per-line
  band. Scoped to 1–2 live-tested platforms first, the rest documented as
  follow-ups.

Core still names no country's tax semantics — the code is opaque, produced by the
source adapter and consumed by the destination provider adapter; ADR-026 holds.

## Alternatives considered

- **Keep the flat per-connection default (status quo / #1290)**: Rejected — it
  produces a legally wrong tax breakdown for any mixed-rate order, which is a
  mainstream e-commerce case, not an edge case.
- **Resolve per-line rate destination-side from the net/gross delta**: Rejected —
  not all sources report enough to reconstruct the rate reliably, and it buries a
  fiscal-correctness concern in each provider adapter instead of carrying the
  source's own asserted rate.
- **A structured `TaxRate` value object (percentage + scheme enum) in core**:
  Rejected — that *would* pull tax-scheme semantics into the country-agnostic
  core, violating ADR-026. An opaque string code keeps core neutral.

## Consequences

**Pros:**
- Mixed-rate orders can be invoiced with a correct per-line breakdown.
- Additive + optional ⇒ zero behaviour change until an adapter opts in; no
  migration, no break to existing single-rate flows.
- Core stays country-agnostic — the field is an opaque passthrough.

**Cons / trade-offs:**
- The neutral contract now carries a value whose vocabulary is defined by the
  provider layer, not core. Accepted: it is opaque to core and documented as
  such; the alternative (structured VO) is worse for ADR-026.
- Two-phase rollout means the field sits unused after Phase 1 until adapters fill
  it — an intentional, documented seam, not dead code.

**Migration path:**
- None for Phase 1 (additive optional field). Phase 2 is per-adapter and
  independent; each adapter that populates the field supersedes #1290's
  accepted-risk framing for the sources it covers.

## References

- Related issues: #1586, supersedes the accepted-risk framing of #1290
- Related ADRs: [ADR-026](./026-country-agnostic-invoicing-domain.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Invoicing
