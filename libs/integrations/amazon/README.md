# @openlinker/integrations-amazon

OpenLinker adapter for the [Amazon Selling Partner API](https://developer-docs.amazon.com/sp-api)
(SP-API). Target markets for the first release: **DE first, then FR and PL** (#3741).

**Status:** foundation (#4177) and `OrderSource` (#4178): the order feed over Orders API v2026-01-01
`searchOrders`, the order read over `getOrder`, the tracking write-back over v0 `confirmShipment`, the
option lists for the mapping UI and the `amazon-orders-poll` task (off by default,
`OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED`). `OrderSource` is opt-in on a connection. The remaining
capabilities arrive with their own children of the epic (#4176). `OfferManager` (#4180) links the seller's
listings by SKU and writes stock and price to them; see "Offers" below.
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

- `region` - `eu` (default), `na` or `fe`. FR, DE and PL are all `eu`. Fixed once the connection
  exists: another region is another seller account, with its own refresh token and merchant token,
  so a change is refused on save and another region needs a new connection.
- `environment` - `production` (default) or `sandbox`. The sandbox is Amazon's **static** sandbox: it
  answers canned fixtures, whatever is asked.
- `marketplaceIds` - at least one. Known ids: FR `A13V1IB3VIYZZH`, DE `A1PA6795UKMFR9`,
  PL `A1C3SOZRARQ6R3`. A known id paired with another region is refused at save; an unknown id is
  accepted by format alone. In `fe` (Japan, Australia, Singapore) each country is a separate seller
  account, so a connection there names exactly one marketplace. A marketplace added later has its
  whole order history read: the order feed shares one watermark across marketplaces, so it moves
  back to the start and re-reads every marketplace's orders (already imported ones are updated, not
  duplicated), which takes long at the order search quota. Orders past the 30-day buyer-data window
  are read without the buyer's personal data.

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

## Offers

An Amazon offer is addressed by the seller's SKU, so the offer id in OpenLinker is the SKU. Needs the
merchant token in the config (`"sellerId": "A2..."`, Seller Central > Settings > Account Info > Your
Merchant Token): no SP-API call returns it to a self-authorized app. Both listing tasks run only for
connections with `OfferManager` enabled and a valid `sellerId`, so a connection without one is not
scheduled at all.

- **Linking**: `amazon-offers-sync` (hourly, off by default, `OL_AMAZON_OFFERS_SYNC_SCHEDULER_ENABLED`)
  lists the listings and the offer mapping sync links them to variants by SKU. Linking by EAN is not
  done: listings carry no EAN, only the ASIN.
- **Stock**: `patchListingsItem` replacing `fulfillment_availability` on the seller channel (`DEFAULT`).
  A listing Amazon fulfils (FBA) is skipped with a warning, never written (its stock is Amazon's); the
  listing sync marks it `fulfilledByAmazon`. Quantity 0 pauses a listing; listings are never deleted.
- **Price**: `patchListingsItem` replacing `purchasable_offer`, gross, for each configured marketplace
  whose currency is the price's (FR / DE: EUR, PL: PLN). Title, description and tax rate are refused.
  Replacing the attribute also clears what else it held for that marketplace: a sale price, or min / max
  price bounds set in Seller Central.
- **Status**: `amazon-offer-status-sync` (hourly, off by default,
  `OL_AMAZON_OFFER_STATUS_SYNC_SCHEDULER_ENABLED`) reads `BUYABLE` as active, Amazon's ERROR issues as
  validation errors, and the live price and seller quantity. A listing Amazon no longer has (404) is
  `ended`, so it can be listed again.
- Listing, the FBA check and the status read use the first configured marketplace; a listing that
  exists only in another marketplace is not linked.
- Every write reads the listing first (a patch must name its product type); a patch Amazon answers
  `INVALID` is rejected with its issue. `putListingsItem` is never used for an update.
- Not verified on a live account: the `replace` operation on both attributes follows Amazon's use-case
  guide; #3741 mentions `merge`, which the model also allows.

## Notifications (SQS)

Amazon delivers change notifications only to Amazon SQS or EventBridge, never over HTTP. With a queue
configured, the `amazon-notifications-drain` task (every minute, off by default,
`OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED`) reads it and turns each `ORDER_CHANGE` into an
ordinary order sync, so an order arrives within about a minute. Only connections with
`OrderSource` enabled and a `notificationQueueUrl` are drained; a queue without its AWS key ends the
job as a business failure naming the cause.

A notification is a trigger, not the delivery guarantee: the drained event is enqueued on the
`jobs.sync` Redis stream (not the `sync_jobs` gate a webhook uses), and the SQS message is deleted once
that enqueue returns. The orders poll is what guarantees every order arrives, so keep
`amazon-orders-poll` on when the drain is on.

- Config: `"notificationQueueUrl": "https://sqs.<region>.amazonaws.com/<account>/<queue>"`.
- Credentials: `awsAccessKeyId` and `awsSecretAccessKey` of an IAM user allowed `sqs:ReceiveMessage`
  and `sqs:DeleteMessage` on that queue. Requests are signed with SigV4; no AWS SDK.
- The queue's access policy must also let Amazon's SP-API notification principal send to it (Amazon's
  setup guide for the Notifications API).
- A message is deleted only after its events were routed; a duplicate dedups on Amazon's
  `NotificationId`. Other notification types are acknowledged and ignored for now.

Registering the queue with Amazon is the "Configure webhooks" action (`POST
/connections/:id/webhooks/install`): it reuses or creates the Notifications API destination for the
queue's ARN (grantless token, scope `sellingpartnerapi::notifications`) and subscribes it to
`ORDER_CHANGE` (order status and buyer-requested changes). Running it again changes nothing; a
subscription that already points at another destination is reported, not replaced. A Sandbox-status
app is refused the grantless scope (#2881), so this step needs a production app; that refusal, an app
without the Notifications role and an unusable connection config come back as a warning on the action,
not as an error.

## Buyer data retention

Amazon's Data Protection Policy requires buyer personal data to be deleted no later than 30 days after
delivery. The manifest declares `buyerDataRetentionDays: 30`, and the worker's `maintenance` role runs
the order buyer-data retention pass hourly: 30 days after an order's ship-by deadline (or its placement
when it has none, both earlier than delivery) its addresses are reduced to the country, and its email,
buyer note, tax id and any operator address edit are removed, as is the buyer from the search text.
Lines, amounts, statuses and ids stay. A later re-import of the order stores none of it again.

The same pass clears the recipient on the order's buyer-email and document-email delivery records, and
the email, names and street addresses of the customer projections last seen through Amazon before the
cutoff. Not covered yet: a shipment's recipient and the history of an address edit keep their copy.
Issued sales documents keep theirs by law, and a carrier label already generated keeps the recipient
printed on it.

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

Creating new listings (#4181), EventBridge delivery, the public-app OAuth
flow and a web setup form. Epic #4176 lists them.
