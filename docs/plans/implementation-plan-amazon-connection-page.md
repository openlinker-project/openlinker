# Implementation Plan: Amazon connection page and setup form (#4186)

Part of epic #4176. Branch `4186-amazon-connection-page`, stacked on `4181-amazon-offer-creator`.

## 1. Task

An operator creates, tests and edits an Amazon connection from the UI, without the API.

**Layer**: Frontend (`apps/web`). No backend change: every field below is one the backend already
validates (`parseAmazonConfig`, `parseAmazonCredentials`, #4177 / #4179 / #4180).

**Non-goals** (each lands with the issue that builds the backend half, as #4186 states):
the master role and its content-ownership warning (#4182), the FBA location toggle (#4183), the
refunds opt-in (#4184), tax-code mapping, and the public-app OAuth connect flow.

## 2. Research

- Closest pattern: Shopify (#3974 setup form, #3982 connection page section) on the Shopify branches:
  `features/shopify/components/shopify-setup{.schema.ts,-form.tsx}`, `pages/connections/shopify-setup-page.tsx`,
  `plugins/shopify/{index.ts, messages.ts, shopify-setup.route.tsx, shopify-connection-config.ts,
  components/shopify-structured-section.tsx, components/shopify-connection-actions.tsx}`,
  `locales/{en,pl}/shopify.json`.
- Credential rotation: `plugins/dpd/components/dpd-credentials-panel.tsx` with
  `useUpdateConnectionCredentialsMutation`.
- Backend config keys: `region` (eu/na/fe), `environment` (production/sandbox), `marketplaceIds`
  (refused when served by another region), `sellerId`, `notificationQueueUrl`.
  Credentials: `clientId`, `clientSecret`, `refreshToken`, optional `awsAccessKeyId` /
  `awsSecretAccessKey`, `source`.
- The manifest enables nothing by default (`defaultEnabledCapabilities: []`), so the form sends
  `enabledCapabilities` itself.
- "Configure webhooks" (`POST /connections/:id/webhooks/install`) runs the Amazon notification
  provisioner (#4179).

## 3. Design

### Setup form (`features/amazon/components/amazon-setup{.schema.ts,-form.tsx}`)

- Name, region, environment (sandbox notice: canned answers only, no real orders).
- Marketplaces: checkboxes of the known marketplaces of the chosen region (DE, FR, PL for EU);
  changing the region drops marketplaces from another region, and the schema refuses one anyway.
- Role up front: **Sales channel** (orders + offers, both pre-checked, each can be unticked).
  **Catalogue master** is shown disabled with "coming soon" until #4182.
- Merchant token (`sellerId`), required when offers are enabled (the listings API needs it).
- LWA client id, client secret, refresh token.
- Optional notifications block: SQS queue URL + AWS access key id / secret.
- After create: Test connection, then go to the connection page (the Shopify flow).

### Connection page (`plugins/amazon/`)

- `StructuredConfigSection` + `connectionConfig`: marketplaces (shown with country and region),
  merchant token (only when `OfferManager` is enabled), queue URL (only when `OrderSource` is).
  Validation no stricter than the backend; clearing writes `null`.
- `CredentialsPanel`: credential source, "re-authorize" (new refresh token, optionally new client
  secret) and AWS keys, through `PUT /connections/:id/credentials`; write controls hidden for a
  read-only session.
- `ConnectionActions`: "Register notification queue", enabled only with `OrderSource` and a saved
  queue URL; read-only sessions see it locked.
- Every section keyed on `enabledCapabilities`, never `platformType`.

### Wiring

- `plugins/amazon/index.ts` in the plugin registry; setup card, route `/connections/new/amazon`.
- `amazon` in `features/mappings/lib/supported-source-platforms.ts`.
- Copy in a new `amazon` namespace, `locales/{en,pl}/amazon.json`, budgets in `locales/limits.json`.

## 4. Steps and commits

| # | Commit | Files |
|---|---|---|
| 1 | Setup form + route + plugin registration + copy | `features/amazon/**`, `pages/connections/amazon-setup-page.tsx`, `plugins/amazon/{index,messages,amazon-setup.route}.ts*`, `plugins/index.ts`, `locales/**` |
| 2 | Connection page: config section, credentials panel, queue action | `plugins/amazon/components/**`, `plugins/amazon/amazon-connection-config.ts`, `supported-source-platforms.ts`, `locales/**` |

## 5. Validation and risks

- No backend or core change; boundary checks unaffected.
- Marketplace list is a frontend copy of the backend's known marketplaces (three entries); an id the
  frontend does not know cannot be picked, the backend list stays the authority on save.
- Tests: schema (region refusal, required fields per role), form (create + test flow), sections
  (capability gating, read-only), connection-config round trip.

## Changes after review (#4219)

- Marketplaces are picked from a searchable list of every Amazon marketplace of the region, not
  checkboxes of three.
- The region stays fixed after create, and the API refuses a change: another region is another
  seller account (its own refresh token and merchant token), so it is a new connection.
- In the Far East region each country is a separate account, so a connection there takes one
  marketplace (API, setup form, connection page).
- A marketplace added on the connection page rewinds the order feed watermark to the bootstrap
  point for it (`scopeAmazonOrderFeedCursor`), so its last 7 days of orders are read.
- The browser copy of the marketplace list is held identical to the backend by
  `scripts/check-amazon-marketplaces-mirror.mjs`.
