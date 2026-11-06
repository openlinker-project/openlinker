# @openlinker/integrations-shopify

OpenLinker adapter for [Shopify](https://shopify.dev/docs/api/admin-graphql), Admin GraphQL API **2026-10**.

**Status:** plugin foundation (#3974). The plugin registers the connection, the token handling, the GraphQL
client, the connection tester and the retry / auth-failure classifiers. It advertises **no capability yet**:
each capability (ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager, ProductPublisher, ...)
enters `supportedCapabilities` together with the adapter that delivers it, in the follow-up issues of the
"Shopify integration" milestone. Evidence base: spike #3928 (`SPIKE-3928-shopify-capabilities.md`) and the first
spike #2879 (`docs/plans/analysis/SPIKE-2879-shopify-admin-api.md`).

| | |
|---|---|
| Adapter key | `shopify.admin.v1` |
| Platform type | `shopify` |
| API | Admin GraphQL, `https://{shop}/admin/api/{version}/graphql.json` |
| Supported API versions | `2026-10` (`SHOPIFY_SUPPORTED_API_VERSIONS`) |

## Connecting a store

Three ways, all stored in the connection's encrypted credentials:

| Mode | Credentials | When |
|---|---|---|
| App credentials | `clientId` + `clientSecret` | A store in the **same organization** as the app (client-credentials grant, ~24 h token minted and cached). |
| Access token | `accessToken` | A token already issued for the store. Used as is, never renewed. |
| OAuth install | written by the install | A store in **another organization**. The operator approves the app on Shopify; OpenLinker stores an expiring offline token and its refresh token (Shopify requires `expiring=1` for new apps) and refreshes them, writing the rotated pair back under a lock. |

Config (`Connection.config`): `storeDomain` (required, `*.myshopify.com`), `apiVersion` (optional, a supported
version), `locationId` (optional, the ONE location stock is read and written at; the primary location when absent;
must exist and be active, checked by the connection test), `unmanagedStockQuantity` (optional, whole number).

The OAuth install is started from the web setup page (`/connections/new/shopify`) and lands on
`/integrations/shopify/connect/callback`; register that URL as an allowed redirection URL on the app. The API checks
Shopify's `hmac` and the `shop` of the redirect before it exchanges the code.

## Behaviour worth knowing

- **Connection test** reports shop name, currency, whether prices include tax, and the location. A refused token
  request names its cause: app not installed (K02), store in another organization so OAuth is needed (K03), wrong
  client id / secret (G03). Missing scopes are listed.
- **Pacing.** Every call goes through the connection-bound transport, with ONE bucket per store
  (`shopify:store:{domain}`), because Shopify's budget is per app and store. Query cost is paced from the
  `throttleStatus` Shopify returns (never a hard-coded budget, L-C2).
- **Retry.** `THROTTLED`, the `orderCreate` "Too many attempts" cap (L-X1), 429 and 503 are deferred without
  spending an attempt; `CHANGE_FROM_QUANTITY_STALE` (G05) and network errors (G07) retry normally; a missing scope
  and other user errors are terminal.
- **Re-auth.** A 401 that survives one renewal, the invalid-token GraphQL error, and a grant refused for bad or
  spent credentials set the connection to `needs_reauth`. `app_not_installed` / `shop_not_permitted` do not: the
  credentials are fine.
- **Archive** removes the cached minted token and shop context (K05) through the core connection archive hook.

## Known gaps

- No capability adapters yet (follow-up issues).
- Whether a configured location exists is checked by the connection test and at runtime, not when the connection
  is saved (a save has no credentials to ask the shop with).
- Cost pacing is per process: two worker processes share the request-count bucket but each paces cost from its own
  last observation; Shopify's `THROTTLED` answer and the retry classifier cover the rest.
