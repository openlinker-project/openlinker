# @openlinker/integrations-erli

Erli marketplace adapter for OpenLinker — offer management and order ingestion.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `erli.shopapi.v1` |
| **Platform type** | `erli` |
| **Package** | `@openlinker/integrations-erli` |

## Capabilities

| Capability | Key sub-capabilities |
|---|---|
| `OfferManager` | `OfferCreator`, `OfferLister`, `OfferFieldUpdater`, `OfferQuantityBatchUpdater` |
| `OrderSource` | `listOrderFeed` (cursor-based), `getOrder` |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

## Credentials & config

Authentication uses a **static API key** (no OAuth).

**Credentials**:
```json
{
  "apiKey": "<Erli seller API key>"
}
```

**Config**:
```json
{
  "sandbox": false
}
```

## Notable implementation details

- **Borrowed Allegro taxonomy**: Erli accepts Allegro category IDs and attribute IDs
  verbatim — no separate `CategoryBrowser` is needed. OpenLinker reuses existing
  PrestaShop → Allegro category/attribute mappings. See [ADR-023](../../../docs/architecture/adrs/023-cross-platform-category-and-attribute-projection.md).
- **Reconciliation-first offer sync**: new offers are created with `source: "shop"`
  to bypass the Allegro catalog requirement. See [ADR-025](../../../docs/architecture/adrs/025-erli-marketplace-adapter.md).
- **Inbound webhooks**: delivery auth is `Authorization: Bearer <accessToken>` echo
  (no HMAC/timestamp); event body `{ id, status }`.

## Documentation

- [`docs/integrations/erli/`](../../../docs/integrations/erli/) — setup guide
- [ADR-025](../../../docs/architecture/adrs/025-erli-marketplace-adapter.md) — design rationale
