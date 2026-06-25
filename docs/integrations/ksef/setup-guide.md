# KSeF Integration Setup Guide

OpenLinker integrates with **KSeF** (Krajowy System e-Faktur — the Polish
national e-invoicing system) as a fiscal-document provider: it issues FA(3)
structured invoices, submits them for clearance, and reconciles the
authority-assigned KSeF number + UPO (Urzędowe Poświadczenie Odbioru).

KSeF is the first provider of the country-agnostic **Invoicing** domain
([ADR-026](../../architecture/adrs/026-country-agnostic-invoicing-domain.md)).
All Polish/KSeF/FA terminology is confined to the `@openlinker/integrations-ksef`
package; `libs/core` stays country-neutral.

> **Status:** test-environment-first. Validate against `test`/`demo` before any
> production rollout. See [Limitations](#limitations) and
> [Compliance caveats](#compliance-caveats).

---

## Capabilities

| Capability | Supported | Notes |
|---|---|---|
| `Invoicing` (issue / get / supported-types) | ✅ | The registry capability the adapter advertises. |
| `RegulatoryTransmitter` (submit-for-clearance + status read) | ✅ | A sub-capability of `InvoicingPort`, narrowed at the call site via `isRegulatoryTransmitter`. It extends `RegulatoryStatusReader`. |
| `upsertCustomer` | ⚠️ pass-through | KSeF has no customer registry; the buyer identity travels inside the FA(3) document. |

- **adapterKey:** `ksef.publicapi.v2`
- **platformType:** `ksef`
- **displayName:** `KSeF Public API v2`
- **supported document types:** `invoice` (FA(3) `VAT`), `corrected` (FA(3) `KOR`) — from `getSupportedDocumentTypes()`.

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

Non-secret config persisted on the connection row (`KsefConnectionConfig`). What the
**guided wizard** actually writes today is a flat shape — `env` + `sellerNip` +
`contextIdentifier`:

| Field | Required | Collected by wizard | Description |
|---|---|---|---|
| `env` | ✅ | ✅ | `test` \| `demo` \| `prod`. The one field the C2 config-shape validator gates. |
| `sellerNip` | optional (server gate is `env` only) | ✅ | Seller NIP (10 digits, stored normalised). Display + future scoping; not yet gated by the C2 validator. |
| `contextIdentifier` | optional (≤64 chars) | ✅ | FE-additive scoping identifier the operator may supply. Not gated by the C2 config validator. |
| `seller` | required before issuing | ❌ (see limitation) | Full seller profile (`Podmiot1`) stamped on every FA(3): `seller.nip`, `seller.name`, `seller.address { line1, line2?, city, postalCode, countryIso2 }`. System config — **not** a credential and **not** per-invoice input. The issuance path (`resolveSeller`) reads `config.seller.{nip,name,address}` and throws `KsefConfigException` if any of name / address is missing. |

> **Known limitation — wizard does not yet collect the full seller profile.**
> The guided wizard collects only `env`, `sellerNip`, and `contextIdentifier`. It does
> **not** collect the seller **name** or **address**, and it does not write a nested
> `config.seller` object. Because `resolveSeller` requires a well-formed
> `config.seller.{nip,name,address}`, a connection created purely through the wizard
> **cannot issue** until the full `config.seller` block is supplied out-of-band — e.g.
> by pasting the raw config JSON (with the nested `seller` object) into the
> edit-connection form. Closing this gap (collecting seller name + address in the
> wizard and writing the nested `config.seller`) is a tracked follow-up.

Credentials (`KsefCredentials`, resolved via `CredentialsResolverPort`):

| Field | Required | Description |
|---|---|---|
| `authType` | ✅ | `ksef-token` \| `qualified-seal`. |
| `secretRef` | ✅ | Opaque reference to the secret in the credential store (never the secret value). Assigned by the platform — see [Obtaining credentials](#obtaining-credentials). |

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

The KSeF numeric status code maps onto the neutral `RegulatoryStatus`:

| KSeF `status.code` | Meaning | Neutral `regulatoryStatus` |
|---|---|---|
| `100`, `150` | Processing / in progress | `submitted` |
| `200` | Success (KSeF number assigned) | `accepted` |
| `400` (and other terminal business codes) | Rejected | `rejected` |
| `5xx` | Transient server error | *(not reported — the job retries)* |

`RegulatoryStatusValues`: `not-applicable | submitted | cleared | accepted | rejected`.
KSeF performs validation + clearance in one act, so a `200` maps straight to the
terminal-positive `accepted` (the `cleared` intermediate is reserved for regimes
that split the two).

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

---

## Limitations

OpenLinker's KSeF support is scoped to outbound issuance + clearance of FA(3)
`VAT` and `KOR` documents. Explicitly **not** supported today:

| Not supported | Rationale |
|---|---|
| Receipts / paragony (B2C fiscal receipts) | KSeF covers structured invoices; receipts are a separate fiscal regime. An invoice to a buyer without a NIP **is** supported (FA(3) `BrakID`). |
| Batch (wsadowa) submission pipeline | The online (interactive) session flow is implemented; the batch pipeline (`/sessions/batch`) is a separate, deferred path. |
| Inbound invoice retrieval | OpenLinker is a transmitter, not a KSeF inbox reader; pulling received invoices is out of scope. |
| FA_PEF / PEF documents | Only the FA(3) VAT/KOR schema is built. |
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
