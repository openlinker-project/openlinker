# ADR-040: Fiscalisation as a capability distinct from invoicing

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @norbert-kulus-blockydevs

## Context

#1908 introduces a **fiscalisation capability** (eparagony.pl as adapter #1) so that an OpenLinker
order can produce a Polish fiscal e-receipt without the operator re-keying lines into printer
software. The framing constraint is non-negotiable and comes from primary law, not from taste:
**OpenLinker can never issue a fiscal receipt.** Issuance is reserved to a homologated registering
device or a certified software register; OL only feeds one. #1906 closed the certification question
for Poland from the consolidated VAT act (Dz.U. 2025 poz. 775): art. 111 ust. 6b places the GUM
homologation duty on *manufacturers and importers of cash registers*, and art. 111b ust. 2 applies
art. 111 *odpowiednio* to software-form registers. The line is therefore **feeding a `kasa` (no
duty) vs being one (duty)**, and OL must stay on the feeding side.

Two published middleware contracts already solved the neutral shape across many regimes
(fiskaltrust middleware, EUPL-1.2; efsta EFR), so the contract is adopted rather than invented -
see the product spec [§4a](../../specs/product-spec-1902-eparagony-e-receipts.md) for the research
pass and its sources. A new capability port touches the plugin contract and more than one bounded
context, which is exactly what [`README.md`](./README.md) § When to write an ADR requires an ADR for.

## Decision

Names below are this ADR's proposal; #1908 may refine spelling, not shape.

1. **Fiscalisation is its own capability port, not a `DocumentType` on `InvoicingPort`.**
   `FiscalisationPort` (registry capability value `Fiscalisation`) lives in a new
   `libs/core/src/fiscalisation/` context, resolved per connection through `IntegrationsService`
   like every other capability. Four independent reasons, each of which alone would break the
   invoicing contract: **issuer** (a certified device or register, never our software), **device
   dependency** (an external precondition invoicing has no concept of), **legal basis** (art. 111 of
   the VAT act and the register-obligation regulation, not the e-invoicing regime of
   [ADR-026](./026-country-agnostic-invoicing-domain.md)), and **retry semantics** (an invoice can
   be answered by a further document - a correction or credit note; a completed fiscal registration
   cannot be un-issued, so "retry" is a different operation with a legal edge).
2. **The invariant core is one operation: register a transaction, receive back what must be printed
   or what identifies the registration.** Both published contracts converged on it (fiskaltrust
   `Sign`; efsta `/register`, with only `/register` and `/cfg` mandatory), so the base port carries
   that single method and nothing else. Everything a regime adds is an
   [ADR-002](./002-capability-ports-with-sub-capabilities.md) sub-capability. The result is
   persisted as a neutral registration record; surfacing status and link on the order (#1909) is a
   read of that record, not a further capability.
3. **The trust anchor lives in the adapter, never in the contract.** Four classes are observed
   (certified device / security module / certified software plus hash chain / remote authority
   endpoint) and the class is **not stable per country**: Italy is mid-migration from RT device to
   certified software, and Czechia has no obligation today but returns in 2027 as pure remote
   reporting. So no anchor-class union and no `PL = device` type enters core. Regime-specific
   extras (the country-encoded fields both vendors carry in their own payloads) stay adapter-side,
   resolved from the connection's config; the neutral command does not model them.
4. **No vendor name and no country assumption in the shared contract.** Litmus test, mirroring
   ADR-026's: zero `paragon` / `kasa` / `printer` / `eparagony` strings in
   `libs/core/src/fiscalisation`. In particular the base contract must not assume *there is a
   fiscal printer*.
5. **The physical-device dependency is expressed as a sub-capability, not in the base port.** A
   `FiscalDeviceOperator` sub-capability (print, print-state) with a co-located
   `isFiscalDeviceOperator` guard is #1910's subject; call sites narrow before invoking and skip
   when a provider does not implement it. This is required from day one rather than deferred,
   because efsta's `/peri/*` finding shows registration is necessary in every regime but
   *sufficient* only in non-device ones - Poland, the first market, is a device regime. The
   operator-visible consequence the split buys: "registered but not printed" and "not registered"
   are distinguishable states with different remedies.
6. **Exactly-once registration is a contract-level guarantee owned by core.** The command carries a
   caller-supplied `idempotencyKey`; core writes a durable registration record with a partial unique
   index on `(connectionId, idempotencyKey)` **before** the outbound call and returns the existing
   record on a repeat - the same gate ADR-026 decision 4 uses for issuance and
   [ADR-005](./005-postgres-authoritative-job-dedup.md) uses for webhook deliveries. Adapters never
   dedup, and a provider-side dedup (where one exists) is a second belt only, never the guarantee.
   This is placed in the contract because a double fiscal registration is a legal event for the
   seller, not a data-quality issue.
7. **An indeterminate outcome is first-class and is never auto-retried.** The neutral result reuses
   the shape invoicing already ships (`InvoiceFailureModeValues = ['rejected', 'in-doubt']`): a
   transport failure after which the sale MAY already be registered resolves by re-reading provider
   state or by an operator decision, never by a blind resend. Blind retry on `in-doubt` is precisely
   how a double registration happens.
8. **Tax calculation is out of scope: the VAT rate arrives from the ProductMaster together with the
   product, and OpenLinker never computes, infers or defaults it** - stated here because a fiscal
   registration transmits amounts it must not recompute. The rule is recorded as an annex to
   [ADR-026](./026-country-agnostic-invoicing-domain.md) and the contract work lives in #2054; a
   missing rate, or an unresolved tax-rate conflict, blocks fiscalisation as a business failure with
   an operator-facing reason, exactly as it blocks invoice issue.
9. **Explicitly deferred** (recorded so a reader knows each was decided, not overlooked):
   - **Journal / audit export** (a `FiscalJournalReader` sub-capability): deferred. The formats are
     irreducibly country-shaped (DSFinV-K, DEP7, NF525, SAF-T) and no user has asked; spec §6.4.
   - **Corrections, voids and returns as fiscal operations**: deferred. Every regime constrains them
     differently and v1 has no demand; spec §6.5. A known gap, not an oversight.
   - **A second adapter** (efsta is the obvious candidate - it documents PL plus 16 further
     jurisdictions): deferred. Building two adapters at once would prove the abstraction against a
     provider we have no commercial relationship with; spec §6.3.
   - **Deciding whether a given order legally requires a receipt**: never OL's decision. The seller
     and their accountant own the fiscal determination (spec §6.7, risk R5). Choosing *which*
     document an order gets, once the obligation is known, is the sibling
     [ADR-039](./039-sales-document-routing-policy.md) (#2051); it
     selects among documents and does not determine anyone's legal obligation.
   - **Non-PL certification posture**: closed for Poland (#1906); Portugal is unresolved because
     the sources were access-blocked, not ambiguous. Advisory only - an adverse answer would
     constrain generalising into PT, not the PL v1.
   - **Who builds the eparagony.pl connector** is still open in #1907. The neutral capability is
     ours either way, so this ADR is not blocked by that answer; the implementation plan for #1908
     is, and is therefore not part of this change.

## Alternatives considered

- **Add `receipt` as an `InvoicingPort` document type.** It would even type-check, because ADR-026's
  `documentType` is open-world and already carries a `receipt` regime value for a *provider-issued,
  receipt-shaped document*. Rejected as a category error, and the near-miss is the reason to say so
  loudly: that existing value is a document our software asks a provider to issue, whereas a fiscal
  registration is an act performed by a certified device whose result core cannot correct. Folding
  the two would put device state, print state and an un-correctable act inside a port whose flow
  assumes none of them.
- **Encode the trust anchor in the contract** (an anchor-class union, or a per-country type).
  Rejected: the class is not stable per country (Italy), it pushes regime knowledge into core, and
  the branching it would enable is what ADR-002 guards already provide.
- **A registration-only port, with device printing added later.** Rejected: registration alone does
  not cover Poland, so v1 would not work in its own first market (efsta `/peri/*` finding).
- **A PL-specific vendor-neutral `ReceiptHub` seam** (spec option E in its original Polish-only
  reading). Rejected and superseded by spec §4a: there is no second Polish hub, so the abstraction
  paid nothing; generalising along the *country* axis, which two vendors have already proven, is
  where the value is.

## Consequences

**Pros:**
- A second provider is an adapter, not a fork: no order-handling or core-domain change (US-5).
- Non-device regimes are served by the base port alone; device regimes narrow to one sub-capability.
- The double-registration guarantee sits in one place core owns, so no adapter can weaken it.
- Core stays free of Polish fiscal vocabulary, so the first non-PL adapter needs no core PR.

**Cons / trade-offs:**
- A fourth document-ish capability alongside invoicing raises the "which port do I use?" question for
  contributors; decision 1's four reasons are the answer, and the routing question is ADR-039's.
- Deferring journal export and fiscal corrections means a regime that mandates either is not yet
  addressable, and we will learn that from the second adapter rather than from this design.
- Modelling `in-doubt` as a non-retryable state pushes real work onto the operator surface (#1909),
  which is more UI than a silent auto-retry would have been.

**Migration path:** nothing exists yet, so there is no migration. #1908 ships the context, the base
port, the neutral command/result and the registration record with its idempotency index; #1910 adds
the device sub-capability; #1909 surfaces the record on the order. #1908 must not ship before #1906
closes.

## References

- Related issues: #1902 (parent), #1908 (capability + adapter), #1910 (device sub-capability),
  #1909 (status/link on the order), #1907 (integrator access - unresolved), #1906 (certification and
  counterparty - closed for PL), #2051 (sibling sales-document routing ADR), #2054 (per-line tax
  rate contract work)
- Related ADRs: [ADR-039](./039-sales-document-routing-policy.md) (sibling - which document a given
  order gets), [ADR-002](./002-capability-ports-with-sub-capabilities.md) (sub-capability
  composition), [ADR-026](./026-country-agnostic-invoicing-domain.md) (the invoicing domain this
  deliberately does not extend, plus the VAT-rate annex),
  [ADR-005](./005-postgres-authoritative-job-dedup.md) (durable dedup gate precedent),
  [ADR-035](./035-ctc-offline-degraded-mode-issuance-lifecycle.md) (indeterminate-outcome
  lifecycle precedent)
- Primary source: product spec [#1902](../../specs/product-spec-1902-eparagony-e-receipts.md) §4a
  (fiskaltrust / efsta contract research), §5 US-1/US-3/US-5, §6 (out of scope), §8 R1
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
  § Core Bounded Contexts, 15. Fiscalisation
