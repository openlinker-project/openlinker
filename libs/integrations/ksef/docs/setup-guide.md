# KSeF Integration Setup Guide

OpenLinker integrates with **KSeF** (Krajowy System e-Faktur — the Polish
national e-invoicing system) as a fiscal-document provider: it issues FA(3)
structured invoices, submits them for clearance, and reconciles the
authority-assigned KSeF number + UPO (Urzędowe Poświadczenie Odbioru).

KSeF is the first provider of the country-agnostic **Invoicing** domain
([ADR-026](../../../../docs/architecture/adrs/026-country-agnostic-invoicing-domain.md)).
All Polish/KSeF/FA terminology is confined to the `@openlinker/integrations-ksef`
package; `libs/core` stays country-neutral.

> **Status:** shipped. Connection creation, credential validation, and full
> FA(3) issuance + clearance (`VAT` and `KOR` corrections) are wired end to
> end via the async submit → poll → UPO flow. Validate against `test`/`demo`
> before any production rollout. See [Limitations](#limitations) and
> [Compliance caveats](#compliance-caveats).

---

## Capabilities

| Capability | Supported | Notes |
|---|---|---|
| `Invoicing` (issue / get / supported-types) | ✅ | `issueInvoice` builds and submits the FA(3) XML (`VAT` or `KOR`) via the online-session flow; `getSupportedDocumentTypes()` returns `invoice` + `corrected`. |
| `RegulatoryTransmitter` (submit-for-clearance + status read) | ✅ | A sub-capability of `InvoicingPort`, narrowed at the call site via `isRegulatoryTransmitter`. It extends `RegulatoryStatusReader`. Implemented by `KsefInvoicingAdapter` — for KSeF, submission is folded into `issueInvoice` (see [Issuance & clearance flow](#issuance--clearance-flow-async-submit--poll--upo)), so `submitForClearance` is a documented no-op. |
| `CorrectionIssuer` (`issueCorrection`) | ✅ | Issues a FA(3) `KOR` correction of an already-issued document — see [Corrections (KOR)](#corrections-kor). |
| `upsertCustomer` | ⚠️ pass-through | KSeF has no customer registry; the buyer identity travels inside the FA(3) document. |

- **adapterKey:** `ksef.publicapi.v2`
- **platformType:** `ksef`
- **displayName:** `KSeF Public API v2`
- **supported document types:** `invoice` (FA(3) `VAT`), `corrected` (FA(3) `KOR`) — returned by `getSupportedDocumentTypes()`.

---

## Environments

KSeF API 2.0 runs on three public environments. OpenLinker selects one per
connection via the `env` config field; the base URL is resolved centrally
(`resolveKsefBaseUrl`) and never hand-built.

| `env` | Tier | API base URL |
|---|---|---|
| `test` | Testowe (Release Candidate) | `https://api-test.ksef.mf.gov.pl/v2` |
| `demo` | Przedprodukcyjne (Demo) | `https://api-demo.ksef.mf.gov.pl/v2` |
| `prod` | Produkcyjne (full legal force) | `https://api.ksef.mf.gov.pl/v2` |

> The API host is `api[-env].ksef.mf.gov.pl` with a bare `/v2` base path. The
> interactive docs/OpenAPI live at the same host under `/docs/v2`.
>
> The `test`/`demo` tiers are for integration testing only — never send real
> taxpayer data. On `test`, self-signed authentication is accepted and data is
> shared between integrators, so use random NIPs.

---

## Authentication

A KSeF connection authenticates in one of two modes (`credentials.authType`):

| `authType` | Flow |
|---|---|
| `ksef-token` | Static KSeF authorization-token flow (default for server-to-server). |
| `qualified-seal` | X.509 qualified-seal (pieczęć kwalifikowana) signing flow. |

The concrete secret is **never stored on the connection row**. Credentials carry
an opaque `secretRef`; the host's `CredentialsResolverPort` resolves the actual
token / seal material at adapter construction.

The handshake (token mode) is: request a **challenge** → **RSA-OAEP(SHA-256)-encrypt**
the `(token|timestampMs)` blob under the MF **token-encryption** public key → submit it →
**poll** the auth operation until `status.code === 200` → **redeem** the access + refresh
tokens. (`timestampMs` is the challenge timestamp in epoch milliseconds.)

The KSeF authorization token is **never** AES-encrypted. AES-256-CBC is used only for
**document** encryption: a per-document AES-256-CBC session key is itself RSA-OAEP(SHA-256)
wrapped with the MF certificate selected from `GET /security/public-key-certificates`. The
two crypto paths — RSA-OAEP for the auth token, RSA-OAEP-wrapped AES for the document — are
distinct.

### Obtaining credentials

1. Register/authorise your entity in the target KSeF environment (TEST/DEMO/PROD)
   per the [official KSeF documentation](https://api-test.ksef.mf.gov.pl/docs/v2).
2. Generate a KSeF authorization token (token mode) **or** provision a qualified
   seal certificate (seal mode) for the seller NIP.
3. Via the wizard, paste the raw secret into the **write-only** `credentials.secret`
   field. The platform persists it in the integration credentials store and assigns
   the opaque `secretRef` (`db:<uuid>`) itself — you do **not** pre-provision a vault
   reference. The secret value is never echoed back to the browser.

---

## Connection configuration

Non-secret config persisted on the connection row (`KsefConnectionConfig`):

| Field | Required | Collected by wizard | Description |
|---|---|---|---|
| `env` | ✅ | ✅ | `test` \| `demo` \| `prod`. Gated by the config-shape validator at connection create/update. |
| `seller` | ✅ for issuance | ✅ | Seller identity (`Podmiot1`) stamped on every FA(3): `seller.nip`, `seller.name`, `seller.address { line1, line2?, city, postalCode, countryIso2 }`. Optional at connection-create time, but required before the connection can issue. |
| `payment` | optional | ✅ (edit form) | Default payment details (#1311) emitted as the FA(3) `Platnosc` block on every issued invoice: `payment.formaPlatnosci` (payment-method code → `FormaPlatnosci`), `payment.paymentTermDays` (due date computed from the issue date → `TerminPlatnosci`), `payment.bankAccount { nrRb, bankName?, swift? }` (→ `RachunekBankowy`), and `payment.skonto { amount, conditions }` (early-payment discount → `Skonto`; both sub-fields required together). Omitting `formaPlatnosci` leaves payment info off issued invoices entirely. |

> **Note:** the seller's tax identifier lives on the connection's `seller.nip`
> field, not as a bare top-level `sellerNip` — it travels as part of the
> structured seller-profile object so the adapter can hand it straight to the
> FA(3) `SellerProfile` section.

Credentials (`KsefCredentials`, resolved via `CredentialsResolverPort`):

The operator submits `{ authType, secret }` — the raw token. The platform
stores it and assigns the opaque `secretRef` itself; `secretRef` is **not** a
field you provide (see [Obtaining credentials](#obtaining-credentials)).

| Field | Required | Description |
|---|---|---|
| `authType` | ✅ | `ksef-token` \| `qualified-seal`. |
| `secret` | ✅ | The raw authentication secret (KSeF authorization token for `ksef-token`). Write-only — persisted in the credential store behind the platform-assigned `secretRef` and never echoed back. |

---

## Issuance & clearance flow (async submit → poll → UPO)

KSeF clears invoices asynchronously: a submitted document is accepted into a
session, then processed; the KSeF number and UPO are assigned later.

```
issueInvoice(cmd)
  │  build FA(3) XML (VAT or KOR) from the neutral command
  ▼
POST /sessions/online                         → open encrypted session (sessionRef)
POST /sessions/online/{sessionRef}/invoices   → submit encrypted FA(3)  (invoiceRef)
POST /sessions/online/{sessionRef}/close      → close session
GET  /sessions/{sessionRef}                    → assert the session accepted ≥1 invoice
  ▼
InvoiceRecord  (regulatoryStatus: 'submitted', providerInvoiceId = "{sessionRef}:{invoiceRef}")

getClearanceStatus(record)        (polled later by the reconciliation job)
  │
  ▼
GET /sessions/{sessionRef}/invoices/{invoiceRef}   → status.code + ksefNumber + upoDownloadUrl
```

The `providerInvoiceId` opaquely packs both the session and invoice references
(`{sessionRef}:{invoiceRef}`) because the status/UPO reads are session-scoped.

> `submitForClearance` is the explicit `RegulatoryTransmitter` entry point in the neutral
> contract. For KSeF, submission is folded into `issueInvoice` (the online-session model
> opens a session, submits, and closes in one act), so a separate `submitForClearance`
> call is not part of the KSeF issuance path — clearance is driven by polling
> `getClearanceStatus`.

### Status mapping

The KSeF numeric status code maps onto the neutral `RegulatoryStatus`. These are
KSeF **processing body-codes** (returned inside a status response), **not** HTTP
status codes — so there is no range-banding (`5xx` etc.); each code is matched
explicitly. Only `400` / `440` / `445` are treated as terminal-rejected, and
unknown codes are deliberately non-terminal (keep polling):

| KSeF `status.code` | Meaning | Neutral `regulatoryStatus` |
|---|---|---|
| `100`, `150` | Processing / in progress | `submitted` |
| `200` | Success (KSeF number assigned) | `accepted` |
| `400`, `440`, `445` | Validation / business rejection / session closed with zero valid invoices | `rejected` |
| `550` | Transient processing error | *(not reported — null sentinel; the reconciliation job retries)* |
| any other / unknown | Unrecognised code | `submitted` (keep polling; logs a warning) |

`RegulatoryStatusValues`: `not-applicable | submitted | cleared | accepted | rejected`.
KSeF performs validation + clearance in one act, so a `200` maps straight to the
terminal-positive `accepted` (the `cleared` intermediate is reserved for regimes
that split the two).

> **Note — two distinct `100` codes.** The auth-poll handshake (above) uses
> `status.code === 200` for success and `100` for in-progress. That auth `100`
> (in-progress) is a **different code space** from the clearance `100`
> (processing → `submitted`) in this table — don't conflate them.

### UPO

Once accepted, the UPO is available at the `upoDownloadUrl` returned on the
invoice status, or via `GET /sessions/{sessionRef}/invoices/{invoiceRef}/upo`.
The KSeF number is the stable key into the UPO endpoint and is persisted as the
record's `clearanceReference`.

---

## Corrections (KOR)

A correction (`documentType: 'corrected'`) is issued as a normal FA(3) with
`RodzajFaktury = KOR`. The link to the original lives in the FA(3) body
(`DaneFaKorygowanej` → `NrKSeF` when the original was cleared, else `NrKSeFN`),
**not** in the send envelope. The send-layer `hashOfCorrectedInvoice` field is
reserved for a *technical* correction (korekta techniczna — re-submitting a
fixed copy of the same document) and is **not** used by the regular KOR flow.

KSeF has no delta-only correction primitive — every correction resubmits a
complete FA(3) document, so `CorrectionIssuer.issueCorrection` is a pure
delegation into the same online-session issuance path as `issueInvoice`.

**Issuance-time line snapshot (#1297).** The core `InvoiceRecord` persists an
`issuedLineSnapshot` (buyer, currency, lines) captured when the document was
issued (or, for a correction, the correction's own post-correction lines). The
HTTP controller assembles `IssueCorrectionCommand.originalDocument` from that
snapshot, so the `originalLineNumber`-indexed deltas diff against the lines
*as issued* - a later edit to the backing order does not change what the KOR
corrects, and a correction-of-correction diffs against the prior correction's
own lines. Only records issued before the snapshot column existed fall back to
rebuilding `originalDocument` from the order's *current* state (the pre-#1297
path, with its `buyerTaxId: null` and line-fidelity caveats).

---

## Session-lifecycle resilience (offline24 + crash recovery, epic #1585)

A KSeF online session can fail in two operator-visible ways. Both are handled by
neutral core sweeps (no KSeF vocabulary in `libs/core`), scheduled per `Invoicing`
connection and driven by ADR-002 sub-capabilities the KSeF adapter implements.

### Offline24 degraded-mode issuance + resubmission (#1700 / #1701 / #1702)

When KSeF is unreachable at issue time, the regime permits issuing a document
with **legal effect** locally and transmitting it once the authority recovers (a
bounded "offline" grace window). The adapter builds and locally issues the FA(3),
returns `status='issued'` with the neutral `regulatoryStatus='pending-submission'`
(non-terminal) and `providerInvoiceId=null` (no session landed - a reference is
NEVER fabricated), and rides the FA(3) XML back as the neutral source document.

The scheduled `invoicing.offlineSubmission.resubmit` sweep (core
`OfflineResubmissionService`, worker `OfflineResubmitHandler`) later calls the
`OfflineResubmitter` sub-capability (`resubmit`) once KSeF is back, retransmitting
the persisted XML and advancing the record to `submitted` (then `accepted` via the
normal clearance poll). A still-unreachable authority just leaves the record
`pending-submission` for the next run. `resubmit` opens the fresh session with the
**current** instant, never the document's (possibly days-old) legal issue date -
the FA(3) `P_1` is already baked into the stored XML, and a stale timestamp would
yield an expired session key (status 430, #1585 I4).

**Double-issue guard (fails closed, #1585 B1).** A submit whose request reached
KSeF but whose response timed out is classified unavailable and parked as
`pending-submission` even though it actually cleared - a blind resubmit would then
duplicate a national fiscal record (KSeF does not dedupe by human number). Three
layers close this:

1. **Settling margin.** A record is only eligible once it has been
   `pending-submission` for at least the settling margin
   (`repo.findPendingSubmission({ olderThan })`), giving a landed-but-unindexed
   document time to appear in KSeF's eventually-consistent metadata index. The
   default is **30 minutes** - deliberately much larger than the ~5-minute CAS
   lease (#1585 F4), because the offline window is entered precisely when KSeF was
   unavailable, so on recovery its indexing can trail by tens of minutes.
   Override with `OL_OFFLINE_RESUBMIT_SETTLING_MARGIN_MS` (a non-positive value
   falls back to the default).
2. **Per-record CAS claim.** Each record is leased (`repo.claimPendingSubmission`)
   before any authority call, so two overlapping sweep runs (cron is `*/15`, a run
   can outlast the interval) - or a run racing the live issuance path - can never
   both resubmit the same document.
3. **Confirm-non-receipt.** With the locator present, the sweep queries KSeF for
   the document FIRST; if found it reconciles WITHOUT resubmitting. An adapter that
   is **not** a `RegulatoryRecordLocator` cannot confirm receipt, so the sweep does
   **not** blind-resubmit it - it leaves the record `pending-submission` for manual
   handling (surfaced by the lingering WARN below).

Because this guard's safety ultimately rests on the unverified
`POST /invoices/query/metadata` wire contract, the offline-resubmit sweep
**defaults OFF** (`OL_OFFLINE_RESUBMIT_ENABLED` opt-in, #1585 B1). Verify the
metadata-query request/response shape against your KSeF environment (a landed
document must surface in the index, and the `invoiceNumber` / `sellerNip` filters
must be honoured) before enabling it in production. A receipt-ambiguous failure -
a post-request read timeout (the request was sent, so the document MAY have
landed) or an HTTP `408`/`425` - is **never** parked as `pending-submission`
(#1585 F5): it throws and routes the record to `in-doubt` for manual
reconciliation, since auto-resubmitting a possibly-landed document would
double-issue. Only a pre-receipt failure (DNS/TLS/connection-refused) or a `429`
/ `5xx` is offline-eligible.

### Crash recovery for stuck `pending` / `issuing` records (#1703)

`issueInvoice` opens a session, submits, and closes it in a `finally`. If the
worker is killed **between a successful submit and the `finally`**, `closeSession`
never runs and the record stays non-terminal - `status='pending'` (never CAS-
claimed) or `status='issuing'` with a CAS lease that eventually expires.
`POST /invoices/retry` deliberately skips `pending`, and nothing else revisits it.

The scheduled `invoicing.pendingRecovery.sweep` (core `PendingRecoveryService`,
worker `PendingRecoveryHandler`) is the recovery path. It selects rows stuck past
a safety margin (`repo.findStuckPending`, margin = one `ISSUING_LEASE_MS` window
beyond the lease/last-update so a legitimately in-flight attempt is never swept).
The two stuck shapes are **not** fiscally equivalent, so each is handled differently:

- **`status='pending'` (never CAS-claimed → never transmitted).** The crash
  happened before the provider boundary was crossed, so nothing landed at KSeF -
  unambiguously safe to **re-drive**. The sweep requeues the record's original
  dead `invoicing.issue` job (by its idempotency key); re-running the SAME keyed
  job resumes issuance against the existing row through the `issued`-only
  exactly-once gate (no double-issue). It is **never** marked in-doubt - doing so
  would strand the order with no document AND make `claimForIssue` permanently
  exclude the row. A `pending` row with no idempotency key (or whose job was
  pruned) is left `pending` (still claimable) for manual re-issue.

- **`status='issuing'` with a lapsed lease (crashed post-claim → may have landed).**
  OL cannot know from its own state whether KSeF received the interrupted document,
  so it resolves it via the **query-metadata fallback**
  (`RegulatoryRecordLocator.locateByQuery`, #1701): the adapter queries
  `POST /invoices/query/metadata` by seller NIP + issue-date window + document
  number (a positive match REQUIRES an exact document-number hit - a lone
  date-window result is never trusted, #1585 B1).
  - **Found with a valid KSeF number** → reconcile: `status='issued'`,
    `regulatoryStatus='accepted'`, clearance reference set, WARN "recovered
    orphaned invoice". A hit still processing (no KSeF number yet) maps to the
    non-terminal `pending-submission` - NOT `submitted` (#1585 I6/F3): the
    metadata query cannot reconstruct the session-scoped composite the clearance
    poll needs, and a `submitted`+null record would be re-selected by the poll and
    throw every tick. `pending-submission` is excluded from the poll and re-checked
    by the offline sweep, which promotes it to `accepted` once the number appears.
    A located `rejected` records the rejection **without** forcing `status='issued'`.
  - **Not found** (or the adapter ships no locator) → **fiscal-safe**: mark
    `status='failed'` with the `in-doubt` failure mode + the `transport-timeout`
    failure code (whose operator copy correctly warns "a document may already
    exist - verify before re-issuing", #1585 I8) + an operator-visible alert, and
    **never auto-retry** - a silent re-issue could double-issue a fiscal document
    whose original attempt actually landed. Uncertainty always resolves to a
    human, never an automatic re-attempt.

### Status-code safety net

The clearance `status.code` mapping above already treats unknown codes as
non-terminal (keep polling) and only `400`/`440`/`445` as terminal-rejected, so a
transient/unrecognised KSeF response can never strand a document in a wrong
terminal state. The crash-recovery sweep is the second-layer net: it also emits
the "session sat non-terminal longer than the expected window" WARN/metric, so a
record that outlives its issuance window is always surfaced.

The always-on crash-recovery sweep emits a **business-day-aware lingering WARN**
(#1585 F6) on the oldest `pending-submission` record once it exceeds ~20 h of
**business** time (weekends excluded, so a Friday-evening outage does not raise a
Saturday alarm for a deadline that is really Monday). It lives on the
`invoicing.pendingRecovery.sweep` (default ON) - NOT the offline-resubmit sweep
(default OFF, #1585 B1) - so a lingering document is surfaced even when
auto-resubmission is disabled. The WARN names the record id + business age +
pending-submission count so an operator can act before any legal window is missed.
(Enforcing the deadline as a hard state transition, and escalating the WARN to an
email/push/KPI, remain deferred - see *v1 scope vs deferred* above.)

### Scheduling / env vars

Both sweeps are capability-scoped (`Invoicing`) core scheduler tasks, fanned out
one job per connection, alongside the #1121 regulatory-status reconcile sweep:

| Sweep | Job type | Enable | Cron | Default cron |
|---|---|---|---|---|
| Regulatory-status reconcile (#1121) | `invoicing.regulatoryStatus.reconcile` | `OL_REGULATORY_RECONCILE_ENABLED` (ON) | `OL_REGULATORY_RECONCILE_CRON` | `*/30 * * * *` |
| Offline-submission resubmit (#1702) | `invoicing.offlineSubmission.resubmit` | `OL_OFFLINE_RESUBMIT_ENABLED` (**OFF**) | `OL_OFFLINE_RESUBMIT_CRON` | `*/15 * * * *` |
| Crash-recovery sweep (#1703) | `invoicing.pendingRecovery.sweep` | `OL_PENDING_RECOVERY_ENABLED` (ON) | `OL_PENDING_RECOVERY_CRON` | `*/20 * * * *` |

The reconcile and crash-recovery flags default **ON**; the offline-resubmit flag
defaults **OFF** and is opt-in until its metadata-query wire contract is verified
(#1585 B1 - see the double-issue guard above). Set a flag to `false` to disable,
or `OL_OFFLINE_RESUBMIT_ENABLED=true` to enable resubmission. Each `*_CRON`
overrides the default expression;
`OL_OFFLINE_RESUBMIT_SETTLING_MARGIN_MS` (default 30 min) tunes the
confirm-non-receipt settling margin.

### v1 scope vs deferred

- **Shipped (v1):** offline24 degraded-mode issuance + resubmission, crash recovery
  via the query-metadata fallback, and the status-code safety net.
- **Deferred:** the MF-announced `offline` (planned outage) and `awaria` (declared
  KSeF failure) regimes as distinct modes, and legal deadline-window enforcement
  (next-business-day transmission for a bounded grace period). A still-unreachable
  authority currently just leaves the record `pending-submission` for the next run,
  with no deadline tracking.
- **Deferred (offline-mode document marking):** the FA(3) resubmitted from the
  `pending-submission` window is the plain online-mode document. The offline/awaria
  regimes generally add an offline marking (+ verification/QR data) so the
  authority/buyer can tell a deferred-transmission document apart. v1 does not emit
  that marking (offline24 tolerates a plain resubmit within the grace window);
  emitting it lands with the deferred `offline`/`awaria` modes above.

### What an operator does with a pending-submission / in-doubt invoice

- **`KSeF: awaiting submission` (regulatory `pending-submission`).** The document is
  legally issued but not yet at KSeF; a sweep is retransmitting it. **No action** is
  normally owed. If the lingering WARN fires (record past ~20 h of business time),
  check KSeF availability - a prolonged outage may need the document transmitted
  manually before the next-business-day deadline, or `OL_OFFLINE_RESUBMIT_ENABLED`
  turned on so the sweep retransmits it automatically once KSeF recovers.
- **`Needs review` (issuance `failed` + `in-doubt`).** A crashed submit could not be
  confirmed - **a document may already exist at KSeF**. Do **not** blind-retry.
  Verify in the KSeF portal (by the document number) whether it landed; if it did,
  no re-issue is needed, otherwise re-issue deliberately. The record carries the
  `transport-timeout` code precisely so the UI copy warns against a duplicate.

> The "operator-visible alert" in this flow is a structured WARN log + the record's
> `failureReason` / badge today; a one-click "Mark resolved" UI action + an aggregate
> pending-submission KPI are a follow-up (see PR #1711 review).

### Data-at-rest note (offline source document)

An offline `pending-submission` record persists the full FA(3) XML (buyer name,
NIP, address, lines, amounts) in the `sourceDocument` jsonb column, **base64-encoded
(encoding, not encryption)** - the same mechanism the happy path uses, but for an
offline document the DB row is the *only* copy of a legally-issued invoice and it
dwells there until the authority recovers (hours, longer if it degrades to
in-doubt). This is an **accepted risk for v1** (documented, not mitigated here);
application-level encryption of `sourceDocument` at rest - or purging the blob once
the record leaves `pending-submission` - is a tracked follow-up.

---

## Limitations

OpenLinker's KSeF support targets outbound issuance + clearance of FA(3)
`VAT` and `KOR` documents. The table below covers explicitly out-of-scope items:

| Not supported | Rationale |
|---|---|
| Receipts / paragony (B2C fiscal receipts) | KSeF covers structured invoices; receipts are a separate fiscal regime. An invoice to a buyer without a NIP **is** planned (FA(3) `BrakID`) as a follow-up. |
| Batch (wsadowa) submission pipeline | OpenLinker issues via the online (interactive) session flow (`/sessions/online`); the batch pipeline (`/sessions/batch`) is a separate, deferred path. |
| Inbound invoice retrieval | OpenLinker is a transmitter, not a KSeF inbox reader; pulling received invoices is out of scope. |
| FA_PEF / PEF documents | Only the FA(3) VAT/KOR schema is planned. |
| Auto-generated API reference | See the official OpenAPI at `https://api-test.ksef.mf.gov.pl/docs/v2`. |

---

## Compliance caveats

- **Test-environment-first.** Run end-to-end against `test`/`demo` before
  enabling `prod`. The `test`/`demo` tiers must never carry real taxpayer data.
- **Mandate timing.** The KSeF e-invoicing obligation rolls out on the schedule
  published by the Ministry of Finance (Ministerstwo Finansów); verify the
  current effective dates for your taxpayer category against the latest MF
  announcement before relying on `prod`.
- **Structural validation only.** OpenLinker validates FA(3) output against the
  vendored authoritative XSD's required-structure rule set (not a full native
  XSD engine — a deliberate constrained-CI decision). Run the MF example-pack /
  test-environment validation as the authoritative gate before production.
- **Art. 108g payment-title note.** Carrying the KSeF number on the payment
  title (Art. 108g) is tracked as future work and is not emitted today.

---

## Additional resources

- KSeF API 2.0 documentation & OpenAPI: `https://api-test.ksef.mf.gov.pl/docs/v2`
- FA(3) schema: MF wzór `2025/06/25/13775`, schema version `1-0E`
- [ADR-026: Country-agnostic invoicing domain](../../../../docs/architecture/adrs/026-country-agnostic-invoicing-domain.md)
- [Architecture Overview — Invoicing context](../../../../docs/architecture-overview.md#14-invoicing)
