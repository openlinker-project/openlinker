# Erli Shop API upstream stub

Implements GitHub issue #3043 (provisioning for F18 / #3048, epic #2840). A
single-process `node:http` stub serving just enough of the Erli Shop API for
OpenLinker's real, unmodified `ErliOrderSourceAdapter` /
`ErliOfferManagerAdapter` to construct and resolve a connection.

## Why a network alias, not a bare hostname

`isAllowedErliBaseUrl` (`libs/integrations/erli/src/domain/policies/erli-
base-url.policy.ts`) is an SSRF guard: `config.baseUrl` must be `https` AND
resolve to `erli.pl` or `erli.dev` (or a subdomain) - there is no test-mode
escape hatch, by design (the override becomes a server-side authenticated
GET carrying the static API key). The guard is a STRING check on the parsed
hostname, not a real DNS/registrar lookup, so `docker-compose.lab.yml`
declares `erli-stub.erli.dev` as a network alias for this container on the
`lab` compose network - Docker's embedded DNS resolves that name to this
container for every OTHER container on the SAME network, and the name
resolves to NOTHING outside it. No real `erli.dev` traffic is ever touched
or spoofed externally; this is exactly the `/etc/hosts`-override shape test
environments already use, applied via compose instead.

## Why TLS

`ErliHttpClient` requires `https` on the resolved base URL. This process
itself speaks plain HTTP; `docker-compose.lab.yml` fronts it with an nginx
TLS terminator (`stand/lab-tls/`, the `wc-tls` precedent, #2854) whose
certificate carries `subjectAltName=DNS:erli-stub.erli.dev` to match the
alias above.

## What it serves, and why only this

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/me` | Connection-tester probe path. Always `200`. |
| `GET` | `/inbox` | The order-event journal - a top-level array, real wire shape (`{id, shopId, created, read, type, payload}`). |
| `POST` | `/inbox/mark-read` | Accepts `{lastMessageId}`, always `200`. |
| `GET` | `/orders/:id` | Order hydration - a seeded order (via `/__stub/seed-order`) or a minimal synthetic fallback, so an unseeded id never 404s a smoke run. |
| `GET` / `PATCH` | `/products/:id` | Offer read + the ONE write `ErliOfferManagerAdapter.updateOfferQuantity` makes (`stock`). |

Everything else answers `404`.

## Scope, deliberately narrow

This stub gives #3043 a connection that resolves and passes bootstrap's
post-connect verification. It does **not** yet model the two behaviours
#3048 (F18) exists to measure:

- **Seller-frozen stock** (`isStockFrozenCached`) - the real adapter caches
  a frozen flag from a `GET /products/:id` field populated during
  `erli-offer-status-sync` reconciliation. This stub's `GET /products/:id`
  reports no such field yet; #3048 extends it once it confirms the exact
  field name against the real adapter's status-sync read.
- **The borrowed-catalogue peer resolve** (#2210) - an EAN lookup on an
  Erli connection reaches the PEER Allegro connection's OWN adapter and
  credentials, landing on `stubs/allegro`, never on this stub. #3048 is
  where `stubs/allegro` gains whatever catalogue-lookup endpoint that path
  calls, and where this stub's limiter-utilization reporting (if any) is
  added.

## Control surface

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/__stub/health` | `{ok: true}` - compose healthcheck target. |
| `GET` | `/__stub/config` | `{gitSha, latencyMs, requestsTotal, quantityWritesTotal, ordersServedTotal, inboxDepth}`. |
| `PUT` | `/__stub/config` | Sets `latencyMs`. |
| `POST` | `/__stub/reset` | Clears the inbox, seeded orders, and counters. |
| `POST` | `/__stub/seed-order` | Test/driver seam (not a real Erli endpoint) - registers an order and appends an `orderCreated` inbox event for it. |

## Design decisions

Same as `stubs/allegro/README.md`'s: standalone `node:http`, zero
dependencies, `server.mjs` exports `{server, describeConfig, _resetForTest}`
for `test.mjs` to drive in-process.
