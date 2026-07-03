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
| `Invoicing` | `RegulatoryTransmitter` (submit for clearance + read status), `RegulatoryStatusReader` (read status only), `RegulatoryDocumentReader` (download the UPO receipt), `CorrectionIssuer` (issue FA(3) KOR corrections) |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

## Credentials & config

**Credentials** (stored encrypted, set via the connection wizard or `PUT /connections/:id/credentials`; shape: `KsefCredentials`):

```json
{
  "authType": "ksef-token",
  "secret": "<KSeF authorisation token>"
}
```

`authType` is either `"ksef-token"` (API token from the KSeF portal) or `"qualified-seal"`
(qualified electronic seal — requires a certificate flow not covered by the wizard).
`secret` is the raw authentication secret for the selected mode; it is write-only and
never echoed back.

**Config** (set in the connection wizard or `config` field; shape: `KsefConnectionConfig`):

```json
{
  "env": "test",
  "seller": {
    "nip": "9999999999",
    "name": "Acme Sp. z o.o.",
    "address": {
      "line1": "ul. Testowa 1",
      "city": "Warszawa",
      "postalCode": "00-001",
      "countryIso2": "PL"
    }
  }
}
```

| Field | Values | Notes |
|---|---|---|
| `env` | `"test"` \| `"demo"` \| `"prod"` | `test` → `api-test.ksef.mf.gov.pl/v2`; `demo` → `api-demo.ksef.mf.gov.pl/v2`; `prod` → `api.ksef.mf.gov.pl/v2` |
| `seller` | Object | Seller identity (`Podmiot1`) stamped on every FA(3): `nip`, `name`, `address { line1, line2?, city, postalCode, countryIso2 }`, optional `defaultTaxRate`. Optional at create time, required before the connection can issue |
| `payment` | Object (optional) | Default payment details emitted as the FA(3) `Platnosc` block: `formaPlatnosci`, `paymentTermDays`, `bankAccount { nrRb, bankName?, swift? }`, `skonto { amount, conditions }`. See [docs/setup-guide.md](./docs/setup-guide.md) |

## Documentation

- **Operator tutorial** — [docs/tutorial.md](./docs/tutorial.md) — complete A-to-Z setup guide with screenshots
- **Developer setup guide** — [docs/setup-guide.md](./docs/setup-guide.md)
