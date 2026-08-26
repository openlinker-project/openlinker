# @openlinker/integrations-eparagony

eparagony.pl fiscalization adapter for OpenLinker — registers a completed sale as a
Polish fiscal e-receipt with the seller's own online fiscal printer.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `eparagony.documents.v3` |
| **Platform type** | `eparagony` |
| **Package** | `@openlinker/integrations-eparagony` |
| **Capability** | `Fiscalization` |

## What this adapter is, and is not

OpenLinker can never *issue* a Polish fiscal receipt — issuance is reserved to a
certified registering device (art. 111 ust. 3a pkt 1 ustawy o VAT). That states what the
statute says and is **not legal advice** — no seller-facing compliance claim should rest
on it without a professional opinion. eparagony.pl is an e-receipt distribution hub
fronting vendor-proprietary software that drives a physical online fiscal printer
(Posnet / Novitus / Elzab); this adapter hands a completed sale to that hub and reads
back the outcome. It never performs fiscal registration itself. See
[ADR-042](../../../docs/architecture/adrs/042-fiscalization-capability.md) for the full
design rationale — this package is the first (and, at time of writing, only) adapter
against the neutral `FiscalizationPort` in `libs/core/src/fiscalization/`.

## Capabilities

| Capability | Methods |
|---|---|
| `FiscalizationPort` (base) | `registerTransaction(cmd)` |
| `FiscalRegistrationLocator` | `locateByQuery(criteria)` — resolves an `in-doubt` outcome by reading the provider's own status, never by resubmitting |

No device/peripheral sub-capability is implemented: `print` and `fiscalize` are booleans
inside the `eReceipt` request payload, not separate endpoints, so there is nothing for a
device sub-capability to call. See [ADR-042 § Decision 5](../../../docs/architecture/adrs/042-fiscalization-capability.md).

## Credentials & config

**Credentials**:
```json
{
  "clientId": "<OAuth2 client-credentials client id>",
  "clientSecret": "<OAuth2 client-credentials secret>",
  "integrationId": "openlinker:<secret>"
}
```
`integrationId` is optional — issued only to multi-customer integrators. Live probing
found it unenforced on GET requests, so a connection without it still works.

**Config**:
```json
{
  "environment": "sandbox",
  "posId": "openlinker",
  "taxRates": { "A": "23", "B": "8" },
  "defaultTaxRateCode": "A",
  "print": false,
  "paymentForm": "Przelew",
  "fiscalDeviceUniqueNumber": "ZBN1901007833"
}
```

| Field | Values | Notes |
|---|---|---|
| `environment` | `sandbox` \| `production` | Required. Selects both the documents-API host and the OAuth host — they are different hosts (`[login.]sandbox.eparagony.pl` vs `[login.]eparagony.pl`) |
| `posId` | non-empty string | Required. Vendor-assigned register identifier, stamped on every document |
| `taxRates` | `{ [A-G]: "<rate>" }` (optional) | Letter → rate table sent as `metadata.taxRates`. Describes the SELLER's device configuration — OpenLinker cannot observe it, so an operator whose device is programmed differently **must** override the default (`A`=23%, `B`=8%, `C`=5%, `D`/`F`/`G`=0%, `E`=exempt). **Left unconfigured, every registration silently assumes that exact layout.** A device programmed with different slots will register real sales under the WRONG tax rate with no error from OpenLinker — this is not a rate OL computed or verified, it is a guess about hardware OL cannot see. Confirm your device's actual slot assignment with your `serwisant` before registering anything for real |
| `defaultTaxRateCode` | one of `A`-`G` (optional) | Rate slot used only when a line's neutral `taxRate` is empty (OL resolved none). Absent means an un-rated line blocks registration with an operator-facing reason — never a guessed rate |
| `print` | boolean (optional, default `false`) | Ask the vendor's print service to also produce a paper receipt |
| `paymentForm` | one of the vendor's Polish payment-form labels (optional, default `Przelew`) | Purely descriptive; the vendor rejects a document whose declared payment amount ≠ the sale value regardless of the label |
| `paymentName` | string (optional) | Free-text payment descriptor (card scheme, PSP) |
| `statusPollTimeoutMs` | number (optional) | Bounded by the adapter to stay inside core's supported provider round-trip ceiling |
| `fiscalDeviceUniqueNumber` | string (optional) | **Diagnostic only** — used by "Test connection" to report device liveness. Never sent on a document |
| `apiBaseUrl` / `authBaseUrl` | https URL (optional) | Overrides for either host; intended for testing |

## Notable implementation details

- **The vendor's contract is not frozen.** New fields may appear without notice on any
  response, and the documented error-code list is not exhaustive (`errorCode: 92` was
  observed live for a missing document, undocumented in the vendor's own spec). Every
  response parse is tolerant.
- **Two separate hosts.** OAuth lives on `login[.sandbox].eparagony.pl`; the documents
  API lives on `[sandbox.]eparagony.pl`. Pointing the token request at the API host is
  the first mistake an integrator makes — `eparagony-hosts.policy.ts` names the mapping
  explicitly rather than leaving it as an inline string.
- **Deterministic document/transaction tokens.** The vendor's only document lookup is a
  path parameter (`GET /documents/{documentToken}/status`) with no search by order id or
  idempotency key, so the adapter derives both tokens from `(connectionId,
  idempotencyKey)` via a namespaced SHA-256 digest shaped as a UUID
  (`document-token.policy.ts`). Same inputs, same token, forever — this is what makes
  `FiscalRegistrationLocator` implementable against this vendor at all.
- **The `Idempotency-Key` HTTP header carries the derived `documentToken`, never core's
  raw `idempotencyKey`.** The vendor requires that header to match `/^[0-9A-Za-z_-]+$/`;
  core's key (`fiscal:{connectionId}:{orderId}`) contains colons and fails it outright.
  `documentToken` is already a deterministic derivation of the same pair, in a
  vendor-compliant character set — verified against the live sandbox.
- **`registerTransaction` blocks on a bounded status poll.** `POST /documents` returns
  `202 Accepted` before the device has printed or registered anything, and `registered`
  is terminal in core, so returning at `202` would report a completed registration that
  does not exist. The adapter polls `GET /documents/{token}/status` to a terminal status
  inside a wall-clock budget kept under core's supported provider round-trip ceiling
  (mirrors `InfaktInvoicingAdapter`'s async-task poll pattern).
- **Every failure is classified towards `in-doubt`, never `rejected`, unless the
  provider demonstrably created nothing.** A wrong `rejected` invites a resend, and a
  sale registered twice is a legal event for the seller (ADR-042). A poll-budget timeout
  is `in-doubt` by construction — the create already succeeded, and the device may
  still confirm later. Verified live: a registration that timed out as `in-doubt` was
  later found `CONFIRMED` by `locateByQuery`, with a real receipt number, signing
  identity, and receipt-link artefact.
- **The buyer-facing `documentUrl` link is withheld until the provider reports
  `CONFIRMED`.** An unconfirmed-but-not-failed response is still a *successful*
  registration per ADR-042 decision 2 — a registered record with no artefact yet is not
  an incomplete result.
- **`locateByQuery` answers from three outcomes, so normal processing is not reported as
  an absence.** A document the vendor holds at a non-terminal status - or at a status this
  build does not recognise - answers `held`, which core surfaces as the `still-unknown`
  reconcile outcome and which leaves the record exactly where it was. Only `CONFIRMED`
  answers `registered`; a vendor-reported `ERROR` answers `not-found`, because a failed
  document is an absence of a registration rather than work still in progress (ADR-042
  amendment #2502, decision 1). Read `not-found` as "no registration exists for these
  coordinates", never as "the provider holds nothing" - on the `ERROR` path it holds a
  document and reports it failed.
- **Known gap: no webhook ingress.** The vendor delivers a confirmed status by webhook
  (`X-Signature` = `hash_hmac('sha256', rawBody, webhookSecret)`), which does not fit
  this repo's existing `WebhookEventTranslator` seams cleanly in v1 — the synchronous
  status-read path (poll + `locateByQuery`) covers the same ground. See the
  implementation plan for the full reasoning.

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [docs/runbook.md](./docs/runbook.md) — operational runbook
- [ADR-042](../../../docs/architecture/adrs/042-fiscalization-capability.md) — design rationale
