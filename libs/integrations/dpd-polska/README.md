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

**Credentials**:
```json
{
  "login": "<DPD Webservice login>",
  "password": "<DPD Webservice password>",
  "fid": 12345
}
```

`fid` (Firma ID) is provided by DPD along with the API credentials.

**Config**:
```json
{
  "sandbox": false
}
```

## Documentation

- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
