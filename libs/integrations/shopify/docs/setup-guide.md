# Shopify Integration Setup Guide

How an operator connects a Shopify store to OpenLinker and chooses what the
connection does. For a local test store and its seed data see
[`docker/shopify/README.md`](../../../../docker/shopify/README.md); for the adapter's behaviour see the
[package README](../README.md).

## Prerequisites

- A Shopify store and its permanent domain (`your-store.myshopify.com`, never a custom domain).
- A Shopify app with Admin API access, created in the Shopify Dev Dashboard, released and installed
  on the store (step 2 of the dev-store README walks through it). OpenLinker uses Admin GraphQL
  API **2026-10**.
- App scopes: everything in `SHOPIFY_REQUIRED_SCOPES` (products, inventory, locations, orders,
  returns, merchant-managed fulfillment orders). Optional: `write_draft_orders` (product tax rates;
  without it a store whose prices exclude tax reports no prices) and `read_shipping` (delivery
  method names in the mapping screens).

## 1. Choose how to connect

**Connections -> Add connection -> Shopify** offers three ways:

| Way | Enter | Use when |
|---|---|---|
| App credentials | client ID + client secret | The store is in the **same organization** as the app (your own dev store, or a store your company owns). OpenLinker exchanges them for a token that lasts about 24 hours and renews it itself. |
| Access token | `shpat_...` token | A token was already issued for the store. It is used as is and never renewed. |
| Install with OAuth | client ID + client secret, then approve on Shopify | The store is in **another organization** (a merchant's own store). Add `<OpenLinker web URL>/integrations/shopify/connect/callback` to the app's allowed redirection URLs first. |

App credentials on a store in another organization fail with "store in another organization"; use
OAuth there. Webhooks need the client secret (Shopify signs deliveries with it), so a connection
made with an access token alone cannot receive webhooks.

Press **Test connection**. It reports the shop name, currency, whether prices include tax, the
stock location, and every missing scope with what it switches off.

## 2. Choose what the connection does

A Shopify store can play four roles. Enable the capabilities on the connection page:

| Role | Capabilities | Notes |
|---|---|---|
| The store is your catalogue and stock | Product master, Inventory master | On by default for a new connection. |
| Orders from the store come into OpenLinker | Order source | Opt-in. Returns come with it. |
| Marketplace orders go to the store | Order processor manager | Opt-in. The store lowers its own stock for each order. |
| You publish products from another master to the store | Product publisher, Offer manager | Opt-in. Use a **separate publish-only connection** with Product master and Inventory master turned **off**: the publisher refuses a connection that is also the master, because the catalogue sync would read every published product back as a new master product. |

## 3. Connection options

On the connection edit page, in the Shopify section:

- **Stock location** - the ONE location OpenLinker reads and writes stock at, picked from the
  store's active locations. Leave it on the primary location unless your stock lives elsewhere.
  Stock at other locations is not counted: OpenLinker treats Shopify as a single warehouse until
  multi-location support arrives.
- **Quantity for untracked stock** - reported for a variant whose stock Shopify does not track
  ("always available"). Empty means 1000.
- **Sales country** - the country whose VAT rate is read for products. Empty means the store's
  billing country.
- **Send refunds to Shopify** - off by default. When on, confirming a refund in OpenLinker makes
  Shopify return the money to the buyer (Shopify Payments). When off, a confirmed refund is only
  recorded as made outside OpenLinker.
- **OpenLinker callback URL** - the public https address of the OpenLinker API, for webhooks.

## 4. Webhooks

Webhooks make order and product changes reach OpenLinker within seconds; without them the orders
poll picks changes up on its own schedule.

1. Set **OpenLinker callback URL** to the API's public https address and save.
2. Enable Order source or Product master (webhooks carry only those events).
3. Press **Configure webhooks**. OpenLinker subscribes the store to the order and product topics
   the enabled capabilities need, removes ones no capability needs any more, and stores the app's
   client secret to verify deliveries. Re-running it is safe, and is needed after enabling
   another capability or changing the URL.

Shopify retries a failed delivery for about four hours and removes a subscription that keeps
failing, so keep the URL reachable. The orders poll stays on as the backstop.

## 5. Prices and taxes

Catalogue prices in OpenLinker are gross (ADR-077). A store whose prices include tax is read and
written as is. For a store whose prices exclude tax, OpenLinker reads each product's VAT rate for
the sales country (it needs `write_draft_orders`) and converts: net to gross on the way in, gross
to net when publishing. A product whose rate cannot be read reports no price and is not published.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Test: "app not installed" | Install the app on the store from the app's page in the Dev Dashboard. |
| Test: "store in another organization" | Connect with OAuth instead of app credentials. |
| Test: missing scopes | Add them to a new app version, release it, accept the update on the store. |
| Stock location shows "not found in the store" | The saved location was deleted or deactivated. Pick another one. |
| Configure webhooks is disabled | Save a callback URL and enable Order source or Product master. |
| Connection needs re-authentication | The token or the OAuth grant was revoked. Reconnect with the same way you used before. |
| Prices are missing for a tax-exclusive store | Grant `write_draft_orders`, or check the product is taxable in the sales country. |
