# Amazon (SP-API) setup guide

How to connect an Amazon seller account to OpenLinker with a **private (self-authorized) SP-API app**.
This is the only path the plugin foundation supports; the public-app OAuth flow comes later.

> The steps below follow Amazon's documentation as read in the #2881 spike. Amazon changes its portals
> often; if a label differs, trust Amazon's screen and update this guide.

## What you need

- A **Professional** Amazon seller account in the EU region (DE, FR or PL).
- Access to **Solution Provider Portal** (developer profile approved for private use).

## 1. Register a private SP-API app

1. In Solution Provider Portal, open your developer profile and create an app client with
   **API Type: SP API**.
2. Request the roles the capabilities will need. For orders fulfilled by you (FBM) that includes
   **Direct-to-Consumer Shipping**, a restricted role Amazon reviews separately (business check and a
   review of how personal data is handled). Without it orders arrive without the buyer's address.
3. Open the app's **LWA credentials** and copy the **client identifier** and **client secret**.

## 2. Authorize the app for your seller account

1. In the app list, choose **Authorize** for the app. Amazon issues a **refresh token** (`Atzr|...`).
2. Copy it now. Amazon allows ten self-authorizations per app.

## 3. Create the connection in OpenLinker

There is no guided form for Amazon yet. Create the connection through the API:

```http
POST /v1/connections
{
  "name": "Amazon DE",
  "platformType": "amazon",
  "adapterKey": "amazon.spapi.v1",
  "config": { "region": "eu", "environment": "production", "marketplaceIds": ["A1PA6795UKMFR9"] },
  "credentials": { "clientId": "...", "clientSecret": "...", "refreshToken": "Atzr|..." }
}
```

Marketplace ids: DE `A1PA6795UKMFR9`, FR `A13V1IB3VIYZZH`, PL `A1C3SOZRARQ6R3`.

## 4. Test the connection

Run **Test connection** on the connection page. It passes when the credentials work and your account
sells in every marketplace you listed. If it names a marketplace, remove it or enable selling there.

## Sandbox

Set `"environment": "sandbox"` to point at Amazon's static sandbox. It answers canned data only, so the
test does not check marketplaces there, and nothing it returns describes your real account.

## Re-authorizing

If Amazon revokes the refresh token, the connection moves to **Needs reauth**. Authorize the app again
(step 2) and replace the credentials on the connection.
