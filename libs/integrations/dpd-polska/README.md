# @openlinker/integrations-dpd-polska

DPD Polska adapter for OpenLinker — courier shipment label creation via the DPD REST API.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `dpd.polska.rest.v1` |
| **Platform type** | `dpd` |
| **Package** | `@openlinker/integrations-dpd-polska` |

## Capabilities

| Capability | Notes |
|---|---|
| `ShippingProviderManager` | Create DPD shipments and generate waybill labels (PDF) |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

## Credentials & config

**Credentials** (HTTP Basic-auth pair for the DPDServices REST API):
```json
{
  "login": "<DPD Webservice login>",
  "password": "<DPD Webservice password>"
}
```

**Config**:
```json
{
  "environment": "production",
  "payerFid": "12345",
  "senderAddress": {
    "company": "Acme Sp. z o.o.",
    "name": "Jan Kowalski",
    "address": "ul. Testowa 1",
    "city": "Warszawa",
    "postalCode": "00-001",
    "countryCode": "PL",
    "phone": "+48123456789",
    "email": "magazyn@example.com"
  }
}
```

| Field | Values | Notes |
|---|---|---|
| `environment` | `"sandbox"` \| `"production"` | Selects the DPD API base URL |
| `payerFid` | Numeric **string** | Payer FID (Firma ID) provided by DPD with the API credentials |
| `masterFid` | Numeric string (optional) | Master FID, when DPD assigned one |
| `senderAddress` | Object (**required**) | Ship-from contact: `address`, `city`, `postalCode` (PL format `NN-NNN`), `countryCode` (ISO alpha-2) are required; `company`, `name`, `phone`, `email` optional |

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
