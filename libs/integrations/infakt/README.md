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
| `Invoicing` | `InvoicingPort` (`issueInvoice`, `getInvoice`, `upsertCustomer`, `getSupportedDocumentTypes`), `RegulatoryStatusReader` (`getClearanceStatus`), `CorrectionIssuer` (`issueCorrection`) |

`RegulatoryTransmitter` is deliberately **not** implemented — see
[ADR-030](../../../docs/architecture/adrs/030-infakt-ksef-indirection.md). inFakt
submits to KSeF on its own, so there is no submit primitive for OL to call; only the
read side (`RegulatoryStatusReader`) makes sense here.

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
  "baseUrl": "https://api.infakt.pl"
}
```

`baseUrl` is optional — omit it to use inFakt's production API
(`INFAKT_DEFAULT_BASE_URL`); override it to point at a sandbox host.

## Notable implementation details

- **KSeF-as-intermediary**: `issueInvoice` creates the document via
  `POST /invoices.json`; inFakt submits it to KSeF internally on its own timing.
  `getClearanceStatus` reads `GET /invoices/{uuid}.json` and maps
  `ksef_data.status` (`pending | sent | success | error`) to the neutral
  `RegulatoryStatus`. See [ADR-030](../../../docs/architecture/adrs/030-infakt-ksef-indirection.md).
- **Gross→net conversion**: OL's neutral commands carry buyer-paid gross unit prices;
  the adapter converts to inFakt's expected net price per line using each line's
  `taxRate` before submitting.
- **Corrections**: `issueCorrection` fetches the original invoice, then submits a
  `corrective` document carrying a before/after row pair per corrected line
  (`correction: false` / `correction: true`).
- **Inbound webhooks**: `InfaktWebhookTranslator` verifies
  `X-Infakt-Signature` (HMAC-SHA256 over the raw body) and handles inFakt's
  subscription-verification handshake (`{"verification_code": "..."}` echo). Only
  `send_to_ksef_success` / `send_to_ksef_error` route to a domain event; every other
  event (`draft_invoice_created`, `invoice_marked_as_paid`, …) is acknowledged and
  ignored. Wired into OL's generic `POST /webhooks/:provider/:connectionId` ingress via
  `InfaktInboundWebhookDecoderAdapter` (ADR-021) — webhook subscriptions themselves are
  configured manually in the inFakt dashboard; there is no `WebhookProvisioningPort`
  for this adapter.
- **Retry classification**: `InfaktRetryClassifierAdapter` marks rate-limit and
  transient-network failures retryable, and validation/auth failures terminal, for the
  worker's job runner.

## Documentation

- [docs/setup-guide.md](../../../docs/integrations/infakt/setup-guide.md) — operator
  setup guide (connection creation, webhook configuration, troubleshooting)
- [ADR-030](../../../docs/architecture/adrs/030-infakt-ksef-indirection.md) — design
  rationale for the KSeF-intermediary model
- [ADR-026](../../../docs/architecture/adrs/026-country-agnostic-invoicing-domain.md) —
  the country-agnostic invoicing domain this provider plugs into
