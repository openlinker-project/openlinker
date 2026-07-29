# @openlinker/integrations-infakt

inFakt accounting SaaS adapter for OpenLinker — invoice issuance, corrections, and
KSeF clearance-status reads through inFakt's own native KSeF integration.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `infakt.accounting.v1` |
| **Platform type** | `infakt` |
| **Package** | `@openlinker/integrations-infakt` |

## Capabilities

| Capability | Key sub-capabilities |
|---|---|
| `Invoicing` | `InvoicingPort` (`issueInvoice`, `getInvoice`, `upsertCustomer`, `getSupportedDocumentTypes`), `RegulatoryStatusReader` (`getClearanceStatus`), `RegulatoryResubmitter` (`resubmitForClearance`), `CorrectionIssuer` (`issueCorrection`), `BankAccountsReader` (`listBankAccounts`), `BankAccountDefaultSetter` (`setDefaultBankAccount`), `RegulatoryDocumentReader` (`getRegulatoryDocument`, kind `rendered`), `PaymentStatusReader` (`getPaymentStatus`), `PaymentMarker` (`markPaid`), `InvoiceEmailSender` (`sendByEmail`) |

`RegulatoryTransmitter` is deliberately **not** implemented — see
[ADR-030](../../../docs/architecture/adrs/030-infakt-ksef-indirection.md). OL's adapter
does trigger submission (`send_to_ksef.json`, called inline at issuance), but clearance
timing and status ownership stay with inFakt's own KSeF integration, so that trigger
isn't surfaced as an independently-callable `RegulatoryTransmitter` method — only the
read side (`RegulatoryStatusReader`) makes sense as a public capability here.

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability
catalog.

## Credentials & config

Authentication uses a **static API key** (no OAuth).

**Credentials** (`InfaktCredentials`, resolved via `CredentialsResolverPort`):
```json
{
  "apiKey": "<inFakt API key>"
}
```

**Config** (`InfaktConnectionConfig`, non-secret, persisted on the connection row):
```json
{
  "baseUrl": "https://api.infakt.pl",
  "defaultPaymentMethod": "transfer",
  "bankAccount": {
    "id": "12345",
    "accountNumber": "PL00 0000 0000 0000 0000 0000 0000",
    "bankName": "mBank"
  }
}
```

`baseUrl` is optional — omit it to use inFakt's production API
(`INFAKT_DEFAULT_BASE_URL`); override it to point at a sandbox host.
`defaultPaymentMethod` and `bankAccount` are optional (see #1309/#1310 below) -
omit both to fall back to `cash` with no stamped account.

## Notable implementation details

- **KSeF-as-intermediary**: `issueInvoice` creates the document via
  `POST /invoices.json`, then explicitly calls `POST /invoices/{uuid}/send_to_ksef.json`
  inline (a draft does not auto-submit on its own) — after that, inFakt processes
  clearance through its own KSeF integration, on its own timing.
  `getClearanceStatus` reads `GET /invoices/{uuid}.json` and maps
  `ksef_data.status` (`pending | sent | success | error`) to the neutral
  `RegulatoryStatus`. See [ADR-030](../../../docs/architecture/adrs/030-infakt-ksef-indirection.md).
- **Gross→net conversion**: OL's neutral commands carry buyer-paid gross unit prices;
  the adapter converts to inFakt's expected net price per line using each line's
  `taxRate` before submitting.
- **Corrections**: `issueCorrection` fetches the original invoice, then submits to the
  **dedicated** `POST /corrective_invoices.json` endpoint — the generic `invoices.json`
  path 404s for corrective documents — carrying a before/after row pair per corrected
  line (`correction: false` / `correction: true`). The KSeF submit step also switches
  resource: `sendToKsef(uuid, 'corrective_invoices')`, since
  `corrective_invoices/{uuid}/send_to_ksef.json` is the only path that resolves for a
  corrective uuid (`invoices/{uuid}/send_to_ksef.json` 404s).
- **Resend to KSeF** (#1356, `RegulatoryResubmitter`): `resubmitForClearance` re-hits
  `send_to_ksef.json` for the SAME `providerInvoiceId` — it never re-POSTs
  `invoices.json`, so it cannot create a second draft. Backs the operator "resend"
  action on a document whose clearance ended in `rejected`; the HTTP layer gates the
  action to that status so an in-flight or already-accepted document is never re-sent.
- **Payment status sync** (#1354/#1362): `PaymentStatusReader.getPaymentStatus` reads
  `GET /invoices/{uuid}.json` and maps inFakt's payment fields to the neutral
  `PaymentStatus`; the inbound `invoice_marked_as_paid` / `invoice_marked_as_paid_via_async_api`
  webhooks are only a TRIGGER for an immediate re-read (see Inbound webhooks below),
  never trusted as the source of truth. The outbound counterpart, `PaymentMarker.
  markPaid`, pushes an authoritative "paid" state via
  `POST /async/invoices/{uuid}/paid.json` for orders settled elsewhere (e.g. a
  marketplace order the buyer paid off-platform, so inFakt's own bank-statement
  matching has nothing to reconcile against) — verified live to return a 201 async-task
  envelope; re-marking an already-paid invoice is safe.
- **Email delivery** (#1353, `InvoiceEmailSender`): `sendByEmail` triggers
  `POST /invoices/{uuid}/deliver_via_email.json`; inFakt composes and sends the message
  itself using the client's stored email (no recipient override) and flips the invoice
  status to `sent` on its side.
- **Per-connection default payment method** (#1309): `config.defaultPaymentMethod`
  (`cash | transfer`) is stamped as `payment_method` on every issued document;
  unset falls back to `cash`. `transfer` 422s on inFakt unless the seller's account
  has a bank account configured.
- **Bank-account picker with live inFakt default sync** (#1310): `BankAccountsReader.
  listBankAccounts()` (`GET /bank_accounts.json`) feeds the wizard and edit-form
  picker; the picked account is snapshotted into `config.bankAccount` and pushed back
  as the inFakt default via `BankAccountDefaultSetter.setDefaultBankAccount()`.
  `transfer` invoices carry the snapshot's `bank_account` / `bank_name` fields.
- **Rendered-PDF download** (#1321): `RegulatoryDocumentReader.getRegulatoryDocument
  (record, 'rendered')` fetches the invoice PDF as rendered by inFakt - this backs
  the **Download PDF** button on the accepted invoice detail page.
- **Inbound webhooks**, three collaborating classes: `InfaktWebhookTranslator` is the
  shared crypto/parsing core — `X-Infakt-Signature` verification (HMAC-SHA256 over the
  raw body), the subscription-verification handshake
  (`{"verification_code": "..."}` echo), and the event-name allowlist.
  `InfaktInboundWebhookDecoderAdapter` (`InboundWebhookDecoderPort`, ADR-021) wraps it
  to authenticate + decode at OL's generic `POST /webhooks/:provider/:connectionId`
  ingress. `InfaktWebhookEventTranslatorAdapter` (`WebhookEventTranslatorPort`,
  ADR-015) then maps the decoded envelope to one of TWO domains: `send_to_ksef_success`
  / `send_to_ksef_error` route to `invoicing` (triggers a `getClearanceStatus`
  re-read); `invoice_marked_as_paid` / `invoice_marked_as_paid_via_async_api` (#1354)
  route to `invoice-payment` (triggers a `getPaymentStatus` re-read). Every other event
  (e.g. `draft_invoice_created`) is acknowledged and ignored. Webhook subscriptions
  themselves are configured manually in the inFakt dashboard; there is no
  `WebhookProvisioningPort` for this adapter.
- **Retry classification**: `InfaktRetryClassifierAdapter` marks rate-limit and
  transient-network failures retryable, and validation/auth failures terminal, for the
  worker's job runner.
- **Shipping line on invoices** (#1517/#1562, core-level — not inFakt-specific): the
  order → `IssueInvoiceCommand` mapper appends a neutral gross shipping line whenever
  `order.totals.shipping > 0`, so the invoice gross total matches the buyer-paid order
  total; the adapter consumes `cmd.lines` verbatim like any other line. The label
  defaults to a neutral English string and can be overridden per-connection via
  `config.invoicing.shippingLineName` (any non-empty string, e.g. `"Shipping"` /
  `"Dostawa"`) — set it alongside `InfaktConnectionConfig` on the same connection row.

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — operator
  setup guide (connection creation, webhook configuration, troubleshooting)
- [ADR-030](../../../docs/architecture/adrs/030-infakt-ksef-indirection.md) — design
  rationale for the KSeF-intermediary model
- [ADR-026](../../../docs/architecture/adrs/026-country-agnostic-invoicing-domain.md) —
  the country-agnostic invoicing domain this provider plugs into
