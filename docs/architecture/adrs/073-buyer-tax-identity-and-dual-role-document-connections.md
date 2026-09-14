# ADR-073: Buyer tax identity, the fiscalization/invoicing split, and dual-role connections

- **Status**: Accepted
- **Date**: 2026-09-11
- **Authors**: @norbert-kulus-blockydevs

## Context

A receipt carrying the buyer's tax number is, below a threshold, already an invoice in some regimes — no second document is issued. OpenLinker stores that number (`order_records.buyerTaxId`, three-state per #2599), routes on it, and never sends it: `libs/integrations/eparagony` contains zero occurrences of `consumerTIN`. Separately, the same provider can issue `eInvoice` and relay it onward, which OpenLinker cannot ask for, so a second provider is required for invoices.

Both gaps invite the same mistake — letting a regime's vocabulary into `libs/core`. [ADR-026](./026-country-agnostic-invoicing-domain.md) and [ADR-042](./042-fiscalization-capability.md) forbid it, but only fiscalization enforces it with a build-failing sweep.

## Decision

1. **The buyer tax number travels untagged from core.** `TaxIdentifier { scheme, value }` stays the invoicing-command shape, but every `scheme` in the tree is produced by an adapter or an HTTP caller — never by core, whose own type doc says *"core never names a country's identifier system"*. The order stores a bare string, so minting a `scheme` from it would make core name one. An adapter needing a tag supplies it.
2. **A receipt carrying a tax number is Fiscalization work.** Invoicing begins only where a separate document is issued. The two cannot intersect by accident: they are different provider request bodies with different validation.
3. **A connection may hold both document-issuing capabilities**, and the single-valued `SalesDocumentRoutingCandidate.documentKind` is widened to express it. On the **rule-engine** path that is safe by construction: a rule names the kind *and* the connection, and the country default is a single choice, so no ambiguity is left for the system to resolve. The **fallback** path is a different question, answered below rather than assumed.

   **What a dual-role connection does in the single-primary pool.** `AutoIssueTriggerService` consults `evaluateSalesDocumentRules` first and falls through to [`resolveSalesDocumentRouting`](../../../libs/core/src/sales-documents/domain/domain-services/resolve-sales-document-routing.ts) — [ADR-041](./041-sales-document-routing-policy.md) decision 3a's one cross-kind pool — whenever the engine answers `no-configuration-for-country`, which is every unconfigured market on every existing install. It enters that pool **once, not twice**: the candidate list is built one entry per connection (`connections.map(...)`, each reduced by `readSalesDocumentRouting(connection.config)`, which reads a single `config.salesDocument.documentKind`), and the tie-break counts *connections*, not kinds. Widening the field therefore cannot by itself produce `ambiguous-connection-no-primary`, and a single-connection install still wins the pool outright.

   **The hazard is the opposite one, and it is real.** The fallback tier has no rule for choosing *which* kind a widened candidate routes to. `resolveSalesDocumentRoutingFromCandidates` returns the winner's `documentKind` verbatim; a two-kind value is not in `CoreSalesDocumentKindValues`, so `REQUIRED_CAPABILITY_BY_CORE_KIND` has no entry for it and decision 10's structural capability check passes it through untouched; `dispatchRoute` then matches neither the `'invoice'` nor the `'fiscal-receipt'` arm and issues nothing, reporting `unresolved-routing` / `unsupported-document-kind-on-connection`. That is loud — a persisted block reason and an `error` log, not a silent hold — but it is still *stops issuing*, and it would land on precisely the markets nobody has configured.

   **So this is a required guard, not a claimed safety.** The widening may not ship until the operator-configured tier answers the kind question explicitly, and ADR-041 decision 6 forbids the cheap answer — it must not pick a kind incidentally, because a wrong pick for a fiscal document is a legal event. Two shapes are admissible: (a) a dual-role candidate is **excluded** from that tier and resolves `unresolved` with a reason naming the missing configuration, or (b) the connection carries a **fallback default kind** the resolver reads. Which one is the implementing issue's call; that the tier may not be left to guess is this ADR's.
4. **A relaying provider's "issued, not yet submitted" maps to `pending-submission`**, never `submitted`.
5. **Core never pre-judges which tax numbers a provider accepts.** It sends, and surfaces the provider's own refusal verbatim, in the *shape* of [`OfferValidationProblem`](../../../libs/core/src/listings/domain/types/offer-validation-problem.types.ts) — the platform's own `code` kept unaltered beside an operator-facing `message` — **restated in fiscalization, never imported from `listings`**. Importing the type would add a `fiscalization → listings` core edge that `docs/architecture-overview.md` § Cross-context dependencies does not carry, to borrow two fields; restating it keeps this concern's edges as they are, which is the same reason the decision refuses regime vocabulary in core. Carried on fiscalization's existing `failureReason` + `failureMode`.

## Alternatives considered

- **Core mints a `scheme` from a per-connection default.** Rejected: it puts a country's identifier system in core by another route, and a mis-set default silently mislabels every document.
- **Refuse tax numbers a provider is documented not to support.** Rejected: the vendor's pattern carries an explicit *"no validation guarantee"* disclaimer rather than a rejection rule, and telling one region from another needs a member-state list that must exist nowhere.
- **A third document kind for the receipt-as-invoice case.** Rejected: it is the same document, registered the same way, and a kind would leak a regime's legal conclusion into a neutral union.
- **One connection, one role; run two connections for two kinds.** Rejected: it makes the operator maintain two credential sets for one provider to express a thing the routing model can carry.

## Consequences

**Pros:**
- No regime vocabulary enters `libs/core`; decisions 1, 2 and 5 are each enforceable rather than aspirational.
- The two capabilities need no coordination to stay separate.
- Decision 5 makes an unrecognised value a provider fact, not our judgement.

**Cons / trade-offs:**
- An adapter that needs a tagged identifier must derive it, duplicating per-adapter what a central default would centralise.
- Decision 3 touches the auto-issue path, which decides unattended what a paid order gets, and it lands a prerequisite on the operator-configured fallback tier (see the guard under decision 3) before the widening is shippable; both need their own regression coverage.
- A provider refusal is only as legible as the provider's own message.

**Migration path:**
- Connection roles are stamped at create and never back-filled: an existing connection does not silently gain a second capability.
- Fiscalization's neutral-vocabulary sweep already fails the build on a provider name in prose; `sales-documents` and `invoicing` gain the same guard (#3183).

## References

- Related issues: #3173 (epic), #3174, #3183, #3186, #3187, #3192, #3195
- Related ADRs: [ADR-026](./026-country-agnostic-invoicing-domain.md), [ADR-041](./041-sales-document-routing-policy.md), [ADR-042](./042-fiscalization-capability.md), [ADR-002](./002-capability-ports-with-sub-capabilities.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § 14 Invoicing, § 16 Fiscalization, § 17 Sales Documents
- Mockups: [`docs/plans/mockups/sales-document-tax-number-on-receipt.html`](../../plans/mockups/sales-document-tax-number-on-receipt.html), [`docs/plans/mockups/sales-document-eparagony-invoicing.html`](../../plans/mockups/sales-document-eparagony-invoicing.html)
