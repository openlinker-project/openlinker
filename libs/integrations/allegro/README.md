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

**Where order sync starts (#4228).** `OrderFeedBootstrap.headCursor` seeds at the newest event (`/order/event-stats`), so a new connection imports only new orders by default. There is **no "from a date" start**: the event journal has no date position (`cursorForDate` is not implemented, and the manifest does not declare `from`). `OrderWindowReader.listOrdersInWindow` is implemented (`orderWindowImport: true`), so history can be imported newest-first and a date range can be imported on demand. An empty event journal on an account that has orders reads the journal from its start, which holds nothing older anyway. Window import pages by offset sorted by purchase time with no tiebreaker and Allegro documents no maximum offset, so a very large all-history import may stop at an API ceiling: narrow the range and retry.

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
