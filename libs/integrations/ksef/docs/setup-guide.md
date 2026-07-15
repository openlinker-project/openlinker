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

## Verification code (QR / kod weryfikacyjny)

Since **1 Feb 2026**, any structured invoice handed to a buyer **outside** the
KSeF system - a PDF, an email attachment, or an on-screen copy - must carry a QR
**verification code** (*kod weryfikacyjny*) when the buyer has no KSeF access.
This explicitly includes B2C consumers, buyers with no NIP, VAT-exempt buyers,
and foreign buyers - i.e. OpenLinker's dominant e-commerce scenario.

**OpenLinker emits KOD I (the online verification code).** Because OL always
issues invoices online (submit -> clear -> UPO), KOD I is all that is required.
KOD I is purely deterministic from **public** data and needs **no signing key or
certificate**. The FA(3) invoice preview renders it as a QR encoding:

```
https://{host}/invoice/{sellerNIP}/{DD-MM-RRRR}/{Base64URL(SHA256(rawInvoiceXml))}
```

- `host` - `ksef.mf.gov.pl` for `prod` connections, `qr-test.ksef.mf.gov.pl`
  for `test` / `demo` connections (taken from the connection's environment).
- `DD-MM-RRRR` - the invoice issue date.
- the hash - SHA-256 of the **exact submitted FA(3) XML bytes** (the persisted
  source document), Base64URL-encoded.

The KSeF number is shown as a caption beneath the QR. The code is generated
client-side in the invoice preview (`ksef-fa3-view`), so no additional
configuration is needed - it appears automatically once an invoice is cleared.

> **KOD II (the offline, certificate-signed verification code) is out of scope.**
> KOD II is only required for invoices issued in KSeF *offline* mode, which
> OpenLinker never uses. It is deliberately not implemented.

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
| VAT-payer / "biała lista" (MF whitelist) verification | **Deliberately deferred (#1595).** A well-formed, checksum-valid NIP is not necessarily an active VAT-registered entity, but whitelist verification is a seller due-diligence/AML concern, not a KSeF-issuance blocker (issuance succeeds regardless of the buyer's VAT-payer status). If pursued later it belongs as an optional pre-issuance advisory around MF's `wl-api.mf.gov.pl`, not a hard block on the core issuance path. NIP **checksum** (mod-11) validation, by contrast, ships now at the FE + API boundaries. |
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
- **MF certificate chain-of-trust (operator action for `prod`).** OpenLinker
  verifies each MF public-key certificate against a pinned MF root CA before using
  it to wrap a session secret. The authoritative Ministerstwo Finansow root CA is
  **not bundled** - set `OL_KSEF_MF_ROOT_CA_PATH` to a PEM file containing the MF
  root CA (and any intermediates) obtained from the MF/KSeF PKI publication. Until
  it is configured, chain-of-trust is **skipped** (a loud boot warning is logged)
  and trust relies on TLS transport security only. Configure this before `prod`.
- **Certificate revocation (documented limitation).** Live OCSP/CRL revocation
  checking is not performed today - the check is a tested seam with a no-network
  default. Combined with the enforced short validity window and TLS transport, this
  is an accepted MVP posture; a follow-up will add a networked OCSP/CRL checker.
- **Token least-privilege (operator responsibility).** KSeF exposes **no
  token-scope introspection endpoint**, so OpenLinker cannot machine-verify a
  token's granted permissions at connection-test time. Generate the ksef-token with
  **only** the "wystawianie faktur" (invoice-issuance) permission (see the
  tutorial). If a token lacks that permission, issuance fails with a **distinct**
  permission-denied error (`KsefPermissionDeniedException`, KSeF 403) surfaced
  separately from other auth failures - both at connection-test time and during
  issuance - rather than a generic authentication error.

---

## Additional resources

- KSeF API 2.0 documentation & OpenAPI: `https://api-test.ksef.mf.gov.pl/docs/v2`
- FA(3) schema: MF wzór `2025/06/25/13775`, schema version `1-0E`
- [ADR-026: Country-agnostic invoicing domain](../../../../docs/architecture/adrs/026-country-agnostic-invoicing-domain.md)
- [Architecture Overview — Invoicing context](../../../../docs/architecture-overview.md#14-invoicing)
