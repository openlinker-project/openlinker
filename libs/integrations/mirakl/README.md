# @openlinker/integrations-mirakl

Mirakl Seller API plugin for OpenLinker. Every Mirakl marketplace runs the same
Seller API, so this package holds the shared client and adapters, and each
marketplace is an **operator profile** (`src/operators/`) that becomes its own
connection type in OpenLinker. See ADR-086.

| Operator | Profile | Adapter key | Platform type |
|---|---|---|---|
| Empik Marketplace | `empik.profile.ts` | `empik.mirakl.v1` | `empik` |

## What ships today (#4274)

- Connection: config and credentials validation, a connection test (A01
  `GET /api/account`), retry and auth-failure classifiers.
- `MiraklHttpClient`: `Authorization: <key>` (no `Bearer`), optional `shop_id`,
  both Mirakl error shapes, 429 with `Retry-After`, multipart CSV uploads, an
  8 MiB response cap.
- Offset and seek pagination helpers.
- `MiraklImportTracker`: status and error reports for offer, stock, price and
  product imports.

No capability is advertised yet. Orders arrive with #4275 and offers with
#4277 (epic #4273).

## Connecting

1. In the operator's seller panel, open the user menu and generate an API key
   (Empik: "Klucz API"). One key per shop.
2. Create the connection in OpenLinker with the key and the environment
   (`production` or `staging`). Set `shopId` only when one key reaches several
   shops.
3. Set up at least one shipping zone in the seller panel (Settings, Shipping
   configuration, Shipping charges). Without one every offer stays inactive
   with `NO_MIN_SHIPPING_RATE`, and Mirakl offers no API to set it.

Empik's test platform is `https://stg1.marketplace.empik.com`; a staging key
answers 401 on production.

## Mirakl rules the adapters rely on

- Webhooks are operator-only, so everything polls.
- Every write is an async import. `COMPLETE` means the file was read, not that
  every line applied: read the error lines.
- OF24 replaces the whole offer, so stock and prices go through STO01 and PRI01.
