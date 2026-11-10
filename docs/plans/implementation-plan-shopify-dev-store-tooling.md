# Implementation plan - Shopify dev-store tooling and documentation (#3983)

## Goal

Shopify is SaaS only, so a developer cannot run it in Docker. Bring the spike's (#3928) dev-store
seed and probes into the repo, document how to create, seed and connect a dev store, write the
operator guide, and record the adapter decisions.

Layer: DX + Docs. No production code changes.

## Delivered

| Piece | Where |
|---|---|
| Seed, client, probes | `docker/shopify/` (`seed.mjs`, `lib/shopify-client.mjs`, `lib/seed-catalogue.mjs`, `probes/`) |
| Tests of the seed data and inputs | `docker/shopify/lib/seed-catalogue.test.mjs` (`node --test`, part of `pnpm check:invariants`) |
| Compose service | `shopify-tools` in `docker-compose.yml`, profile `shopify`, image pinned like `apps/web/Dockerfile` |
| Scripts | `pnpm dev:stack:seed-shopify`, `pnpm dev:stack:shopify-probe <name>` |
| Env keys | commented block in `.env.example` (read only by the tooling container) |
| Dev-store README | `docker/shopify/README.md`: store, app, scopes, credentials, seed, probes, connecting OpenLinker, tunnel for webhooks |
| Operator guide | `libs/integrations/shopify/docs/setup-guide.md` |
| Adapter decisions | `docs/architecture-overview.md`, "Shopify adapter ground rules (#3983)" (no ADR: the issue allows either) |

## Changes from the prototype (`3928-shopify-prototype`)

Each API call was checked against the Admin GraphQL 2026-10 reference.

1. **`orderCancel` no longer sends `refund: false`.** The argument is deprecated on 2026-10; leaving
   out `refundMethod` cancels without refunding. The payload reads `orderCancelUserErrors` (the
   `userErrors` field is deprecated).
2. **The primary location is read from `location`**, not taken as `locations.nodes[0]`: the list
   order is not guaranteed, and OpenLinker uses the primary location when a connection names none.
3. **Data and input building moved to `lib/seed-catalogue.mjs`** (pure), so they are tested without
   a store; `seed.mjs` only reads and writes.
4. **Two more scripts and a broader README**: `dev:stack:shopify-probe`, and how to connect
   OpenLinker to the seeded store (three connection ways, the edit-page options, a tunnel for
   webhooks). The OAuth redirection URL now matches the web route
   (`/integrations/shopify/connect/callback`).
5. **Non-PLN / tax-exclusive stores are a note, not a warning**: the adapter supports both.

Confirmed unchanged on 2026-10: `locationAdd` (`fulfillsOnlineOrders`), `fulfillmentServiceCreate`
(no `callbackUrl` needed), `productSet(synchronous: true)` with variant `sku`, `inventoryItem`
`tracked` / `measurement`, `orderCreate` with `OrderCreateOptionsInput.inventoryBehaviour`
(`BYPASS | DECREMENT_IGNORING_POLICY | DECREMENT_OBEYING_POLICY`), `taxonomy.categories(search:)`.

Known: `ProductVariantSetInput.barcode` is deprecated on 2026-10 in favour of `barcodes`, but still
accepted. The seed keeps `barcode`, as the publisher adapter does; moving both is a follow-up.

## Not done here

- The E2E retest of the spike cases on a seeded dev store: run on the developer's own store and
  recorded in the PR.
