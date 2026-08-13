# ADR-040: Fiscalisation as a capability distinct from invoicing

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @norbert-kulus-blockydevs

## Context

#1908 introduces a **fiscalisation capability** (eparagony.pl as adapter #1) so that an OpenLinker
order can produce a Polish fiscal e-receipt without the operator re-keying lines into printer
software. The framing constraint: **OpenLinker can never issue a fiscal receipt.** Issuance is
reserved to a registering device whose type carries a *potwierdzenie Prezesa Głównego Urzędu Miar*,
or to a software register meeting the same requirements; OL only feeds one. #1906 closed the
certification question for Poland from the consolidated VAT act (Dz.U. 2025 poz. 775): **art. 111
ust. 6a** states what a `kasa` must do (functions, technical requirements, transmission to the
Centralne Repozytorium Kas, pamięć fiskalna), **art. 111 ust. 6b** places the duty to obtain the
*potwierdzenie Prezesa GUM* on manufacturers, intra-community acquirers and importers placing such
registers on the market, and **art. 111b ust. 2** applies art. 111 *odpowiednio* to software-form
registers. The line is therefore **feeding a `kasa` (no duty) vs being one (duty)**, and OL must stay
on the feeding side. This records what the statute says; it is **not legal advice**, and no
seller-facing compliance claim should be made on it without a professional opinion (per #1906's
stated out-of-scope).

**What adapter #1 actually is.** eparagony.pl (Platforma Detalistów sp. z o.o.) is a private e-receipt
**distribution hub**, not a fiscaliser and not the state HUB paragonowy: it requires
vendor-proprietary software driving a physical online fiscal printer. Adapter #1 therefore sits in
front of a device **somebody else operates** — the capability hands the sale to a provider that
performs or brokers the fiscal registration, never performs it. Note also that most Polish
e-commerce is exempt from the register obligation and has no receipt to issue at all (spec §2); a PL
fiscal v1 addresses the §4 excluded categories, not the general market.

Two published middleware contracts already solved the neutral shape across many regimes
(fiskaltrust middleware, EUPL-1.2; efsta EFR), so the contract is adopted rather than invented -
see the product spec [§4a](../../specs/product-spec-1902-eparagony-e-receipts.md) for the research
pass and its sources. A new capability port touches the plugin contract and more than one bounded
context, which is exactly what [`README.md`](./README.md) § When to write an ADR requires an ADR for.

## Decision

Names below are this ADR's proposal; #1908 may refine spelling, not shape. The `-isation` spelling is
deliberate and matches #1902's spec and issue titles, even though the repository's wider docs favour
`-ization`; code identifiers and the context path follow the ADR, so the feature reads consistently.

1. **Fiscalisation is its own capability port, not a `DocumentType` on `InvoicingPort`.**
   `FiscalisationPort` lives in a new `libs/core/src/fiscalisation/` context, resolved per connection
   through `IntegrationsService` like every other capability. `Fiscalisation` joins the **closed**
   `CoreCapabilityValues` list rather than riding the open-world string escape (#576), because the
   connection DTOs validate `enabledCapabilities` against that list (see Migration path). Four
   independent reasons, each of which alone would break the invoicing contract: **issuer** (a
   certified device or register, never our software), **device dependency** (an external precondition
   invoicing has no concept of), **legal basis** (art. 111 of the VAT act and the register-obligation
   regulation, not the e-invoicing regime of
   [ADR-026](./026-country-agnostic-invoicing-domain.md)), and **retry semantics** (an invoice can
   be answered by a further document - a correction or credit note; a completed fiscal registration
   cannot be un-issued, so "retry" is a different operation with a legal edge).
2. **The invariant core is one *transaction* operation: register a transaction, receive back what
   must be printed or what identifies the registration.** Both published contracts converged on it
   (fiskaltrust `Sign`; efsta `/register`), so the base port carries that single method and nothing
   else. Company/base-data registration (efsta's second mandatory endpoint, `/cfg`) is **connection
   setup**, not a per-sale operation, and journal export is a deferred sub-capability (decision 9) -
   neither belongs on the base port. Everything else a regime adds is an
   [ADR-002](./002-capability-ports-with-sub-capabilities.md) sub-capability. The result is
   persisted as a neutral registration record; surfacing status and link on the order (#1909) is a
   read of that record, not a further capability.
3. **The trust anchor lives in the adapter, never in the contract.** Four classes are observed
   (certified device / security module / certified software plus hash chain / remote authority
   endpoint) and the class is **not stable per country**: Italy is mid-migration from RT device to
   certified software, and Czechia has no obligation today - a bill approved by the Chamber of
   Deputies on 15 Jul 2026 (Senate and president pending) would return it from 1 Jan 2027 as pure
   remote reporting with no mandatory printing. So no anchor-class union and no `PL = device` type
   enters core. Regime-specific extras (the country-encoded fields both vendors carry in their own
   payloads) stay adapter-side, resolved from the connection's config; the neutral command does not
   model them.
4. **No vendor name and no country assumption in the shared contract.** Litmus test, mirroring
   ADR-026's: zero `paragon` / `kasa` / `printer` / `eparagony` strings in
   `libs/core/src/fiscalisation`. In particular the base contract must not assume *there is a
   fiscal printer*.
5. **The physical-device dependency is expressed as a sub-capability, not in the base port.** A
   `FiscalDeviceOperator` sub-capability (print, print-state) with a co-located
   `isFiscalDeviceOperator` guard is #1910's subject; call sites narrow before invoking and skip
   when a provider does not implement it. Like every other advertised-without-dispatch
   sub-capability it is declared in the adapter manifest for host/FE discovery and resolved **only**
   by narrowing the dispatched `Fiscalisation` adapter with the guard - never via
   `getCapabilityAdapter(connectionId, 'FiscalDeviceOperator')`, which passes the manifest gate and
   then throws a generic `Error` inside `dispatchCapability`. The shape is settled from day one
   because efsta's `/peri/*` finding shows registration is necessary in every regime but *sufficient*
   only in non-device ones, and Poland - the first market - is a device regime. **No v1 adapter
   implements it**: eparagony.pl brokers to a printer driven by the vendor's own software, so the
   print half is outside OL's reach on adapter #1. What the split buys even unimplemented is that
   "registered but not printed" and "not registered" stay distinguishable states.
6. **Exactly-once registration is a contract-level guarantee owned by core.** The command carries a
   **mandatory** caller-supplied `idempotencyKey`; core writes a durable registration record with a
   plain (not partial - the key is never null, unlike invoicing's optional-key column) unique index
   on `(connectionId, idempotencyKey)` **before** the outbound call. On a repeat the record is
   resumed under a status-aware fiscal-safety invariant, **not returned blindly**: an
   already-registered record returns verbatim; a record under a live in-flight lease returns without
   a second outbound call; an `in-doubt` failure returns for manual reconciliation (decision 7); a
   terminal `rejected` failure - the one outcome where the provider definitely created nothing - is
   re-attemptable under the same key. Exactly-once therefore requires the unique index **and** an
   atomic in-flight claim (lease), mirroring `InvoiceService.resumeExisting` / `claimForIssue`
   (#1200, ADR-026 decision 4); without the lease two concurrent same-key calls both pass the read
   gate and both call the provider. Adapters never dedup. This is placed in the contract because a
   double fiscal registration is a legal event for the seller, not a data-quality issue.
   [ADR-005](./005-postgres-authoritative-job-dedup.md) is cited only as the durable-Postgres-dedup
   precedent: its **delete-the-row-on-publish-failure** step is deliberately **not** adopted, because
   deleting on a throw is the blind-resend path decision 7 forbids - the row *is* the `in-doubt`
   evidence.
7. **An indeterminate outcome is first-class and is never auto-retried.** A transport failure after
   which the sale MAY already be registered resolves by locating the registration at the provider or
   by an operator decision, never by a blind resend. Fiscalisation declares its **own**
   `FiscalRegistrationFailureModeValues = ['rejected', 'in-doubt']` - invoicing's shape mirrored by
   design rather than imported, so the two taxonomies diverge as their regimes do (decision 1's whole
   premise) instead of one silently inheriting the other's extensions. Two artefacts come from
   [ADR-035](./035-ctc-offline-degraded-mode-issuance-lifecycle.md), which solved the same
   "we crashed mid-submit and cannot tell if it landed" problem for clearance: `in-doubt` is a
   **non-terminal** state a reconcile sweep keeps advancing (not merely a discriminator on a terminal
   row), and confirming it needs a query surface, because after an indeterminate call OL holds no
   provider id - a `FiscalRegistrationLocator` sub-capability (`locateByQuery(criteria)`, mirroring
   ADR-035's `RegulatoryRecordLocator`), scoped to #1908 alongside the base port. A provider exposing
   no such query gets manual operator handling, never a blind resubmit.
8. **Tax calculation is out of scope: the VAT rate arrives from the ProductMaster together with the
   product, and OpenLinker never computes, infers or defaults it** - stated here because a fiscal
   registration transmits amounts it must not recompute. The rule is recorded as an amendment to
   [ADR-026](./026-country-agnostic-invoicing-domain.md) and the contract work lives in #2054; a
   missing rate, or an unresolved tax-rate conflict, blocks fiscalisation as a business failure with
   an operator-facing reason, exactly as it blocks invoice issue.
9. **Explicitly deferred** (recorded so a reader knows each was decided, not overlooked):
   - **Journal / audit export** (a `FiscalJournalReader` sub-capability): deferred. In Poland the
     online `kasa` transmits to the Centralne Repozytorium Kas itself and holds its own pamięć
     fiskalna/chroniona (art. 111 ust. 6a), so OL has no journal to export; elsewhere the formats are
     irreducibly country-shaped (DSFinV-K, DEP7, NF525, SAF-T). Spec §6.4.
   - **Corrections, voids and returns as fiscal operations**: deferred, and legally safe for PL for a
     stronger reason than absence of demand - a paragon **cannot be corrected on the device at all**.
     Returns and accepted complaints go into a separate *ewidencja zwrotów towarów i uznanych
     reklamacji* (§3 ust. 3, rozporządzenie MF 29.04.2019 ws. kas rejestrujących) and obvious errors
     into a second register (§3 ust. 4). Spec §6.5. **One consequence is a v1 requirement, not a
     deferral**: §3 ust. 4 requires, for an electronic paragon, the receipt number *and* the numer
     unikatowy, so #1909 must persist and surface both or the seller cannot keep the one correction
     register PL actually mandates.
   - **A second adapter** (efsta is the obvious candidate - it documents PL plus 16 further
     jurisdictions): deferred. Building two adapters at once would prove the abstraction against a
     provider we have no commercial relationship with; spec §6.3.
   - **Deciding whether a given order legally requires a receipt**: never OL's decision. The seller
     and their accountant own the fiscal determination (spec §6.7, risk R5). Choosing *which*
     document an order gets, once the obligation is known, is the sibling sales-document routing
     decision (#2051); it selects among documents and does not determine anyone's legal obligation.
   - **Non-PL certification posture**: closed for Poland (#1906); Portugal is unresolved because
     the sources were access-blocked, not ambiguous. Advisory only - an adverse answer would
     constrain generalising into PT, not the PL v1.
   - **Who builds the eparagony.pl connector** is still open in #1907. The neutral capability is
     ours either way, so this ADR is not blocked by that answer. The implementation plan for #1908
     *is* blocked by it, and is therefore not part of this change.

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
- **A registration-only port that cannot express a device dependency at all.** Rejected as an *end
  state*: device regimes exist and some providers do expose the peripheral (efsta `/peri/*`), so the
  contract needs a place for the device half even when no shipped adapter fills it. This is not a
  rejection of the #1908-then-#1910 sequence - see Migration path.
- **A PL-specific vendor-neutral `ReceiptHub` seam** (spec option E in its original Polish-only
  reading). Rejected and superseded by spec §4a: there is no second Polish hub, so the abstraction
  paid nothing; generalising along the *country* axis, which two vendors have already proven, is
  where the value is.

## Consequences

**Pros:**
- A second provider is an adapter, not a fork: no order-handling or core-domain change (US-5).
- Non-device regimes are served by the base port alone; device regimes narrow to one sub-capability.
- The double-registration guarantee sits in one place core owns, so no adapter can weaken it.
- Core stays free of Polish fiscal vocabulary, so the first non-PL adapter needs no core *domain* PR
  (it still needs the one-line capability-value additions listed in Migration path).

**Cons / trade-offs:**
- A second document-producing capability alongside invoicing raises the "which port do I use?"
  question for contributors; decision 1's four reasons are the answer, and the routing question is
  #2051's.
- Deferring journal export and fiscal corrections means a regime that mandates either is not yet
  addressable, and we will learn that from the second adapter rather than from this design.
- Modelling `in-doubt` as a non-retryable state pushes real work onto the operator surface (#1909),
  which is more UI than a silent auto-retry would have been.

**Migration path:** nothing exists yet, so there is no data migration. #1908 ships the context, the
base port, the neutral command/result, the `FiscalRegistrationLocator` sub-capability and the
registration record with its idempotency index; #1910 adds the device sub-capability interface +
guard; #1909 surfaces the record on the order, including the receipt number and numer unikatowy the
PL correction register needs. #1908 also adds `'Fiscalisation'` to `CoreCapabilityValues`
(`libs/core/src/integrations/domain/types/adapter.types.ts`), its spec assertion, and the FE mirror
in `apps/web/src/features/connections/api/connections.types.ts` - without those, `POST`/`PATCH
/connections` with `enabledCapabilities: ['Fiscalisation']` is rejected by the strict
`@IsIn(CoreCapabilityValues, { each: true })` DTOs and the adapter is unreachable, which would block
#1911. #1906 (the certification-liability prerequisite) is **closed**, so nothing gates #1908 on it;
#1907 gates only the eparagony.pl adapter half, not the neutral capability. Because no v1 adapter
implements `FiscalDeviceOperator` (decision 5), #1908 alone is the shippable PL v1 for a
broker-fronted device; #1910 is the contract seam a future device-exposing provider needs.

## References

- Related issues: #1902 (parent), #1908 (capability + adapter), #1910 (device sub-capability),
  #1909 (status/link on the order), #1911 (connection UI), #1907 (integrator access - unresolved),
  #1906 (certification and counterparty - closed for PL), #2051 (sibling sales-document routing
  ADR), #2054 (per-line tax rate contract work)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (sub-capability
  composition), [ADR-026](./026-country-agnostic-invoicing-domain.md) (the invoicing domain this
  deliberately does not extend, plus the VAT-rate amendment),
  [ADR-035](./035-ctc-offline-degraded-mode-issuance-lifecycle.md) (the indeterminate-outcome
  lifecycle decision 7 mirrors), [ADR-005](./005-postgres-authoritative-job-dedup.md) (durable
  dedup-gate precedent, with its delete-on-failure step deliberately not adopted). The sibling
  sales-document routing ADR is #2051, linked once it lands.
- Primary source: product spec [#1902](../../specs/product-spec-1902-eparagony-e-receipts.md) §4a
  (fiskaltrust / efsta contract research), §5 US-5, §6 (out of scope), §8 R1
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
  § Core Bounded Contexts, 15. Fiscalisation
