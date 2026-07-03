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

Authentication uses the **OAuth 2.0 authorization-code flow** (browser redirect through
Allegro's consent screen). Credentials are stored as an encrypted token set
(access + refresh token) managed by the adapter's token-refresh cycle.

**Config**:
```json
{
  "environment": "production"
}
```

| Field | Values | Notes |
|---|---|---|
| `environment` | `"sandbox"` \| `"production"` | `sandbox` targets `api.allegro.pl.allegrosandbox.pl`; `production` targets `api.allegro.pl` |
| `apiBaseUrl` | URL (optional) | Explicit API base-URL override; defaults from `environment` |
| `masterCatalogConnectionId` | UUID (optional) | Master-catalog connection used for barcode-scoped offer linking |
| `sellerDefaults` | Object (optional) | Offer-creation defaults: ship-from `location`, `responsibleProducerId`, GPSR `safetyInformation` |
| `sellerId` | String (optional) | Allegro seller/account id captured at OAuth completion; used by the same-seller re-auth guard |

## Notable implementation details

- **OAuth token refresh**: shared across all HTTP clients for a connection; adapter
  owns a refresh-on-401 retry cycle. See `allegro-auth-token.service.ts`.
- **Offer auto-grouping**: multi-variant products fan out to one offer per variant;
  Allegro auto-groups via GTIN + distinguishing parameters (no `/sale/offer-variants` API
  — removed April 2026). See the [Listings context — Multi-variant expansion (#824)](../../../docs/architecture-overview.md#6-listings-offers)
  section of the architecture overview; [ADR-024](../../../docs/architecture/adrs/024-destination-listing-capabilities.md)
  covers the related marketplace-`OfferManager`-vs-shop-`ProductPublisher` split.
- **Cursor-based order feed**: uses `GET /order/events` with a persisted `lastEventId`
  cursor for incremental ingestion.

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — initial setup and configuration
- [docs/runbook.md](./docs/runbook.md) — operational troubleshooting
- [docs/manual-testing-guide.md](./docs/manual-testing-guide.md) — manual testing procedures
- [`docs/capabilities.md`](../../../docs/capabilities.md) — full capability catalog
- [`libs/integrations/prestashop/README.md`](../prestashop/README.md) — reference adapter pattern
