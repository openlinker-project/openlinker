# @openlinker/integrations-allegro

Allegro Public API v1 adapter for OpenLinker — marketplace offer management and order ingestion.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `allegro.publicapi.v1` |
| **Platform type** | `allegro` |
| **Package** | `@openlinker/integrations-allegro` |

## Capabilities

| Capability | Key sub-capabilities |
|---|---|
| `OrderSource` | `listOrderFeed` (cursor-based event journal), `getOrder` |
| `OfferManager` | `OfferLister`, `OfferEventReader`, `OfferCreator`, `OfferFieldUpdater`, `OfferStatusReader`, `OfferSmartClassificationReader`, `CategoryBrowser`, `CategoryBarcodeMatcher`, `CatalogProductReader`, `SellerPoliciesReader` |
| `ShippingProviderManager` | Allegro carrier mapping |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

## Credentials & config

Authentication uses **OAuth 2.0 device flow**. Credentials are stored as an encrypted
token set (access + refresh token) managed by the adapter's token-refresh cycle.

**Config**:
```json
{
  "sandbox": false
}
```

`sandbox: true` targets `api.allegro.pl.allegrosandbox.pl` for testing.

## Notable implementation details

- **OAuth token refresh**: shared across all HTTP clients for a connection; adapter
  owns a refresh-on-401 retry cycle. See `allegro-auth-token.service.ts`.
- **Offer auto-grouping**: multi-variant products fan out to one offer per variant;
  Allegro auto-groups via GTIN + distinguishing parameters (no `/sale/offer-variants` API
  — removed April 2026). See [ADR-024](../../../docs/architecture/adrs/) and `#824`.
- **Cursor-based order feed**: uses `GET /order/events` with a persisted `lastEventId`
  cursor for incremental ingestion.

## Documentation

- [`docs/integrations/allegro/`](../../../docs/integrations/allegro/) — setup guide
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
- [`libs/integrations/prestashop/README.md`](../prestashop/README.md) — reference adapter pattern
