# @openlinker/integrations-shoper

OpenLinker adapter for [Shoper](https://www.shoper.pl) (Polish SaaS e-commerce platform), REST API.

**Status: connection skeleton only (#3639).** The plugin registers, tests a connection and validates its
config and credentials. It declares **no capabilities yet** (`supportedCapabilities: []`); ProductMaster,
InventoryMaster, OrderProcessorManager, fulfilment writeback and webhooks land in their own epics of the
"Shoper Integration" milestone (#3640-#3644). Evidence base: `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md`.

| | |
|---|---|
| Adapter key | `shoper.restapi.v1` |
| Platform type | `shoper` |
| Auth | static Bearer token, issued per shop (no OAuth exchange) |
| Sales documents (invoice / receipt) | **out of scope by design** - Shoper's API has none |

## Connection config

```json
{ "baseUrl": "xxxxx.shoparena.pl" }
```

`baseUrl` is the shop's own host. An `https://` URL naming only that host is accepted and normalised.
Rejected: `http://`, a path / query / port / credentials, IP addresses, `localhost`, single-label
hosts and reserved / private suffixes (`.internal`, `.local`, `.lan`, ...). The token travels on every request, so HTTPS is the only transport.

To create the connection through the API, send `platformType: "shoper"` and
`adapterKey: "shoper.restapi.v1"` (the web UI does not list Shoper yet).

## Credentials

```json
{ "token": "<Token API>" }
```

Create it in the shop admin panel: **Dodaj integrację** -> the panel issues a *Client ID* and a *Token API*.
Only the token is stored; it is used directly as `Authorization: Bearer <token>`.

### Permissions to grant

Shoper enforces access per area server-side (`403 insufficient_scope`). In the integration's
**Obszar sklepu x Zakres dostępu** table grant these areas (the capabilities that use each one arrive with
the rest of the milestone, so grant them up front to avoid re-visiting the panel). The connection test
itself needs none of them and its 403 message names none:

produkty, warianty produktów, stany dostępności, kategorie, stawki vat, magazyny, zamówienia, przesyłki,
statusy zamówień, klienci, webhooki, dostawy, płatności

(`SHOPER_REQUIRED_SCOPES` in `src/shoper.constants.ts` is the same list.)

## Connection test

`GET https://<baseUrl>/webapi/rest/application-config` with the Bearer token.

| Result | Meaning |
|---|---|
| `200` | host is a Shoper shop and the token is valid (the body must look like `application-config`; a bare 200, an empty or non-JSON page fails) |
| `401` | token invalid or revoked |
| `403` | the request was refused; this probe needs no area, so check the integration is active and unrestricted |
| `404` | host is not a Shoper shop |

A passing test does **not** prove every area above was granted; each capability reports its own missing area.

## Known gaps

- **No rate limiting or retries yet.** The real request ceiling is unconfirmed (SPIKE-3638 C6); no
  `defaultRateLimit` is declared. Set `config.rateLimit` on the connection if a shop needs a cap.
- The webhook signing algorithm (`x-webhook-sha1`) is unresolved; see #3644.
