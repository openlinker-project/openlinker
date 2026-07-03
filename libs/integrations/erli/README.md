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

**Config** (all fields optional - an empty config is valid):
```json
{}
```

| Field | Values | Notes |
|---|---|---|
| `baseUrl` | HTTPS URL (optional) | Override of the Erli Shop API base URL; must target an Erli-owned host |
| `defaultDispatchTime` | Object (optional) | `{ "period": <non-negative int>, "unit": "hour" \| "day" \| "month" }` - dispatch time applied to created offers when no per-offer value is given |
| `callbackBaseUrl` | http(s) URL (optional) | Public base URL Erli calls back for inbound webhooks (e.g. a tunnel in dev) |

## Notable implementation details

- **Borrowed Allegro taxonomy**: Erli accepts Allegro category IDs and attribute IDs
  verbatim — no separate `CategoryBrowser` is needed. OpenLinker reuses existing
  PrestaShop → Allegro category/attribute mappings. See [ADR-023](../../../docs/architecture/adrs/023-cross-platform-category-and-attribute-projection.md).
- **Category resolution**: offers prefer the product's already-resolved Allegro category
  id, tagged `source: "allegro"`; when none is resolved, the adapter falls back to the
  master shop's own categories tagged `source: "shop"`, and when neither is present the
  offer lists uncategorised (Erli makes the category optional). See
  [ADR-025](../../../docs/architecture/adrs/025-erli-marketplace-adapter.md).
- **Inbound webhooks**: delivery auth is `Authorization: Bearer <accessToken>` echo
  (no HMAC, no signed timestamp). The delivery body is the full order resource with no
  event-type discriminator; the decoder reads only the order `id` (plus `status` and the
  `updated` timestamp for event-id dedup) and treats every delivery as a "re-fetch this
  order" nudge - the authoritative order is always pulled via the Shop API.

## Documentation

- [docs/setup-guide.md](./docs/setup-guide.md) — setup guide
- [docs/runbook.md](./docs/runbook.md) — operational runbook
- [ADR-025](../../../docs/architecture/adrs/025-erli-marketplace-adapter.md) — design rationale
