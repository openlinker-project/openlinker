# KSeF Integration Setup Guide

OpenLinker integrates with **KSeF** (Krajowy System e-Faktur — the Polish
national e-invoicing system) as a fiscal-document provider: it issues FA(3)
structured invoices, submits them for clearance, and reconciles the
authority-assigned KSeF number + UPO (Urzędowe Poświadczenie Odbioru).

KSeF is the first provider of the country-agnostic **Invoicing** domain
([ADR-026](../../architecture/adrs/026-country-agnostic-invoicing-domain.md)).
All Polish/KSeF/FA terminology is confined to the `@openlinker/integrations-ksef`
package; `libs/core` stays country-neutral.

> **Status:** C2 plugin skeleton — connection creation and credential validation
> are wired, but issuance mechanics land in C4. This guide documents both the
> current wired behaviour and the C4+ target design; sections that describe
> future behaviour are explicitly marked. Validate against `test`/`demo` before
> any production rollout. See [Limitations](#limitations) and
> [Compliance caveats](#compliance-caveats).

---

## Capabilities

| Capability | Supported | Notes |
|---|---|---|
| `Invoicing` (issue / get / supported-types) | ⚠️ stub (C2) | The registry capability the adapter advertises. Issuance mechanics land in C4; `getSupportedDocumentTypes()` currently returns `[]` and mutating methods throw until C4 ships. |
| `RegulatoryTransmitter` (submit-for-clearance + status read) | ⚠️ planned (C4+) | A sub-capability of `InvoicingPort`, narrowed at the call site via `isRegulatoryTransmitter`. It extends `RegulatoryStatusReader`. The `KsefInvoicingAdapter` does not yet implement it. |
| `upsertCustomer` | ⚠️ pass-through | KSeF has no customer registry; the buyer identity travels inside the FA(3) document. |

- **adapterKey:** `ksef.publicapi.v2`
- **platformType:** `ksef`
- **displayName:** `KSeF Public API v2`
- **supported document types (C4+):** `invoice` (FA(3) `VAT`), `corrected` (FA(3) `KOR`) — returned by `getSupportedDocumentTypes()` once C4 issuance mechanics are wired.

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

> **Planned addition (C5) — seller profile.**
> The issuance path (C4+) will require a `seller` block on the config — the full seller profile
> (`Podmiot1`) stamped on every FA(3): `seller.nip`, `seller.name`, `seller.address
> { line1, line2?, city, postalCode, countryIso2 }`. This field does not exist on
> `KsefConnectionConfig` yet; its shape validation and wizard collection are tracked
> follow-ups that land alongside the C5 issuance work. Until then, `env` is the only
> config field the server gates.

> **Note:** the seller's tax identifier (NIP) is deliberately not stored on the connection
> config in C2. Per the config-shape validator's design, it travels with the issued document
> rather than living on the connection row. The `seller` block (C5) will introduce it as
> part of a structured seller-profile object, not as a bare `sellerNip` field.

Credentials (`KsefCredentials`, resolved via `CredentialsResolverPort`):

| Field | Required | Description |
|---|---|---|
| `authType` | ✅ | `ksef-token` \| `qualified-seal`. |
| `secretRef` | ✅ | Opaque reference to the secret in the credential store (never the secret value). Assigned by the platform — see [Obtaining credentials](#obtaining-credentials). |

---

## Issuance & clearance flow (async submit → poll → UPO) — planned (C4+)

> **Current state (C2):** the `KsefInvoicingAdapter` is a stub — `issueInvoice`,
> `upsertCustomer`, and `submitForClearance` all throw a "not yet implemented" error.
> The flow below describes the target design that lands in C4.

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

## Corrections (KOR) — planned (C4+)

A correction (`documentType: 'corrected'`) is issued as a normal FA(3) with
`RodzajFaktury = KOR`. The link to the original lives in the FA(3) body
(`DaneFaKorygowanej` → `NrKSeF` when the original was cleared, else `NrKSeFN`),
**not** in the send envelope. The send-layer `hashOfCorrectedInvoice` field is
reserved for a *technical* correction (korekta techniczna — re-submitting a
fixed copy of the same document) and is **not** used by the regular KOR flow.

---

## Limitations

OpenLinker's KSeF support targets outbound issuance + clearance of FA(3)
`VAT` and `KOR` documents. The integration is currently at **C2 (plugin skeleton)**;
the table below covers both current gaps and explicitly out-of-scope items:

| Not supported | Rationale |
|---|---|
| Issuance / clearance (C2 stub) | The `KsefInvoicingAdapter` is a stub — `issueInvoice`, `upsertCustomer`, and `submitForClearance` throw "not yet implemented". Mechanics land in C4. |
| Seller profile on connection config | `KsefConnectionConfig` currently only carries `env`. The `seller` block (NIP, name, address) is a C5 addition; without it a connection cannot issue. |
| Receipts / paragony (B2C fiscal receipts) | KSeF covers structured invoices; receipts are a separate fiscal regime. An invoice to a buyer without a NIP **is** planned (FA(3) `BrakID`) once issuance ships. |
| Batch (wsadowa) submission pipeline | The online (interactive) session flow is the C4 target; the batch pipeline (`/sessions/batch`) is a separate, deferred path. |
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
- [ADR-026: Country-agnostic invoicing domain](../../architecture/adrs/026-country-agnostic-invoicing-domain.md)
- [Architecture Overview — Invoicing context](../../architecture-overview.md#14-invoicing)
