# Public-Domain Demo Deployment Guide

This guide extends the [one-command demo setup guide](./one-command-demo-setup-guide.md)
for the specific case of standing the demo up **reachable under a real domain**
instead of `localhost` — e.g. for a shared evaluation server or a demo you want
to hand a link to. It covers DNS, the optional reverse-proxy/TLS overlay,
the full set of environment-variable overrides, and a post-deploy
verification checklist.

> **Still a demo, not a hardened production topology.** This guide makes the
> demo stack safe(r) to expose on a real domain — TLS, non-default
> credentials, a verification checklist. It does not add load balancing, a
> WAF, secrets vaulting, or a production-grade order-lifecycle SLA. See the
> [demo setup guide](./one-command-demo-setup-guide.md)'s "Local evaluation
> only" framing — this guide extends that scope, it doesn't replace it.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [DNS records](#2-dns-records)
3. [Environment variables](#3-environment-variables)
4. [Credential rotation](#4-credential-rotation)
5. [Boot the stack with the proxy overlay](#5-boot-the-stack-with-the-proxy-overlay)
6. [Local verification (no real DNS needed)](#6-local-verification-no-real-dns-needed)
7. [Post-deploy verification checklist](#7-post-deploy-verification-checklist)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

Everything from the [demo setup guide's prerequisites](./one-command-demo-setup-guide.md#1-prerequisites),
plus:

- A **domain you control**, with the ability to add DNS records.
- **Ports 80 and 443 reachable from the internet** on the host — Caddy uses
  port 80 for the ACME HTTP-01 challenge (issuing/renewing certificates) and
  serves HTTPS on 443. If the host is behind a cloud firewall / security
  group, open both.
- Docker Compose ≥ 2.24 (same requirement as the base demo).

## 2. DNS records

Create an **A** (or **AAAA**) record pointing each of the following
hostnames at the server's public IP:

| Hostname (example) | Points to | Serves |
|---|---|---|
| `app.example.com` | server IP | OpenLinker admin UI (`web`) |
| `api.example.com` | server IP | OpenLinker API (`api`) |
| `shop.example.com` | server IP | PrestaShop |

`worker` needs **no DNS record** — it's a background process with no
`EXPOSE`'d port and is never proxied.

Wait for DNS propagation (`dig +short app.example.com` should return the
server IP) before booting the proxy overlay — Caddy's automatic HTTPS will
retry on failure, but a certificate can't issue until the hostname resolves
publicly.

## 3. Environment variables

Two groups of variables are relevant here: the domain/CORS seams from #1375
(already documented in [`.env.example`](../.env.example)) and this guide's
new proxy + credential variables. They must be **kept consistent** — this is
the most common point of confusion:

| This guide's proxy var | Must match | Why |
|---|---|---|
| `WEB_DOMAIN` | `OL_CORS_ORIGIN` = `https://<WEB_DOMAIN>` | The API's CORS allow-list must match the browser origin the UI is served from, or login fails with a CORS `NetworkError`. |
| `API_DOMAIN` | `VITE_API_BASE_URL` = `https://<API_DOMAIN>` | Baked into the UI bundle at **build time** — changing it requires `--build` on the `web` image, not just a restart. |
| `PRESTASHOP_DOMAIN` | `PS_DOMAIN` = `<PRESTASHOP_DOMAIN>` | The domain PrestaShop bakes into its own generated links/redirects. |

Worked example, given the DNS records above:

```dotenv
# Proxy overlay
WEB_DOMAIN=app.example.com
API_DOMAIN=api.example.com
PRESTASHOP_DOMAIN=shop.example.com
TLS_EMAIL=ops@example.com

# Must line up with the domains above (scheme included)
OL_CORS_ORIGIN=https://app.example.com
VITE_API_BASE_URL=https://api.example.com
PS_DOMAIN=shop.example.com
```

> **The internal PrestaShop connection URL is unaffected by any of this.**
> When wiring the PrestaShop connection in OpenLinker (see the [demo setup
> guide § 5.2](./one-command-demo-setup-guide.md#52-create-the-connection-in-openlinker)),
> the Shop URL / Storefront URL are still `http://prestashop` — the
> **internal**, container-to-container address — never the public
> `PRESTASHOP_DOMAIN`. The API/Worker containers never resolve the public
> domain; only the operator's browser does.

The full variable reference (base demo vars + this guide's additions) is in
[`.env.example`](../.env.example) — every override lives there with an
explanation and default.

## 4. Credential rotation

Before exposing the stack beyond localhost, rotate every credential
`.env.example` lists under "Database / service credentials": `POSTGRES_PASSWORD`,
`PRESTASHOP_MYSQL_ROOT_PASSWORD`, `PRESTASHOP_MYSQL_PASSWORD`,
`WOOCOMMERCE_MYSQL_ROOT_PASSWORD`, `WOOCOMMERCE_MYSQL_PASSWORD`, `ADMIN_PASSWD`
— plus the pre-existing `OL_BOOTSTRAP_ADMIN_PASSWORD` and `JWT_SECRET` from
the base demo guide. None of the shipped defaults are production-safe; they
exist only so a plain local `pnpm demo:up` works with zero configuration.

Generate strong values, e.g.:

```bash
openssl rand -base64 24   # for each *_PASSWORD / *_PASSWD variable
```

Two credential pairs must stay in sync **because they're read by two
different services** — set them once in `.env` and both sides pick up the
same value automatically (see `docker-compose.yml` comments for the exact
pairing): `PRESTASHOP_MYSQL_PASSWORD` (mysql user password ⟷ PrestaShop's
`PS_DB_PASSWD`), `WOOCOMMERCE_MYSQL_PASSWORD` (woocommerce-mysql user
password ⟷ WordPress's `WORDPRESS_DATABASE_PASSWORD`). You don't need to set
anything twice — one `.env` line per variable is enough.

## 5. Boot the stack with the proxy overlay

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.proxy.yml \
  up -d --build postgres redis mysql prestashop migrate api worker web caddy
```

The proxy overlay (`docker-compose.proxy.yml`) adds one service, `caddy`,
which:
- reaches `web` / `api` / `prestashop` **over the internal Compose network**
  by service name and container port — it does not depend on those
  services' host-published ports at all;
- terminates TLS for the three domains configured in step 3;
- publishes host ports `80` and `443` (unbound — this is the public edge).

Confirm it's up:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.proxy.yml logs -f caddy
```

Look for `certificate obtained successfully` per domain in the log output.

Omitting `-f docker-compose.proxy.yml` reproduces the plain-HTTP localhost
demo exactly as documented in the [base setup guide](./one-command-demo-setup-guide.md)
— this overlay changes nothing else.

## 6. Local verification (no real DNS needed)

To verify the proxy overlay boots and routes correctly **before** you have
real DNS/domains, or in a local sandbox:

1. Pick three test hostnames (e.g. `app.local.test`, `api.local.test`,
   `shop.local.test`) and add them to `/etc/hosts` pointing at `127.0.0.1`.
2. Set `.env`:
   ```dotenv
   WEB_DOMAIN=app.local.test
   API_DOMAIN=api.local.test
   PRESTASHOP_DOMAIN=shop.local.test
   TLS_EMAIL=test@example.com
   CADDYFILE_PATH=./docker/caddy/Caddyfile.local
   ```
   `Caddyfile.local` uses `tls internal` — Caddy mints certificates from its
   own local CA instead of requesting one from Let's Encrypt, so no real
   DNS/domain or `mkcert` dependency is needed.
3. Boot with the same command as step 5.
4. Your browser will show a certificate warning (the cert is signed by
   Caddy's local CA, not a public one) — accept it to verify routing/TLS
   termination. To remove the warning entirely, trust Caddy's local root CA:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.proxy.yml \
     exec caddy caddy trust
   ```
   (installs the CA inside the container only; for the *browser* to stop
   warning you'd additionally need to extract and trust that CA on the host
   — out of scope for a quick verification pass.)

Switch `CADDYFILE_PATH` back to the default (or unset it) to return to the
production ACME Caddyfile.

## 7. Post-deploy verification checklist

Run through this after every deployment (initial or credential rotation):

- [ ] **TLS certificate valid** for each domain:
  ```bash
  curl -vI https://app.example.com 2>&1 | grep -i "SSL certificate verify ok"
  ```
  or check the padlock in a browser.
- [ ] **Login works with no CORS console errors** — open the browser dev
  console while logging in at `https://<WEB_DOMAIN>`; no
  `NetworkError`/CORS messages.
- [ ] **API health check returns 200**:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/v1/health
  ```
- [ ] **PrestaShop reachable at its own domain**: `https://<PRESTASHOP_DOMAIN>`
  loads the storefront.
- [ ] **Database ports unreachable from outside the host** — run from a
  *different* machine (not the server itself):
  ```bash
  nmap -p 5432,3306,3307,6379 <server-public-ip>
  # or, per port:
  curl --connect-timeout 3 <server-public-ip>:5432
  ```
  All should report closed/filtered/refused. If any is open, check the host
  firewall — the compose files publish these ports for local dev convenience;
  a public-facing host needs a firewall rule blocking them (or the
  `${OL_BIND_ADDRESS}` loopback-binding hardening from #1400/#1402, once
  merged, which binds them to `127.0.0.1` by default at the compose level).
- [ ] **Internal PrestaShop connection URL is still `http://prestashop`** —
  re-confirm the OpenLinker↔PrestaShop connection's Shop URL/Storefront URL
  fields were **not** accidentally set to the public `PRESTASHOP_DOMAIN`
  (see § 3 callout above).
- [ ] **Credentials rotated** — `POSTGRES_PASSWORD`, both MySQL instance
  password pairs, `ADMIN_PASSWD`, `OL_BOOTSTRAP_ADMIN_PASSWORD`, `JWT_SECRET`
  are all non-default values in `.env`.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Caddy log shows `challenge failed` / certificate never issues | DNS hasn't propagated yet, or port 80 is blocked by a firewall/security group | `dig +short <domain>` to confirm propagation; confirm port 80 (not just 443) is open — Let's Encrypt's HTTP-01 challenge needs it |
| Browser shows a certificate warning even with the production Caddyfile | `CADDYFILE_PATH` is still pointed at `Caddyfile.local` | Unset `CADDYFILE_PATH` (or point it back at `./docker/caddy/Caddyfile`) and restart the `caddy` service |
| Login fails with a CORS `NetworkError` after switching to a public domain | `OL_CORS_ORIGIN` doesn't match `https://<WEB_DOMAIN>` exactly (scheme/host) | Fix `OL_CORS_ORIGIN` in `.env`, restart `api` |
| UI calls the wrong API origin / mixed-content errors | `VITE_API_BASE_URL` wasn't set before the `web` image was built | Set it in `.env`, rebuild: `docker compose ... up -d --build web` |
| `docker compose up` with the proxy overlay fails immediately citing a missing var | One of `WEB_DOMAIN`/`API_DOMAIN`/`PRESTASHOP_DOMAIN`/`TLS_EMAIL` is unset | Set all four in `.env` — the overlay fails closed by design (`${VAR:?...}`) rather than booting half-configured |
| `caddy` service can't reach `web`/`api`/`prestashop` | Booted without `-f docker-compose.demo.yml` (no `web` service exists) | Always use the 3-file invocation from § 5 |

For everything else (PrestaShop admin folder, seller-defaults, offer
creation, etc.), see the [base demo setup guide's troubleshooting
table](./one-command-demo-setup-guide.md#8-troubleshooting).
