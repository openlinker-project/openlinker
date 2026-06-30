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
  "organizationId": 12345,
  "sandbox": false
}
```

`sandbox: true` targets `sandbox-api-shipx.easypack24.net` for testing.
The `organizationId` is visible in the ShipX dashboard or API response (`/v1/organizations`).

## Documentation

- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
