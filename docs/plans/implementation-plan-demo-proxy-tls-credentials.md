# Implementation Plan: Reverse-Proxy/TLS Overlay, DB Credential Overrides, and Public-Domain Deployment Guide

**Issue**: #1403
**Branch**: `1403-demo-proxy-tls-credentials`
**Layer**: DX / Infrastructure (docker-compose + docs, no application code)

## 1. Understand the task

**Goal.** The demo stack (#1352/#1365) already carries the env-var seams to serve
under a real domain (`VITE_API_BASE_URL` / `OL_CORS_ORIGIN` / `PS_DOMAIN`, #1375)
and #1400/#1402 harden port binding. What's still missing for an operator to
actually deploy the demo behind a public domain:

1. A reverse-proxy + TLS compose overlay (Caddy — automatic HTTPS, minimal ACME
   config) that routes by hostname to `web` / `api` / `prestashop`.
2. Non-default, `.env`-overridable database/service credentials
   (`POSTGRES_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` for both MySQL
   instances, PrestaShop `ADMIN_PASSWD`) — today these are hardcoded literals.
3. A deployment guide covering DNS, the proxy overlay, the full env-var list,
   and a post-deploy verification checklist.

**Non-goals** (explicit, from the issue): CI/CD pipeline changes, container
orchestration beyond docker-compose (no Kubernetes), a general secrets-vaulting
overhaul beyond the four named credentials, and a hardened production topology
(load balancing, WAF). This stays "demo/evaluation reachable under a real
domain," not production-grade.

**Dependency note.** PR #1402 (port-binding hardening, closes #1400) is **still
open**, not merged, as of this session. Per orchestrator instruction, this
branch is cut from current `origin/main` (pre-#1402) rather than waiting. The
proxy design below is deliberately **independent of whether #1402's
loopback-binding has landed** — see §3.1.

## 2. Research the codebase

- `docker-compose.yml` (base): postgres/redis/mysql/phpmyadmin/woocommerce-mysql/
  woocommerce/prestashop/api services. Hardcoded credentials today:
  `POSTGRES_PASSWORD: postgres`, `MYSQL_ROOT_PASSWORD: root` (both `mysql` and
  `woocommerce-mysql`), `MYSQL_PASSWORD: prestashop` (mysql→prestashop user) /
  `MYSQL_PASSWORD: woocommerce` (woocommerce-mysql→woocommerce user),
  `ADMIN_PASSWD: prestashop_demo` (prestashop service). `PS_DOMAIN` is already
  `${VAR:-default}` (#1375) — the pattern to replicate.
- `docker-compose.demo.yml` (overlay): adds `worker`, `web`, `migrate`, reshapes
  `api` to production posture. `OL_BOOTSTRAP_ADMIN_PASSWORD`, `OL_CORS_ORIGIN`,
  `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` already follow the `${VAR:-default}` /
  `${VAR:?message}` pattern this issue extends.
- `.env.example`: one REQUIRED var (`OPENLINKER_CREDENTIALS_ENCRYPTION_KEY`),
  then an "OPTIONAL" block per #1375 var with a comment explaining why/when to
  set it. New vars follow this exact section shape.
- `docs/one-command-demo-setup-guide.md`: the existing demo runbook — gets a
  cross-reference to the new guide, not a rewrite.
- Prior art for Caddy in this repo: `libs/integrations/woocommerce/docs/
  master-shop-setup-guide.md` already documents an ad-hoc local Caddy
  reverse-proxy for HTTPS (`caddy reverse-proxy`, `NODE_EXTRA_CA_CERTS` for the
  API/worker to trust Caddy's local CA). Useful reference for the "local
  verification" section of the new guide, not directly reusable code.
- `apps/web/Dockerfile` confirms `web` serves on container port 80 (nginx);
  `api` listens on 3000; `prestashop` on container port 80. No service other
  than `web`/`api`/`prestashop` needs a public hostname — `worker` has no
  `EXPOSE` (issue confirms this explicitly).

## 3. Design

### 3.1 Reverse-proxy/TLS overlay — network-based routing, not port-based

**Key design decision:** the new `docker-compose.proxy.yml` overlay's `caddy`
service joins the same Compose network as every other service and reverse-proxies
to them **by service DNS name and container port** (`web:80`, `api:3000`,
`prestashop:80`) — it does **not** route through the host-published ports at
all. This makes the overlay correct regardless of whether #1402's loopback-bind
changes have landed on `main` yet, and is also simply the more robust pattern
(no double-hop through the host network stack). Operators can keep or drop the
host port publishes independently — this overlay doesn't care.

`docker-compose.proxy.yml`:
```yaml
services:
  caddy:
    image: caddy:2-alpine
    container_name: openlinker-caddy
    ports:
      - '80:80'
      - '443:443'
    environment:
      WEB_DOMAIN: '${WEB_DOMAIN:?...}'
      API_DOMAIN: '${API_DOMAIN:?...}'
      PRESTASHOP_DOMAIN: '${PRESTASHOP_DOMAIN:?...}'
      TLS_EMAIL: '${TLS_EMAIL:?...}'
    volumes:
      - '${CADDYFILE_PATH:-./docker/caddy/Caddyfile}:/etc/caddy/Caddyfile:ro'
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [web, api, prestashop]

volumes:
  caddy_data:
  caddy_config:
```

`depends_on: [web, ...]` means this overlay **must always be combined with
`docker-compose.demo.yml`** (the bare dev stack has no `web` service) — the
guide states this explicitly with the 3-file compose invocation.

Two Caddyfiles ship under `docker/caddy/`:
- `Caddyfile` (default, mounted via `CADDYFILE_PATH` default) — production
  ACME (Let's Encrypt) automatic HTTPS, one site block per domain.
- `Caddyfile.local` — `tls internal` variant for local verification without a
  real domain/DNS (self-signed, Caddy's internal CA), selected via
  `CADDYFILE_PATH=./docker/caddy/Caddyfile.local` in `.env`.

`80:443` are published unbound (not loopback) by design — this is the public
TLS-terminating edge; that's the point of the overlay.

### 3.2 Credential parametrization

Follow the exact `${VAR:-default}` pattern #1375 established (defaults =
today's literal values, so a plain `pnpm demo:up` / `dev:stack:up` is
byte-identical in behavior). **Decision (human, post-plan-review): 6 separate,
instance-specific var names** — not shared names across the two MySQL
instances. This supersedes the plan's original draft (which proposed reusing
one var name across both instances to literally match the issue's 4-name
list); the human confirmed 6 distinct vars is the intended design.

| Var | Used in | Default | Notes |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `postgres` service | `postgres` | Single instance, single var. |
| `PRESTASHOP_MYSQL_ROOT_PASSWORD` | `mysql` service (root), `phpmyadmin` (`PMA_PASSWORD` + `MYSQL_ROOT_PASSWORD` — phpMyAdmin only ever talks to the `mysql`/PrestaShop instance), `mysql` healthcheck | `root` | Instance-specific: the PrestaShop-side MySQL container. |
| `PRESTASHOP_MYSQL_PASSWORD` | `mysql` service (prestashop DB user) + `prestashop` service (`PS_DB_PASSWD`/`DB_PASSWD`, must match) | `prestashop` | Both call sites must resolve to the same value — same var, referenced twice. |
| `WOOCOMMERCE_MYSQL_ROOT_PASSWORD` | `woocommerce-mysql` service (root), its healthcheck | `root` | Instance-specific: the WooCommerce-side MySQL container. |
| `WOOCOMMERCE_MYSQL_PASSWORD` | `woocommerce-mysql` service (woocommerce DB user) + `woocommerce` service (`WORDPRESS_DATABASE_PASSWORD`, must match) | `woocommerce` | Same var referenced at both call sites. |
| `ADMIN_PASSWD` | `prestashop` service (`ADMIN_PASSWD`) | `prestashop_demo` | Matches the literal PrestaShop-image env var name, same convention as `PS_DOMAIN`. |

Healthcheck arrays need the password baked into a single token
(`-p${PRESTASHOP_MYSQL_ROOT_PASSWORD:-root}` / `-p${WOOCOMMERCE_MYSQL_ROOT_PASSWORD:-root}`
replacing the current literal `-proot`) — docker compose interpolates `${...}`
in the compose YAML itself before handing the config to the Docker Engine, so
this resolves correctly with no shell quoting issues inside the container.

### 3.3 `.env.example` additions

Extend the existing "OPTIONAL" block (same section, same comment style) with
the four new vars, each documented with: what it guards, today's default, and
an explicit "rotate before non-loopback exposure" callout — mirroring the
existing `OL_BOOTSTRAP_ADMIN_PASSWORD` / `JWT_SECRET` entries. Also add a
"Reverse-proxy / public-domain overlay (optional)" sub-block for
`WEB_DOMAIN`, `API_DOMAIN`, `PRESTASHOP_DOMAIN`, `TLS_EMAIL`,
`CADDYFILE_PATH` — cross-referencing the new deployment guide instead of
duplicating the full explanation inline.

### 3.4 Deployment guide

New `docs/public-domain-demo-deployment-guide.md`:
1. Scope/framing — extends, doesn't replace, the "local evaluation only" demo;
   still not a hardened production topology.
2. Prerequisites — DNS A/AAAA records for the three hostnames (web/api/
   prestashop — no worker record), ports 80/443 open on the host firewall for
   ACME HTTP-01 + traffic, Docker Compose ≥ 2.24.
3. Env-var reference — the full list from #1375 (`OL_CORS_ORIGIN`,
   `VITE_API_BASE_URL`, `PS_DOMAIN`) **plus** this issue's new vars, with an
   explicit worked example showing how `WEB_DOMAIN`/`API_DOMAIN`/
   `PRESTASHOP_DOMAIN` must line up with `OL_CORS_ORIGIN`/`VITE_API_BASE_URL`/
   `PS_DOMAIN` (a common point of confusion per the issue).
4. Credential rotation — the four new vars, generation tips
   (`openssl rand -base64 24` etc.), explicit warning these must change before
   public exposure.
5. Boot command — the 3-file compose invocation.
6. Local verification path — `Caddyfile.local` + `/etc/hosts` override (no
   real DNS/domain needed), referencing the existing woocommerce doc's Caddy
   pattern for trust-store/NODE_EXTRA_CA_CERTS nuances where relevant.
7. Post-deploy verification checklist — TLS cert validity, login with no CORS
   console errors, `GET /v1/health` → 200, DB ports (5432/3306/6379) unreachable
   from outside the host (`nmap`/`curl --connect-timeout`), PrestaShop reachable
   at its own domain, and the repeated reminder that the **internal** PrestaShop
   connection URL in OpenLinker is always `http://prestashop`, never the public
   domain.
8. Troubleshooting — ACME challenge failures (DNS not propagated / port 80
   blocked), mixed-content/CORS symptoms, cert renewal.

`docs/one-command-demo-setup-guide.md` gets one short new subsection /
cross-reference pointing to the new guide (not a rewrite).

## 4. Step-by-step implementation

1. **`docker-compose.yml`** — parametrize the 4 credentials + 2 healthchecks
   (§3.2). Acceptance: `docker compose -f docker-compose.yml config` with no
   `.env` shows identical literal values to today; with a test `.env` setting
   all 4 vars, `config` shows the overridden values propagated to every
   dependent field (mysql user password ⟷ prestashop DB_PASSWD, etc.).
2. **`docker/caddy/Caddyfile`** and **`docker/caddy/Caddyfile.local`** (new) —
   per §3.1.
3. **`docker-compose.proxy.yml`** (new) — per §3.1.
4. **`.env.example`** — add the 4 credential vars + 5 proxy-overlay vars
   (§3.3).
5. **`docs/public-domain-demo-deployment-guide.md`** (new) — per §3.4.
6. **`docs/one-command-demo-setup-guide.md`** — add cross-reference subsection.
7. **Local verification** (per AC): boot
   `docker compose -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.proxy.yml up -d --build ...`
   with `CADDYFILE_PATH=./docker/caddy/Caddyfile.local` + `/etc/hosts` entries
   for the three test hostnames pointed at `127.0.0.1`; confirm Caddy issues
   its internal cert and routes each hostname to the right upstream, and that
   plain `pnpm demo:up` (no `.env`, no proxy overlay) is unaffected.

## 5. Validation

- **Architecture compliance**: no application code touched — pure
  docker-compose + docs change, consistent with the issue's declared layer.
- **Naming**: new compose file follows the `docker-compose.<purpose>.yml`
  convention already established (`docker-compose.demo.yml`); new doc follows
  the existing `docs/*-guide.md` naming.
- **Testing strategy**: no unit/integration tests apply (infra/docs only).
  Validation is the local Docker Compose boot + `docker compose config`
  diffing described in step 7, plus running the existing quality gate
  (`pnpm lint` / `pnpm type-check` / `pnpm test`) to confirm zero regressions
  from files outside the TS/JS toolchain's purview (should be a no-op, but run
  it per the standard process).
- **Security**: this is explicitly a security-labeled issue — the whole point
  is making the previously-implicit "don't expose this" caveat enforceable via
  `.env` overrides + a documented verification checklist. No new secrets are
  hardcoded; `.env` stays gitignored.
- **Backward compatibility**: acceptance criterion "plain `pnpm demo:up` /
  `pnpm dev:stack:up` (no `.env` overrides, no proxy overlay) behavior is
  unchanged" is the hard constraint validated in step 1 and step 7.

## Decisions confirmed (human, post-plan-review)

1. **6 distinct, instance-specific credential var names** (§3.2) — confirmed,
   supersedes the plan's original 4-shared-name draft.
2. **#1402 not yet merged** — proceed on `origin/main`; a small rebase conflict
   later is acceptable.
3. **Local verification**: `Caddyfile.local` + `tls internal` (no `mkcert`
   dependency) — confirmed.
