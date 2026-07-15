# ADR-037: Neutral fiscal-annotation flags on the invoicing command

- **Status**: Accepted
- **Date**: 2026-07-15
- **Authors**: @norbert-kulus-blockydevs

## Context

[ADR-026](./026-country-agnostic-invoicing-domain.md) keeps the invoicing core
country-agnostic: no NIP/KSeF/FA vocabulary in `libs/core`, all national
specifics confined to the provider adapter. The FA(3) `Adnotacje` block carries
six schema-mandated annotations a Polish invoice may need to declare - cash
accounting (`P_16`), self-billing (`P_17`), reverse charge (`P_18`), the
split-payment mechanism (`P_18A`), VAT exemption grounds (`Zwolnienie`/`P_19`),
triangulation (`P_23`), and the margin scheme (`PMarzy`).

Before #1580 the KSeF builder hard-coded every one of these to its negative
branch, so a VAT-marża reseller or a reverse-charge/exempt line produced a
document whose header contradicted its own lines. Fixing it needs some flags the
neutral command does not carry (they are operator declarations no marketplace
order expresses), while others are already implied by the per-line tax code.

## Decision

Add a single optional neutral bag `InvoiceAnnotations` to `IssueInvoiceCommand`
(`cashAccounting`, `selfBilling`, `splitPayment`, `triangulation`,
`marginScheme`, and a free-text `exemptionLegalBasis`). The names are generic
commercial/fiscal concepts; the provider adapter maps neutral → its own regime
(the KSeF adapter maps them to `Adnotacje`). Reverse charge and exemption are
**deliberately not** boolean flags - the provider derives them from the per-line
tax codes ([ADR-035](./035-per-line-tax-rate-on-order-item.md)) so the header can
never contradict the lines. All flags are optional; absent ⇒ the provider's
"does not apply" default.

## Alternatives considered

- **Per-line-only derivation for everything**: Rejected - cash-basis,
  self-billing, split-payment and triangulation are invoice-/operator-level
  declarations with no line signal to derive from.
- **PL-named fields (`p16`, `pMarzy`, …) on the command**: Rejected - leaks FA(3)
  vocabulary into `libs/core`, violating ADR-026.
- **A provider-specific extension map (`Record<string, unknown>`)**: Rejected -
  untyped, unvalidated, and hides the contract from other adapters.

## Consequences

**Pros:**
- Header annotations agree with the line-level treatment; margin/exempt/
  reverse-charge invoices become correct.
- Core stays country-agnostic; a non-PL provider maps the same neutral flags.

**Cons / trade-offs:**
- No operator UI yet sets the flags - they thread through defaulting to the
  negative branch (a documented follow-up).
- The exemption yes-branch needs a legal-basis text; when a line is exempt but
  none is supplied, the adapter emits a descriptive placeholder the operator
  should refine.

## References

- Related issues: #1580, #1586
- Related ADRs: [ADR-026](./026-country-agnostic-invoicing-domain.md), [ADR-035](./035-per-line-tax-rate-on-order-item.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Invoicing
