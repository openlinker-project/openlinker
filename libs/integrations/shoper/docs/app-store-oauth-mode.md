# Shoper App Store (OAuth app mode) - what is known

Checked 2026-10-25 from public sources only. The official App Store pages at
developers.shoper.pl sit behind a login, so this note does not quote them.

## What the public libraries show
- An App Store application is installed per shop. The shop sends an install
  notification carrying an `auth_code`. The app exchanges it, together with its
  `client_id` and `client_secret`, for `access_token` + `refresh_token` +
  `expires_in` (DreamCommerce ShopAppstoreLib, `Client::ADAPTER_OAUTH`,
  `authenticate()` / `refreshTokens()`; Shoper PHP SDK `authenticateOAuth` /
  `refreshToken`).
- The app receives lifecycle notifications named `install`, `uninstall`,
  `billing_install` and `billing_subscription`, at an endpoint the app
  registers. They are signed with the App Store secret (the libraries take
  `appStoreSecret` as a handler parameter).
- The REST API used afterwards is the same `/webapi/rest/*` API an external
  integration uses. Only the token source differs.

## What this means for OpenLinker
- OpenLinker's Shoper plugin is an external integration: the operator creates a
  token in "Dodaj integrację" and pastes it in. App mode would need:
  1. a partner account and a registered application (client id + secret owned
     by the OpenLinker operator, not by each shop),
  2. a public install-notification endpoint (new inbound route, signed by the
     App Store secret),
  3. token refresh storage per connection (the `credentials` row would hold a
     refresh token that rotates).
  This is a new auth model for the plugin, not a capability. It is a product
  decision, not a coding task.
- Verified live on sklep729770 (22-23.10): with an external-integration token,
  `order-refunds` and `order-transactions` answer 403. Whether an App Store app
  token is granted them is NOT confirmed by any public source. The only way to
  confirm is a partner account and a test app.
- Loop protection (a token's own writes fire no webhook) was confirmed for
  integration and admin tokens. For an app token it is unconfirmed.

## Sources
- https://packagist.org/packages/shoper/sdk
- https://shopappstorephplib.readthedocs.io/en/latest/library/tasks.html
- https://shopappstorephplib.readthedocs.io/en/latest/classes/client/oauth.html
