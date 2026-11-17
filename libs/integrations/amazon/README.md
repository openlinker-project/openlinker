# @openlinker/integrations-amazon

OpenLinker adapter for the [Amazon Selling Partner API](https://developer-docs.amazon.com/sp-api)
(SP-API). Target markets for the first release: **DE first, then FR and PL** (#3741).

**Status:** foundation (#4177) and `OrderSource` (#4178): the order feed over Orders API v2026-01-01
`searchOrders`, the order read over `getOrder`, the tracking write-back over v0 `confirmShipment`, the
option lists for the mapping UI and the `amazon-orders-poll` task (off by default,
`OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED`). `OrderSource` is opt-in on a connection. The remaining
capabilities arrive with their own children of the epic (#4176).
Evidence base: `docs/plans/analysis/SPIKE-2881-amazon-sp-api.md` and the product spec
`docs/specs/product-spec-2881-amazon-marketplace-integration.md`.

| | |
|---|---|
| Adapter key | `amazon.spapi.v1` |
| Platform type | `amazon` |
| Auth | Login with Amazon (LWA): refresh token -> 1 h access token in `x-amz-access-token` |
| Hosts | `sellingpartnerapi-{eu,na,fe}.amazon.com`, sandbox `sandbox.sellingpartnerapi-{eu,na,fe}.amazon.com` |
| Webhooks | none over HTTP; Amazon notifies only through SQS / EventBridge (a later child) |

## Connection config

```json
{ "region": "eu", "environment": "production", "marketplaceIds": ["A1PA6795UKMFR9"] }
```

- `region` - `eu` (default), `na` or `fe`. FR, DE and PL are all `eu`.
- `environment` - `production` (default) or `sandbox`. The sandbox is Amazon's **static** sandbox: it
  answers canned fixtures, whatever is asked.
- `marketplaceIds` - at least one. Known ids: FR `A13V1IB3VIYZZH`, DE `A1PA6795UKMFR9`,
  PL `A1C3SOZRARQ6R3`. A known id paired with another region is refused at save; an unknown id is
  accepted by format alone.

## Credentials

```json
{ "clientId": "amzn1.application-oa2-client....", "clientSecret": "...", "refreshToken": "Atzr|...", "source": "self-authorized" }
```

Both ways of obtaining a refresh token store these same three values, so the runtime is shared:

- **`self-authorized`** (default, available now) - the operator registers a private SP-API app in
  Solution Provider Portal and authorizes it for their own seller account, then pastes the refresh
  token. See `docs/setup-guide.md`.
- **`oauth`** - a public app; the seller is redirected to Amazon and the authorization code is
  exchanged for the refresh token. Not built yet (needs a registered public app, AC7 in #2878).

## Connection test

Mints an access token and calls `GET /sellers/v1/marketplaceParticipations`.

- On `production` every configured marketplace must be one the seller participates in; a missing one
  fails the test and is named.
- On `sandbox` that check is skipped, because the static sandbox answers one canned US marketplace.
- A refused refresh token or client credentials (`invalid_grant`, `invalid_client`,
  `unauthorized_client`) reports `unauthorized`.
- A `403 Unauthorized` from SP-API is reported as that error and **not** as bad credentials: Amazon
  answers it for a missing role too, and re-authorizing would not help.

## Buyer data retention

Amazon's Data Protection Policy requires buyer personal data to be deleted no later than 30 days after
delivery. The manifest declares `buyerDataRetentionDays: 30`, and the worker's `maintenance` role runs
the order buyer-data retention pass hourly: 30 days after an order's ship-by deadline (or its placement
when it has none, both earlier than delivery) its addresses are reduced to the country, and its email,
buyer note, tax id and any operator address edit are removed, as is the buyer from the search text.
Lines, amounts, statuses and ids stay. A later re-import of the order stores none of it again.

Not covered yet: customer projections, a shipment's recipient, the history of an address edit and the
recipient on an email delivery record keep their copy. Issued sales documents keep theirs by law.

## Errors and retries

| Failure | Retry | Notes |
|---|---|---|
| LWA refuses the credentials | terminal | the connection goes to `needs_reauth` |
| config or stored credentials unusable | terminal | operator edit needed |
| SP-API 4xx (not 408 / 429) | terminal | |
| 429 `QuotaExceeded` | deferred 240 s, no attempt spent | covers `searchOrders`' ~3 min restore |
| 503 | deferred 300 s | |
| network, 408, other 5xx | retried on the ladder | |

`x-amzn-RateLimit-Limit` is never read: Amazon sends it only "when available" and warns not to rely on
it. No `defaultRateLimit` is declared, because SP-API quotas are per operation; the capability adapters
will pace each operation.

## Not yet built

Offers and stock (`OfferManager`, Listings Items), the SQS / EventBridge inbound transport, the public-app OAuth
flow and a web setup form. Epic #4176 lists them.
