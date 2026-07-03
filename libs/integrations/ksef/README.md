# @openlinker/integrations-ksef

KSeF (Krajowy System e-Faktur) adapter for OpenLinker — issues fiscal documents and
submits them to the Polish national e-invoicing clearance system.

## What this package does

Connects OpenLinker to the **KSeF REST API v2** to:

- Issue FA(3) VAT invoices and correction invoices (KOR) for ingested orders.
- Submit issued documents to MF clearance asynchronously (submit → poll → UPO).
- Read the regulatory clearance status (`submitted → cleared → accepted | rejected`).
- Stamp per-connection default payment details (method, term, bank account, skonto) onto every issued invoice as the FA(3) `Platnosc` block.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `ksef.publicapi.v2` |
| **Platform type** | `ksef` |
| **Package** | `@openlinker/integrations-ksef` |

## Capabilities

| Capability | Sub-capabilities |
|---|---|
| `Invoicing` | `RegulatoryTransmitter` (submit for clearance + read status), `RegulatoryStatusReader` (read status only) |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

## Credentials & config

**Credentials** (stored encrypted, set via the connection wizard or `PUT /connections/:id/credentials`):

```json
{
  "token": "<KSeF authorisation token>",
  "authType": "ksef-token"
}
```

`authType` is either `"ksef-token"` (API token from the KSeF portal) or `"qualified-seal"`
(qualified electronic seal — requires a certificate flow not covered by the wizard).

**Config** (set in the connection wizard or `config` field):

```json
{
  "environment": "test",
  "nip": "9999999999",
  "sellerName": "Acme Sp. z o.o.",
  "sellerAddress": {
    "street": "ul. Testowa 1",
    "city": "Warszawa",
    "postalCode": "00-001"
  }
}
```

| Field | Values | Notes |
|---|---|---|
| `environment` | `"test"` \| `"demo"` \| `"prod"` | `test` → `api-test.ksef.mf.gov.pl/v2`; `demo` → `api-demo.ksef.mf.gov.pl/v2`; `prod` → `api.ksef.mf.gov.pl/v2` |
| `nip` | Polish tax ID (NIP) of the seller | |
| `sellerName` | Legal name | Required for FA(3) header |
| `sellerAddress` | Street, city, postalCode | Required for FA(3) header |

## Documentation

- **Operator tutorial** — [docs/tutorial.md](./docs/tutorial.md) — complete A-to-Z setup guide with screenshots
- **Developer setup guide** — [docs/setup-guide.md](./docs/setup-guide.md)

## Source layout

```
src/
├── ksef.constants.ts               # KSEF_ADAPTER_KEY, KSEF_BRAND
├── ksef-plugin.ts                  # Plugin descriptor + manifest
├── ksef-integration.module.ts      # NestJS module (wires DI)
└── infrastructure/
    └── adapters/
        ├── ksef-invoicing.adapter.ts          # InvoicingPort + RegulatoryTransmitter
        ├── ksef-http-client.ts                # Authenticated KSeF HTTP client
        ├── ksef-auth-session.ts               # RSA-OAEP session challenge/response
        └── fa3-xml-builder.ts                 # FA(3) XSD-valid XML builder
```
