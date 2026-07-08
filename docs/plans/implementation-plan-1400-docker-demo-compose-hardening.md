# Implementation Plan: Docker demo compose hardening (#1400)

## 1. Task

Harden `docker-compose.yml` + `docker-compose.demo.yml` so the one-command demo stack (#1352/#1365/#1397) is safe to run on a shared/public server, per devops feedback: infra services are inconsistently bound (some `0.0.0.0`, some `127.0.0.1`), and nothing is parametrized for running two stack instances side by side.

**Layer**: Infrastructure (docker-compose config only — no application code, no hexagonal layers touched).

**Non-goals** (per issue #1400): TLS/reverse-proxy, secrets management overhaul, CI changes, the non-demo dev-stack's `pnpm dev:stack:*` helper scripts that hardcode container names (`dev:stack:seed-woocommerce`, `dev:stack:wc-credentials` in `package.json`) — those still assume the default project name and are a known limitation when an operator overrides `COMPOSE_PROJECT_NAME`.

## 2. Current state (verified on origin/main @ a964d8bd, WooCommerce already merged via #1397)

- Unbound (`0.0.0.0`) port publishes: `postgres` (5432), `redis` (6379), `mysql` (3306), `phpmyadmin` (8081), `prestashop` (8080), base `api` (3000) — all in `docker-compose.yml`.
- Already loopback-bound: `woocommerce-mysql` (127.0.0.1:3307), `woocommerce` (127.0.0.1:8082) in `docker-compose.yml`; demo overlay's `api` (127.0.0.1:3000) and `web` (127.0.0.1:8090) in `docker-compose.demo.yml`.
- Every `container_name` is a hardcoded literal (`openlinker-postgres`, etc.); top-level `name: openlinker` is also a literal.
- `.env.example` already documents the `${VAR:-default}` override convention (`PS_DOMAIN`, `JWT_SECRET`, `OL_CORS_ORIGIN`, etc.) — this change follows that exact convention, it doesn't invent a new one.
- Volumes are already consistent: named volumes for persistent data (`postgres_data`, `mysql_data`, ...), bind-mounts only for live repo files the container needs (PrestaShop module source, PrestaShop/WooCommerce post-install/init scripts). No change needed there beyond documenting the rule.

## 3. Design

Single mechanism, applied uniformly (this *is* the fix for "brak konsekwencji"):

1. **Bind address**: one shared `OL_BIND_ADDRESS` var (default `127.0.0.1`) used on every port publish in both compose files. An operator who genuinely wants a service reachable beyond loopback (rare — normally only `web`/`api` sit behind a reverse proxy) overrides this per-deployment via `.env`, or a future per-service override if ever needed — out of scope today, uniform is enough to close the gap.
2. **Host ports**: one override var per service (`POSTGRES_PORT`, `REDIS_PORT`, `MYSQL_PORT`, `PHPMYADMIN_PORT`, `PRESTASHOP_PORT`, `WOOCOMMERCE_MYSQL_PORT`, `WOOCOMMERCE_PORT`, `API_PORT`, `WEB_PORT`), defaulting to today's literal value — so a second instance overrides these plus `OL_BIND_ADDRESS`/`COMPOSE_PROJECT_NAME` in its own `.env` and coexists with the first.
3. **Project/container naming**: top-level `name: ${COMPOSE_PROJECT_NAME:-openlinker}` and every `container_name: ${COMPOSE_PROJECT_NAME:-openlinker}-<service>`. Default value reproduces today's exact names (`openlinker-postgres`, ...) so nothing observable changes for an operator who doesn't set `.env` overrides.
4. **Volume/bind-mount rule**: add a short comment block to `docker-compose.yml` (mirroring the existing header comment already in `docker-compose.demo.yml`) stating the rule explicitly.
5. **Docs**: update `.env.example` (new vars, same comment style as existing entries) and `docs/one-command-demo-setup-guide.md` (mention override vars + multi-instance capability).

`docker-compose.demo.yml`'s `api`/`web` overrides already use `127.0.0.1` literals — convert them to `${OL_BIND_ADDRESS:-127.0.0.1}` + `${API_PORT:-3000}` / `${WEB_PORT:-8090}` for consistency with the base file, since Compose merges the two files and a mismatched var name between them would silently reintroduce the same inconsistency this issue is about.

## 4. Steps

1. `docker-compose.yml`:
   - Add header comment documenting bind-address / port / naming override vars and the volume rule.
   - `name: ${COMPOSE_PROJECT_NAME:-openlinker}`.
   - `postgres`, `redis`, `mysql`, `phpmyadmin`, `prestashop`, `woocommerce-mysql`, `woocommerce`, `api`: `container_name: ${COMPOSE_PROJECT_NAME:-openlinker}-<service>`; port publish → `'${OL_BIND_ADDRESS:-127.0.0.1}:${<SERVICE>_PORT:-<default>}:<container-port>'`.
   - **Acceptance**: `docker compose -f docker-compose.yml config` renders identical effective ports/names to today when no `.env` overrides are set (i.e. `0.0.0.0` publishes become `127.0.0.1` — the intended behavior change — everything else identical).
2. `docker-compose.demo.yml`:
   - `api` override `ports: !override` → `'${OL_BIND_ADDRESS:-127.0.0.1}:${API_PORT:-3000}:3000'`.
   - `web` → `'${OL_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-8090}:80'`.
   - `worker`, `migrate` `container_name` → `${COMPOSE_PROJECT_NAME:-openlinker}-<service>`.
   - **Acceptance**: `docker compose -f docker-compose.yml -f docker-compose.demo.yml config` shows no port/name regressions vs. today's defaults.
3. `.env.example`: add the new vars (`COMPOSE_PROJECT_NAME`, `OL_BIND_ADDRESS`, `POSTGRES_PORT`, `REDIS_PORT`, `MYSQL_PORT`, `PHPMYADMIN_PORT`, `PRESTASHOP_PORT`, `WOOCOMMERCE_MYSQL_PORT`, `WOOCOMMERCE_PORT`, `API_PORT`, `WEB_PORT`) documented in the existing "OPTIONAL — every value has a working default" block.
4. `docs/one-command-demo-setup-guide.md`: add a short "Running multiple instances / hardening for a shared server" note pointing at the new vars.
5. **Verification** (in this worktree, isolated from any other running stack):
   - Clean boot: only `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` set in `.env`, run `pnpm demo:up`, confirm all services healthy and reachable at the documented `localhost:*` ports, admin/admin login works — i.e. default behavior unchanged except loopback binding.
   - Second-instance boot: a second `.env` (different project name/prefix + shifted ports) run alongside the first, confirm no port/container-name collisions and both stacks come up healthy.
   - Tear down both after verification.

## 5. Validation

- No architecture-layer concerns (no TS/core code touched).
- `pnpm lint` / `pnpm type-check` not expected to be affected — run once as a sanity check since it's cheap.
- Docker-only verification is the real test here (see step 5 above).

## 6. Risks / open questions

- YAML `${VAR:-default}` interpolation inside `container_name` and `ports` is well-supported by Compose; the existing `PS_DOMAIN` / `JWT_SECRET` precedent in the same files confirms the pattern works in this repo's Compose version.
- `pnpm dev:stack:seed-woocommerce` / `wc-credentials` hardcode `openlinker-woocommerce` — left as-is (documented non-goal); they still work under the default project name.
- Not attempting per-service bind-address overrides (only one global `OL_BIND_ADDRESS`) — sufficient to close the "brak konsekwencji" gap without over-engineering; a future need for e.g. `web` reachable on `0.0.0.0` while DB stays loopback can add a per-service var later.
