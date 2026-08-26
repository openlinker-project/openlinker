# ADR-042: Fiscalization as a capability distinct from invoicing

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @norbert-kulus-blockydevs

## Context

#1908 introduces a **fiscalization capability** (eparagony.pl as adapter #1) so that an OpenLinker
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
**distribution hub**, not a fiscalizer and not the state HUB paragonowy: it requires
vendor-proprietary software driving a physical online fiscal printer. Adapter #1 therefore sits in
front of a device **somebody else operates** — the capability hands the sale to a provider that
performs or brokers the fiscal registration, never performs it. Note also that most Polish
e-commerce is exempt from the register obligation and has no receipt to issue at all (spec §2); a PL
fiscal v1 addresses the §4 excluded categories, not the general market.

Two published middleware contracts already solved the neutral shape across many regimes
(fiskaltrust middleware, EUPL-1.2; efsta EFR), so the contract is adopted rather than invented -
see the product spec [§4a](../../specs/product-spec-1902-eparagony-e-receipts.md) for the research
pass and its sources. Reading them also settles where our boundary is: **OpenLinker is not building
fiskaltrust, it is building the cash register that calls one.** fiskaltrust holds its neutral
contract at the **POS boundary** (`IPOS`, three operations) and deliberately lets everything below
stay irregular - the Austrian signing interface carries 4 methods, the German one 15, because a
German TSE needs an ordered `StartTransaction`/`Update`/`Finish` protocol with device lifecycle and
export sessions. A lowest-common-denominator `sign(bytes)` port one level down would have made the
German queue impossible to build. OL sits on the **caller** side of that boundary; eparagony.pl is
the middleware. The hardest problem in this domain - abstracting over heterogeneous national signing
hardware - is therefore not ours, and this ADR only has to get the caller-side contract right. A new
capability port touches the plugin contract and more than one bounded context, which is exactly what
[`README.md`](./README.md) § When to write an ADR requires an ADR for.

## Decision

Names below are this ADR's proposal; #1908 may refine spelling, not shape. **`-ization` is the
spelling everywhere** — code identifiers, the capability value, the context path
(`'Fiscalization'`, `libs/core/src/fiscalization/`, `FiscalizationPort`) *and* prose across the
docs, matching the repository's overwhelming house style (`normalize` 464 : 40, `authorize`
244 : 3, and every shipped identifier). #1902's spec and the GitHub issue titles were written
`-isation`; the spec was normalised with this ADR, and the issue titles are left alone because
renaming them would break inbound links for no gain. Settling it here matters most for the
capability value, which is wire-visible in `connections.enabledCapabilities` and gated by a strict
`@IsIn` DTO — once a connection exists, changing it is a breaking change.

1. **Fiscalization is its own capability port, not a `DocumentType` on `InvoicingPort`.**
   `FiscalizationPort` lives in a new `libs/core/src/fiscalization/` context, resolved per connection
   through `IntegrationsService` like every other capability. `Fiscalization` joins the **closed**
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
   identifies the registration plus whatever customer-facing artefacts it produced.** Both published
   contracts converged on it (fiskaltrust `Sign`; efsta `/register`), so the base port carries that
   single method and nothing else. **Delivery channel is a variable, not a constant**: fiskaltrust's
   one operation returns PDF, ESC/POS markup, QR, SMS and e-mail as interchangeable outputs, and the
   Czech 2027 bill, Hungary's eNyugta and Germany's proposed 2028 *Belegbereitstellungspflicht* each
   register a sale with no mandatory printing at all. The result therefore carries a
   **possibly-empty list of customer artefacts**, each pairing content with an **adapter-declared**
   `medium` (document / markup / code / link / text) and `disposition` hint (print / display / send /
   retain) - a hint, never an instruction, because core neither renders nor delivers. An empty list
   is a **successful** registration, not a failure: a pure reporting regime returns identifiers only.
   Company/base-data registration (efsta's second mandatory endpoint, `/cfg`) is **connection
   setup**, not a per-sale operation, and journal export is its own sub-capability (decision 11) -
   neither belongs on the base port. Everything else a regime adds is an
   [ADR-002](./002-capability-ports-with-sub-capabilities.md) sub-capability. The result is
   persisted as a neutral registration record; surfacing status and artefacts on the order (#1909) is
   a read of that record, not a further capability.
3. **The trust anchor lives in the adapter, never in the contract.** It sits below the POS boundary
   by construction, so core never has to name it - and could not usefully, because the class is not
   stable even *within* one country. Four are observed (certified device / security module /
   certified software plus hash chain / remote authority endpoint): Italy added certified software
   **alongside** hardware RT (art. 24 D.Lgs. 1/2024; AdE provvedimento of 7 Mar 2025, splitting the
   PEM software module from the PEL point of sale), with no sunset for hardware in any instrument and
   roughly 91% of merchants still hardware-only, so it now runs two classes at once; Czechia has no
   obligation at all today, though Chamber of Deputies print 189 - third reading passed 15 Jul 2026,
   Senate 19-20 Aug 2026, presidential signature pending - would return one from 1 Jan 2027 as pure
   remote reporting, mandating neither receipt printing nor new cash equipment per the Ministry of
   Finance. *(Legislative status as at 2026-08-13; a reader after that date should re-check it.)* So
   no anchor-class union and no `PL = device` type enters core; regime-specific extras stay
   adapter-side, resolved from the connection's config.
4. **No vendor name and no country assumption in the shared contract.** Litmus test, mirroring
   ADR-026's: zero `paragon` / `kasa` / `printer` / `eparagony` strings in
   `libs/core/src/fiscalization`. In particular the base contract must not assume *there is a
   fiscal printer* - which is why decision 2 returns an artefact list with an adapter-declared medium
   and disposition rather than a printable payload, and why an adapter that produces no printable
   form is a first-class case, not a degraded one. The litmus covers **field names and core reads**,
   not just prose: a regime-specific value reaches core only as one of the neutral identity fields
   (decision 9) or as an opaque `regimeExtras` entry, so `numerUnikatowy` may legitimately appear as
   a *key inside adapter-written extras data* but never as a column, a TypeScript property, or a key
   any code under `libs/core/src/fiscalization` indexes.
5. **The physical-device dependency is expressed as a sub-capability, not in the base port.** A
   `FiscalDeviceOperator` sub-capability (print, print-state) with a co-located
   `isFiscalDeviceOperator` guard is #1910's subject; call sites narrow before invoking and skip
   when a provider does not implement it. Like every other advertised-without-dispatch
   sub-capability it is declared in the adapter manifest for host/FE discovery and resolved **only**
   by narrowing the dispatched `Fiscalization` adapter with the guard - never via
   `getCapabilityAdapter(connectionId, 'FiscalDeviceOperator')`, which passes the manifest gate and
   then throws a generic `Error` inside `dispatchCapability`. The shape is settled from day one
   because registration is necessary in every regime but *sufficient* only in non-device ones (efsta
   `/peri/*`), and Poland - the first market - is a device regime. **No v1 adapter implements it**:
   on adapter #1 the printer sits below the middleware boundary, driven by the vendor's own software.
   The split earns its place unimplemented anyway, by keeping "registered but not printed"
   distinguishable from "not registered".
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
   by an operator decision, never by a blind resend. Fiscalization declares its **own**
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
8. **Tax calculation is out of scope, and fiscalization never computes a rate of its own** - stated
   here because a fiscal registration transmits amounts it must not recompute. That negative half is
   settled and holds whatever else is decided. The *positive* half - **the VAT rate arrives from the
   ProductMaster together with the product, and OpenLinker never infers or defaults it** - is
   recorded as an amendment to [ADR-026](./026-country-agnostic-invoicing-domain.md) and is
   **proposed, not settled**: carrying it requires reversing the per-line tax-rate rejection in
   [ADR-014](./014-source-authoritative-order-pricing.md) ("Alternatives considered"), proposed in
   **#2058, which is open and may be refused** - its own framing says refuting the argument is a
   legitimate outcome. Contract work is #2054. Under the rule as proposed, a missing rate or an
   unresolved tax-rate conflict blocks fiscalization as a business failure with an operator-facing
   reason, exactly as it blocks invoice issue; if #2058 is refused, the rate reaches the fiscal
   command by some other route, and only the blocking behaviour above is re-opened, not this ADR.
9. **Explicitly deferred** (recorded so a reader knows each was decided, not overlooked):
   - **Journal / audit export**: not an open deferral - promoted to the named first extension point,
     decision 11.
   - **Corrections, voids and returns as fiscal operations**: deferred, and legally safe for PL for a
     stronger reason than absence of demand - a paragon **cannot be corrected on the device at all**.
     Returns and accepted complaints go into a separate *ewidencja zwrotów towarów i uznanych
     reklamacji* (§3 ust. 3, rozporządzenie MF 29.04.2019 ws. kas rejestrujących) and obvious errors
     into a second register (§3 ust. 4). Spec §6.5. **One consequence is a v1 requirement, not a
     deferral**: §3 ust. 4 requires, for an electronic paragon, the receipt number *and* the numer
     unikatowy, so #1909 must persist and surface both. **They are carried neutrally, never as PL
     fields**: the registration record holds a small neutral identity set - a provider-assigned
     `providerReference` (the locator key), the `documentReference` borne by the registered document
     (PL: numer paragonu; IT: numero documento commerciale; DE: Bon-Nr), a flat `signingIdentity` for
     whatever performed or signed the registration (PL: numer unikatowy; DE: TSE serial; IT:
     matricola - flat, because an anchor-class union is what decision 3 rejects), and `registeredAt`
     - plus one adapter-owned, jsonb-backed `regimeExtras` bag of flat string key/values for
     everything with no cross-regime counterpart (PL: numer ewidencyjny). The adapter writes both;
     core persists them verbatim, indexes none of the extras keys, and #1909 renders the neutral
     fields with fixed labels and the extras as label/value rows. A key that shows up in a second
     adapter is promoted to a neutral field.
   - **A second adapter** (efsta is the obvious candidate - it documents PL plus 16 further
     jurisdictions): deferred. Building two adapters at once would prove the abstraction against a
     provider we have no commercial relationship with; spec §6.3.
   - **Deciding whether a given order legally requires a receipt**: never OL's decision. The seller
     and their accountant own the fiscal determination (spec §6.7, risk R5). Choosing *which*
     document an order gets, once the obligation is known, is the sibling sales-document routing
     decision ([ADR-041](./041-sales-document-routing-policy.md)); it selects among documents and does not determine anyone's legal obligation.
   - **Non-PL certification posture**: closed for Poland (#1906); Portugal is unresolved because
     the sources were access-blocked, not ambiguous. Advisory only - an adverse answer would
     constrain generalising into PT, not the PL v1.
   - **Who builds the eparagony.pl connector** is still open in #1907. The neutral capability is
     ours either way, so this ADR is not blocked by that answer. The implementation plan for #1908
     *is* blocked by it, and is therefore not part of this change.
10. **No degraded / offline mode ships in v1, and this is a decision rather than an omission.**
    Every POS-side fiscalization stack has one - efsta returns an empty fiscal tag marked `#OFFLINE`
    after a configurable window plus a `UserMessage` the POS must display, fiskaltrust circuit-breaks
    into late-signing where lateness is a legally-recognised flag rather than an error, Lightspeed
    prints *Sicherungseinrichtung ausgefallen*, D365 offers `Postpone` with a backup connector - so a
    reader arriving from any of them will read the absence as an oversight. It is not. **Degraded
    mode is not `in-doubt`**: `in-doubt` (decision 7) is *we do not know whether it landed*, an
    epistemic state resolved by locating the registration or by an operator; degraded mode is *we
    know it did not land and we are proceeding anyway under a legally-recognised substitute*. Three
    reasons OL needs the first and not the second:
    - **No blocked buyer.** Those systems degrade because a till must close the sale now, with the
      customer at the counter and the duty to hand over a receipt simultaneous with the transaction.
      OL registers a sale that already completed at a marketplace or shop checkout, asynchronously,
      from a retrying job runner. "Not registered yet" is an ordinary queued job, not a customer
      being held.
    - **OL cannot mint the substitute.** Every degraded artefact above - the `#OFFLINE` tag, the
      late-signing flag, and this repository's own
      [ADR-035](./035-ctc-offline-degraded-mode-issuance-lifecycle.md) `pending-submission` status -
      is emitted by the party holding the trust anchor. ADR-035's degraded mode is legitimate
      precisely because OL *issues* the invoice; decision 1 says OL is categorically never the issuer
      of a fiscal registration. A degraded fiscal state minted by OL would assert something OL has no
      standing to assert.
    - **The outage window is already owned below our seam.** The PL online `kasa` buffers to its own
      pamięć chroniona and transmits to the CRK once connectivity returns (art. 111 ust. 6a);
      eparagony.pl fronts vendor software driving that device. The degraded behaviour exists - it
      just is not OL's to implement.

    **What would force one**: OL entering the buyer-blocking path (an OL-hosted till or checkout
    surface that must return a receipt synchronously), OL becoming the signer in a late-signing
    regime, or an adapter whose provider *returns* a degraded marker OL must carry and surface
    (efsta's `#OFFLINE` tag and its mandatory operator-facing message). Only the first two are
    lifecycle changes; carrying a provider's degraded flag is additive on the neutral result and does
    not make OL the minter.
11. **The first known extension point is a periodic journal / audit export, and it will not fit the
    base port.** Poland is the reason it is not in v1, not evidence that it is exotic: the online
    `kasa` transmits to the Centralne Repozytorium Kas itself and holds its own pamięć
    fiskalna/chroniona (art. 111 ust. 6a), so OL has no journal to export. Everywhere else a
    standardised audit export is close to universal - DSFinV-K (DE), DEP7 (AT), NF525 (FR), SAF-T
    (several), LROE (ES-Basque) - so the first non-PL adapter is more likely to hit this than
    anything else in decision 9. Spec §6.4. Recording it as a *named extension point* rather than an
    open deferral is the point: the shape is known, only the trigger is missing.

    **Why it cannot sit on the base port.** Decision 2's base port is one *transaction* operation,
    and an export mismatches it on every axis: it is keyed to a **period**, not to a single sale
    under a mandatory `idempotencyKey`, and belongs to no registration record; it is **freely
    repeatable**, so routing it through decision 6's `(connectionId, idempotencyKey)` unique index
    plus lease would mint rows that are not registrations and make the fiscal-safety invariant
    meaningless for them; its result is an **opaque, country-schema'd file** core stores and hands
    over without parsing (the same posture as invoicing's `RegulatoryDocumentReader` blob, #1224);
    it is **scheduled or operator-initiated** on a reporting cadence, so it is a sync-job type rather
    than a step of the fiscalization flow; and providers in regimes with no export duty have nothing
    to return, so a base-port method would force a no-op implementation on every one of them - the
    exact situation [ADR-002](./002-capability-ports-with-sub-capabilities.md) sub-capabilities exist
    to avoid.

    **Shape sketch** (indicative; the implementing issue owns the spelling). A `FiscalJournalExporter`
    sub-capability with a co-located `isFiscalJournalExporter` guard, advertised-without-dispatch and
    narrowed from the dispatched `Fiscalization` adapter exactly as decision 5 requires of
    `FiscalDeviceOperator`: `exportJournal({ period: { from, to }, format? })` returning an opaque
    `{ format, content, contentType, producedAt, coveredPeriod }` - where `format` is an
    adapter-declared id core never branches on, and `coveredPeriod` may be narrower than requested.
    No country format name and no schema knowledge enters `libs/core/src/fiscalization`, so decision
    4's litmus test holds unchanged.

## Alternatives considered

- **Add `receipt` as an `InvoicingPort` document type.** It would even type-check, because ADR-026's
  `documentType` is open-world and already carries a `receipt` regime value for a *provider-issued,
  receipt-shaped document*. Rejected as a category error, and the near-miss is the reason to say so
  loudly: that existing value is a document our software asks a provider to issue, whereas a fiscal
  registration is an act performed by a certified device whose result core cannot correct. Folding
  the two would put device state, print state and an un-correctable act inside a port whose flow
  assumes none of them.
- **Encode the trust anchor in the contract** (an anchor-class union, or a per-country type).
  Rejected: the anchor lives below the POS boundary, so lifting it above imports regime knowledge
  core cannot act on - and the class is not stable even within one country (Italy runs both).
- **A registration-only port that cannot express a device dependency at all.** Rejected as an *end
  state*: some middleware does expose the peripheral (efsta `/peri/*`), so the caller-side contract
  needs a slot for the device half even while no shipped adapter fills it. Not a rejection of the
  #1908-then-#1910 sequence - see Migration path.
- **A PL-specific vendor-neutral `ReceiptHub` seam** (spec option E in its original Polish-only
  reading). Rejected and superseded by spec §4a: there is no second Polish hub, so the abstraction
  paid nothing; generalising along the *country* axis, which two vendors have already proven, is
  where the value is.
- **Ship a degraded / offline mode alongside `in-doubt`.** Rejected for v1: see decision 10. In OL
  the two would not be siblings - `in-doubt` is a state we can honestly hold, a degraded flag is an
  artefact only the trust anchor may mint, and OL is never the anchor here.

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
  [ADR-041](./041-sales-document-routing-policy.md)'s.
- Not shipping fiscal corrections means a regime that mandates them is not yet addressable, and we
  will learn that from the second adapter rather than from this design. Journal export is the same
  gap but a *scoped* one: decision 11 already names the sub-capability and its shape, so the first
  regime that needs it adds an interface and an adapter method, not a redesign.
- Modelling `in-doubt` as a non-retryable state pushes real work onto the operator surface (#1909),
  which is more UI than a silent auto-retry would have been.

**Forward-looking - the two regimes meet in 2027.** From 1 January 2027 Poland's low-value NIP
receipt - a *faktura uproszczona* up to 450 zł - is pulled into KSeF; it sits outside the clearance
regime only until 31 Dec 2026. So in the one market this work targets, roughly five months out, the
same order can need **both** a fiscal registration and a KSeF clearance. That is not an argument for
merging the contexts - it is the argument for exactly this shape: two ports, two records, and a
single adapter free to implement both where one provider covers both. Which document(s) a given order
actually gets stays [ADR-041](./041-sales-document-routing-policy.md)'s routing decision, not this ADR's.

**Migration path:** nothing exists yet, so there is no data migration. #1908 ships the context, the
base port, the neutral command/result, the `FiscalRegistrationLocator` sub-capability and the
registration record with its idempotency index; #1910 adds the device sub-capability interface +
guard; #1909 surfaces the record on the order, including the neutral `documentReference` and
`signingIdentity` the PL correction register needs (§3 ust. 4) plus any `regimeExtras` the adapter
wrote. #1908 also adds `'Fiscalization'` to `CoreCapabilityValues`
(`libs/core/src/integrations/domain/types/adapter.types.ts`), its spec assertion, and the FE mirror
in `apps/web/src/features/connections/api/connections.types.ts` - without those, `POST`/`PATCH
/connections` with `enabledCapabilities: ['Fiscalization']` is rejected by the strict
`@IsIn(CoreCapabilityValues, { each: true })` DTOs and the adapter is unreachable, which would block
#1911. #1906 (the certification-liability prerequisite) is **closed**, so nothing gates #1908 on it;
#1907 gates only the eparagony.pl adapter half, not the neutral capability. Because no v1 adapter
implements `FiscalDeviceOperator` (decision 5), #1908 alone is the shippable PL v1 for a
broker-fronted device; #1910 is the contract seam a future device-exposing provider needs.

## Amendment (#2502, 2026-08-26): four gaps that force the UI to state something untrue

Designing the operator surfaces for a fiscal receipt (#2513) found four places where the contract cannot express a state the system is genuinely in, so the UI has to say something else. Each is a decision here, not an implementation detail, because the alternative in every case is a surface that misleads.

**1. A third locate outcome: held, but not registered.** `FiscalLocateResult` can report a confirmed registration or no match. A provider that has accepted the sale and not yet registered it therefore reports **no match** - and the panel, having nothing else to say, reports `Still not found` during what is in fact normal processing. This was the single most-reported confusion in the live flow. The result gains a third outcome for held-but-not-registered. A non-confirmed lookup must never be reported as an absence when the provider is known to hold the document, and it still must not terminalise the record: decision 7's rule that an indeterminate outcome is surfaced rather than resolved is unchanged.

**2. The in-flight lease becomes readable.** A concurrent attempt raises a 409. That is the correct answer to a write and useless to a reader: the surface cannot distinguish *someone else is registering this right now* - reassuring, requiring no action - from an error. The lease becomes a readable fact on the per-order projection ([ADR-065](./065-sales-document-read-surface.md)), so a surface can state it without attempting a registration. Visibility only: the lease semantics, the exactly-once guarantee and the 409 are unchanged.

**3. Reconcile answers from a closed vocabulary.** With the new locate outcome, a check can come back confirmed, not-registered, unsupported, or still-unknown. A panel offering *check with the provider* must be able to render each one, or it promises a resolution it cannot deliver. `still-unknown` leaves the record exactly where it was and is a legitimate answer, not a failure.

**4. Manual registration becomes asynchronous, and only then may any surface say the work survives navigation.** `POST /fiscal-registrations` calls the blocking adapter inline while the auto-issue gate already enqueues `fiscalization.register`. Two paths to one act, one of which dies with the tab: the *record* survives, the operator's view of it does not. The manual path moves onto the same job with the same idempotency key, plus a pollable read. Until that ships, no surface may claim background continuation - which is why the mockup deliberately tells the operator to keep the page open and names what happens if they do not.

**And one answer, so a surface can stop omitting it: a registered fiscal receipt cannot be corrected or cancelled in OpenLinker.** Fiscal corrections are out of scope for this capability (see § Decision), the correction happens at the register, and the panel states that rather than leaving an operator to guess. An invoice correction is unaffected - that is `CorrectionIssuer`'s job.

**What this amendment does not touch.** Exactly-once registration is the constraint all four decisions are bounded by: none of them may create a second path that crosses the provider boundary, and the artefact projection added alongside them carries no content and asserts no delivery - it exposes what an artefact IS (its medium, its label, its content type) and what the adapter INTENDS for it (its disposition hint), never the payload and never the fact of arrival. The distinction is the load-bearing one: a `send` disposition records that the adapter meant the artefact to be sent, and no shipped adapter reports whether a document reached a buyer, so nothing built on this projection may claim it did.

## References

- Related issues: #1902 (parent), #1908 (capability + adapter), #1910 (device sub-capability),
  #1909 (status/link on the order), #1911 (connection UI), #1907 (integrator access - unresolved),
  #1906 (certification and counterparty - closed for PL), #2051 (sibling sales-document routing,
  now [ADR-041](./041-sales-document-routing-policy.md)), #2054 (per-line tax rate contract work), #2058 (the ADR-014 reversal decision 8 is pending
  on - open, may be refused)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (sub-capability
  composition), [ADR-026](./026-country-agnostic-invoicing-domain.md) (the invoicing domain this
  deliberately does not extend, plus the VAT-rate amendment),
  [ADR-014](./014-source-authoritative-order-pricing.md) (rejects a per-line tax rate on
  `OrderItem`; that rejection stands until #2058 reverses it - decision 8),
  [ADR-035](./035-ctc-offline-degraded-mode-issuance-lifecycle.md) (the indeterminate-outcome
  lifecycle decision 7 mirrors, and the degraded-mode precedent decision 10 deliberately does not
  follow), [ADR-005](./005-postgres-authoritative-job-dedup.md) (durable dedup-gate precedent, with
  its delete-on-failure step deliberately not adopted).
  [ADR-041](./041-sales-document-routing-policy.md) (the sibling sales-document routing decision -
  which document type and which connection an order gets).
- Primary source: product spec [#1902](../../specs/product-spec-1902-eparagony-e-receipts.md) §4a
  (fiskaltrust / efsta contract research), §5 US-5, §6 (out of scope), §8 R1
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
  § Core Bounded Contexts, 16. Fiscalization
