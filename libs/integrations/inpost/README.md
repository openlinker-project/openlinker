# @openlinker/integrations-inpost

InPost ShipX adapter for OpenLinker — parcel machine and courier shipment label creation.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `inpost.shipx.v1` |
| **Platform type** | `inpost` |
| **Package** | `@openlinker/integrations-inpost` |

## Capabilities

| Capability | Notes |
|---|---|
| `ShippingProviderManager` | Create shipments, buy labels, generate waybills for InPost Paczkomat and InPost Kurier |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

## Credentials & config

**Credentials**:
```json
{
  "apiToken": "<InPost ShipX API token>"
}
```

**Config**:
```json
{
  "environment": "production",
  "organizationId": "12345",
  "senderAddress": {
    "name": "Acme Sp. z o.o.",
    "email": "magazyn@example.com",
    "phone": "+48123456789",
    "address": {
      "street": "ul. Testowa",
      "buildingNumber": "1",
      "city": "Warszawa",
      "postCode": "00-001",
      "countryCode": "PL"
    }
  }
}
```

| Field | Values | Notes |
|---|---|---|
| `environment` | `"sandbox"` \| `"production"` | `sandbox` targets `sandbox-api-shipx-pl.easypack24.net`; `production` targets `api-shipx-pl.easypack24.net` |
| `organizationId` | Numeric **string** | Visible in the ShipX dashboard or via `/v1/organizations` |
| `senderAddress` | Object (**required**) | Ship-from contact: `email`, `phone`, and `address { street, buildingNumber, city, postCode (PL format NN-NNN), countryCode (ISO alpha-2) }` are required; `name` optional |

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
