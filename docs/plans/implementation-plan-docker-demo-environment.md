# Implementation Plan: One-Command Docker Demo Environment (PrestaShop + API/Web/Worker)

**Date**: 2026-07-06
**Status**: Draft
**Issue**: [#1352](https://github.com/openlinker-project/openlinker/issues/1352)
**Estimated Effort**: 1–1.5 days

---

## 1. Task Summary

**Objective**: Provide a single command (`pnpm demo:up`) that stands up the *entire* OpenLinker stack — Postgres, Redis, MySQL, PrestaShop, API, Worker, Web — from a clean checkout with empty Docker volumes, so a new contributor or evaluator can click through an end-to-end PrestaShop ↔ OpenLinker flow without any manual build/run steps.

**Context**: Today `docker-compose.yml` + `pnpm dev:stack:up` only bring up infrastructure (`postgres redis mysql phpmyadmin prestashop`) for local `pnpm start:dev:*` workflows. The `Dockerfile` only builds the API, in a dev-shaped compose service (bind-mounted source, `NODE_ENV=development`). There is no Worker container, no Web container, and no automated migration step — so "OpenLinker in Docker" today cannot be evaluated end-to-end by anyone who isn't already running the pnpm dev workflow locally.

**Classification**: DX / Infrastructure (build + orchestration only — no domain code, no CORE/Integration changes).

---

## 2. Scope & Non-Goals

### In Scope
- A `worker` build target in the root `Dockerfile`.
- A new `apps/web/Dockerfile` (static build + nginx serve).
- A `docker-compose.demo.yml` overlay, combined with the existing `docker-compose.yml` via `-f`, adding production-shaped `api`, `worker`, `web`, and a one-shot `migrate` service.
- `pnpm demo:up` / `demo:down` / `demo:logs` scripts.
- `README.md` documentation of the demo flow.
- **Fixing a pre-existing Dockerfile defect** discovered during research (see §4) that currently breaks the API production image build — in scope because it directly blocks this issue's acceptance criteria ("API image builds and serves traffic").

### Out of Scope
- Auto-seeding the PrestaShop↔OpenLinker connection inside OpenLinker (operator configures manually via the UI, as today).
- Production hardening: TLS, secrets management, non-default passwords, non-localhost domains.
- WooCommerce in the demo overlay.
- A runtime-config bootstrap for the frontend (`VITE_API_BASE_URL` stays build-time, per `docs/frontend-architecture.md` § Runtime Configuration).
- Changing `pnpm dev:stack:up` / the existing dev-shaped `api` compose service — must remain untouched and working exactly as today.

### Constraints
- Must not violate `synchronize: false` (`apps/api/src/database/data-source.ts:76`) — migrations remain the only schema source of truth.
- Must not change the CORE ↔ Integration boundary — this is orchestration only.
- Targets local single-host evaluation (localhost URLs, default demo credentials). Not a hosted/multi-tenant deployment.

---

## 3. Architecture Mapping

**Target Layer**: App / Infrastructure (build + orchestration). No `libs/core`, `libs/integrations/**`, or `apps/{api,worker}/src/**` domain code changes.

**Capabilities Involved**: None (no port/adapter work).

**Existing Components Reused**:
- `docker/prestashop/post-install/**` — PrestaShop auto-seed scripts, unchanged.
- `BootstrapAdminService.onApplicationBootstrap()` (`apps/api/src/auth/bootstrap-admin.service.ts`) — seeds the admin login. **Important nuance found in code** (see §5) that changes how the demo must configure this.
- `docs/migrations.md` § Production (Compiled JavaScript) — the documented pattern for running migrations against a compiled image.
- Existing `docker-compose.yml` infra services (`postgres`, `redis`, `mysql`, `prestashop`) — reused via Compose file overlay (`-f docker-compose.yml -f docker-compose.demo.yml`), not duplicated.

**New Components Required**:
- `worker` stage in `Dockerfile`.
- `apps/web/Dockerfile` + `apps/web/nginx.conf`.
- `docker-compose.demo.yml`.
- `demo:*` scripts in root `package.json`.

**Core vs Integration Justification**: N/A — this task touches no bounded context. It is host-level build/orchestration, matching the issue's own classification.

---

## 4. External / Domain Research

### Internal Patterns Found

**Confirmed via direct inspection — current repo state matches the issue's problem statement exactly**:
- `Dockerfile` has one `production` stage, `CMD ["node", "apps/api/dist/apps/api/src/main.js"]`. No worker stage.
- `apps/web/Dockerfile` does not exist.
- `docker-compose.yml`'s `api` service: `NODE_ENV: development`, bind-mounts `./apps/api:/app/apps/api` and `./libs:/app/libs`.
- `pnpm dev:stack:up` = `docker compose up -d postgres redis mysql phpmyadmin prestashop` — no app tier.
- `apps/api/src/database/data-source.ts:76` — `synchronize: false`, and no `migrationsRun` option is set anywhere. A fresh Postgres volume has no schema until `migration:run` is invoked manually.
- No `demo:*` scripts exist in `package.json`.

**🔴 Pre-existing bug found during research — blocks this issue's acceptance criteria:**

`Dockerfile`'s `base` and `production` stages copy `package.json` and `dist`/`node_modules` for exactly these packages: `core`, `shared`, `plugin-sdk`, `test-kit`, `ai`, `allegro`, `dpd-polska`, `erli`, `inpost`, `prestashop`, `subiekt`, `woocommerce`.

But `libs/integrations/` now also contains **`ksef`** and **`infakt`** (confirmed via `ls libs/integrations/`), and both `apps/api/package.json:46-47` and `apps/worker/package.json:31-32` declare:
```json
"@openlinker/integrations-infakt": "workspace:*",
"@openlinker/integrations-ksef": "workspace:*",
```
`apps/api/src/plugins.ts` imports and registers `KsefIntegrationModule` and `InfaktIntegrationModule` unconditionally.

Since the `Dockerfile`'s `base` stage runs `pnpm install` using **only** the explicitly-copied `package.json` files (before `COPY . .`), pnpm cannot resolve the `workspace:*` protocol reference to `@openlinker/integrations-ksef` / `-infakt` — **this fails the `base` stage's `pnpm install` outright**, meaning the current `Dockerfile` cannot successfully build the API image at all today. This has gone unnoticed because CI does not build the Dockerfile yet (`.github/workflows/ci.yml:31-32`: *"Dockerfile is deliberately NOT ignored: it feeds the future image build once CD is enabled"* — i.e., no CI job invokes `docker build` today).

This must be fixed as part of this issue — a demo overlay that fails to build the API image doesn't satisfy any acceptance criterion.

**Admin bootstrap nuance found in code** (`apps/api/src/auth/bootstrap-admin.service.ts:56-64`):
```ts
const isProduction = nodeEnv === 'production';
const fallbackPassword = isProduction ? this.generatePassword() : NON_PROD_DEFAULT_PASSWORD;
```
If the demo `api` container runs with `NODE_ENV=production` (a literal reading of "production-shaped"), the seeded admin password is a **random 18-byte value printed once in the log**, not `admin`. The issue's acceptance criteria requires a predictable `admin`/`admin` login. Resolution (see §6, Phase 3): set `OL_BOOTSTRAP_ADMIN_PASSWORD=admin` explicitly in the demo `api` environment, which short-circuits the production/non-production branch entirely (`providedPassword ?? fallbackPassword`) — this keeps `NODE_ENV=production` for the "production-shaped" container the issue asks for, without fighting the security-by-default logic or weakening it for real production users.

**Migration execution nuance found in code** (`apps/api/package.json:25-27`, `docs/migrations.md` § Production):
- Dev migration scripts use `NODE_OPTIONS='-r ts-node/register -r tsconfig-paths/register'` — both are `devDependencies` (`apps/api/package.json`), **excluded** by `pnpm install --prod` in the `production` Dockerfile stage.
- The documented production pattern instead runs the **compiled** `data-source.js` directly: `node node_modules/.bin/typeorm migration:run -d apps/api/dist/apps/api/src/database/data-source.js` — no `ts-node`/`tsconfig-paths` needed, since compiled output resolves `@openlinker/*` packages via ordinary `node_modules` resolution (pnpm workspace symlinks), not TS path-mapping. `typeorm` itself is a direct runtime dependency of `@openlinker/api`, so it is present after `pnpm install --prod`. This is the command the new `migrate` service must use — **flagged as a verification step in Phase 4**, since it hasn't been exercised against this exact multi-stage image before.

### External System
Not applicable — no new external system integration.

---

## 5. Questions & Assumptions

### Open Questions
- Does `apps/worker` require any environment variables beyond `DB_*` / `REDIS_*` (matching the API's naming, per `apps/api/src/database/data-source.ts:55-59`)? Not fully verified against `apps/worker`'s own config module — assumed symmetric with the API's naming convention, which is consistent throughout this codebase. **Verify during implementation** by booting the worker container and checking for `ConfigService` warnings/crashes.
- Exact compiled worker entrypoint path — `apps/worker/package.json:11` confirms `dist/apps/worker/src/main.js` (mirrors the API's `apps/api/dist/apps/api/src/main.js` shape), so `CMD ["node", "apps/worker/dist/apps/worker/src/main.js"]` in the new Dockerfile stage. Low risk, but confirm the build actually emits at that path (`tsc -p tsconfig.build.json` with `outDir: ./dist`, per `apps/worker/tsconfig.build.json`).

### Assumptions
- "Basic docker of our app" = the buildable production image(s), not the dev-watch flow (per the issue's own stated assumption). Confirmed compatible with what's described above.
- Demo targets local single-host use; default demo credentials (`admin`/`admin`, PrestaShop `demo@prestashop.com`/`prestashop_demo`) are acceptable, matching what's already shipped for PrestaShop.
- `NODE_ENV=production` is used for the demo `api`/`worker` containers (matches the issue's "production-shaped" ask for the app tier), with `OL_BOOTSTRAP_ADMIN_PASSWORD=admin` set explicitly to guarantee the predictable login regardless of that setting (see §4).
- The `docker-compose.demo.yml` overlay is combined with the base `docker-compose.yml` via `docker compose -f docker-compose.yml -f docker-compose.demo.yml ...`, reusing `postgres`/`redis`/`mysql`/`prestashop` service definitions as-is rather than duplicating them into a second, fully independent file. This is the interpretation of the issue's "composes the existing infra + prestashop" — see Alternatives Considered (§7) for the rejected duplicate-file approach.
- WooCommerce services (`woocommerce`, `woocommerce-mysql`) are never included in the demo service list — matches explicit out-of-scope.

### Documentation Gaps
- `docs/migrations.md` documents the production migration command but it has apparently never been exercised end-to-end in this repo's Docker image (no CI job builds the image). Phase 4 includes an explicit local verification step to close this gap for real, not just on paper.

---

## 6. Proposed Implementation Plan

### Phase 0: Fix the pre-existing Dockerfile / workspace-resolution gap
**Goal**: Make the current `Dockerfile` buildable again — a prerequisite for everything else in this issue.

1. **Add `ksef` + `infakt` to the `base` stage's selective `package.json` copy list**
   - **File**: `Dockerfile`
   - **Action**: Add `COPY libs/integrations/ksef/package.json ./libs/integrations/ksef/` and the same for `infakt`, alongside the existing `allegro`/`ai`/etc. lines, in both the `base` stage (pre-`pnpm install`) and the `production` stage (pre-`pnpm install --prod`).
   - **Acceptance**: `docker build --target base .` (and `--target production`) complete `pnpm install` without an `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`-class failure.
   - **Dependencies**: None.

2. **Copy `ksef` + `infakt` built `dist` into the `production` stage**
   - **File**: `Dockerfile`
   - **Action**: Add `COPY --from=base /app/libs/integrations/ksef/dist ./libs/integrations/ksef/dist` and the equivalent for `infakt`, next to the existing integration `dist` copies.
   - **Acceptance**: `docker run <image> node -e "require('@openlinker/integrations-ksef')"` resolves without `MODULE_NOT_FOUND`.
   - **Dependencies**: Step 1.

### Phase 1: Worker build target
**Goal**: A buildable, runnable Worker container image.

1. **Add a `worker` stage to `Dockerfile`**
   - **File**: `Dockerfile`
   - **Action**: Duplicate the `production` stage's package-copy + `pnpm install --prod --ignore-scripts` block into a new stage named `worker`, but copy `apps/worker/dist` instead of `apps/api/dist`, and every `libs/integrations/*/dist` the worker depends on (`apps/worker/package.json:16-27` lists the same 10 integration packages as the API plus `dpd-polska`/`inpost`/`woocommerce` already present — verify the full worker dependency list matches exactly, since the worker's `package.json` deps are the source of truth, not the API's). Set `CMD ["node", "apps/worker/dist/apps/worker/src/main.js"]`. No `EXPOSE` needed (worker has no HTTP surface — confirmed via `apps/worker/src/main.ts`, which calls `NestFactory.createApplicationContext`, not `create`).
   - **Acceptance**: `docker build --target worker -t openlinker-worker .` succeeds; `docker run openlinker-worker` (with valid `DB_*`/`REDIS_*` env) logs `"Worker application started"` (per `apps/worker/src/main.ts:22`) and does not crash-loop.
   - **Dependencies**: Phase 0.

### Phase 2: Frontend container
**Goal**: A buildable, runnable static Web container image.

1. **Add `apps/web/Dockerfile`**
   - **File**: `apps/web/Dockerfile` (new)
   - **Action**: Two-stage build:
     - Build stage (`node:20-alpine`): install workspace deps (mirroring the root `Dockerfile`'s package-copy pattern, scoped to what `@openlinker/web` needs), accept `ARG VITE_API_BASE_URL` and `ENV VITE_API_BASE_URL=$VITE_API_BASE_URL` (Vite bakes this in at build time — see `docs/frontend-architecture.md` § Environment Variables / Runtime Configuration), then `pnpm --filter @openlinker/web build` (`apps/web/package.json:11`: `tsc -b && vite build`).
     - Runtime stage (`nginx:alpine`): `COPY --from=build /app/apps/web/dist /usr/share/nginx/html`, plus a custom `nginx.conf`.
   - **Acceptance**: `docker build -t openlinker-web --build-arg VITE_API_BASE_URL=http://localhost:3000 -f apps/web/Dockerfile .` succeeds and produces a runnable image.
   - **Dependencies**: None (independent of Phases 0–1).

2. **Add `apps/web/nginx.conf`**
   - **File**: `apps/web/nginx.conf` (new)
   - **Action**: Minimal SPA config — `location / { try_files $uri /index.html; }` so React Router's client-side routes don't 404 on refresh. `listen 80;`.
   - **Acceptance**: Navigating directly to a deep route (e.g. `/connections`) in the running container serves `index.html`, not a 404.
   - **Dependencies**: Step 1.

### Phase 3: Demo compose overlay + migration bootstrap
**Goal**: One Compose invocation brings up the full stack with schema already applied.

1. **Add `docker-compose.demo.yml`**
   - **File**: `docker-compose.demo.yml` (new)
   - **Action**: An overlay file (used together with `docker-compose.yml` via `-f`) declaring:
     - `api` (override): `build.target: production` (unchanged), remove the dev bind-mounts (`volumes: []` — Compose file merge replaces array-valued keys rather than appending, so this cleanly drops the source mounts), `NODE_ENV: production`, add `OL_BOOTSTRAP_ADMIN_PASSWORD: admin` (see §4/§5), `depends_on: migrate: condition: service_completed_successfully`.
     - `worker` (new): `build.target: worker`, same `DB_*`/`REDIS_*` env as `api`, `depends_on` mirrors `api`.
     - `web` (new): `build: { context: ./apps/web, args: { VITE_API_BASE_URL: http://localhost:3000 } }`, port mapped to a free host port (e.g. `8090:80` — `8080` is PrestaShop, `8081` phpMyAdmin, `8082` WooCommerce), `depends_on: [api]` (soft — nginx doesn't need the API at boot, this is purely so `demo:up` reports a sane readiness order).
     - `migrate` (new, one-shot): `build.target: production` (reuses the same image as `api` — no separate Dockerfile stage needed), `command: ["node", "node_modules/.bin/typeorm", "migration:run", "-d", "apps/api/dist/apps/api/src/database/data-source.js"]` (per `docs/migrations.md` § Production — **verify in Phase 4**), same `DB_*` env as `api`, `depends_on: postgres: condition: service_healthy`, no `restart` policy (must run to completion, not loop).
   - **Acceptance**: File passes `docker compose -f docker-compose.yml -f docker-compose.demo.yml config` (validates merge, catches YAML/schema errors) without touching `docker-compose.yml`.
   - **Dependencies**: Phases 0–2.

2. **Add `demo:up` / `demo:down` / `demo:logs` scripts**
   - **File**: `package.json`
   - **Action**:
     ```json
     "demo:up": "docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build postgres redis mysql prestashop migrate api worker web",
     "demo:down": "docker compose -f docker-compose.yml -f docker-compose.demo.yml down",
     "demo:logs": "docker compose -f docker-compose.yml -f docker-compose.demo.yml logs -f"
     ```
     Explicit service list on `up` deliberately excludes `phpmyadmin`/`woocommerce`/`woocommerce-mysql` (not needed for the demo, keeps footprint minimal) — `migrate` before `api`/`worker` in the list is cosmetic (the real ordering is enforced by `depends_on`), included for readability.
   - **Acceptance**: `pnpm demo:up` on a machine with empty volumes ends with `api`, `worker`, `web`, `prestashop` all `Up`/healthy and `migrate` `Exited (0)`.
   - **Dependencies**: Step 1.

### Phase 4: Verification (manual — no unit/integration tests apply to pure orchestration)
**Goal**: Confirm every acceptance criterion from the issue against a real, from-scratch run.

1. **Clean-volume boot**: `docker compose -f docker-compose.yml -f docker-compose.demo.yml down -v` then `pnpm demo:up`. Confirm no manual intervention is needed.
2. **Migration verification**: confirm the `migrate` service's exact command (flagged as unverified in §4) actually runs to completion against the compiled image — this is the one step in this plan with real technical risk, since it's never been exercised in this repo's CI. If `node node_modules/.bin/typeorm migration:run -d apps/api/dist/apps/api/src/database/data-source.js` fails to resolve TypeORM's CLI entrypoint correctly against a compiled `DataSource` export, fall back to a tiny inline Node script that does `require('.../data-source.js').AppDataSource.initialize().then(ds => ds.runMigrations())` — keep whichever works, documented inline in `docker-compose.demo.yml` with a one-line comment explaining the choice.
3. **UI login**: browser → `http://localhost:8090` → log in `admin`/`admin` → confirm it reaches the API (network tab shows `http://localhost:3000` calls succeeding).
4. **Worker liveness**: `docker compose ... logs worker` shows `"Worker application started"` with no crash loop; trigger any sync job (e.g. via the UI) and confirm the worker log shows it processing.
5. **PrestaShop unaffected**: confirm `http://localhost:8080/admin` still auto-installs/seeds exactly as before (no regression — this path is untouched by this plan).
6. **Dev flow unaffected**: run plain `pnpm dev:stack:up` (no demo overlay) on a separate check and confirm behavior is identical to before this change (no `api`/`worker`/`web` started, dev-shaped `api` compose service definition in `docker-compose.yml` is byte-for-byte unchanged).

### Phase 5: Documentation
**Goal**: A newcomer can run the demo from `README.md` alone.

1. **Add a "Demo" section to `README.md`**
   - **File**: `README.md`
   - **Action**: Document `pnpm demo:up` / `demo:down` / `demo:logs`, the four service URLs (API `:3000`, Web `:8090`, PrestaShop `:8080/admin`, phpMyAdmin not included), default credentials (OL `admin`/`admin`, PrestaShop `demo@prestashop.com`/`prestashop_demo`), and an explicit note that the PrestaShop↔OpenLinker connection must be created manually via the OL UI (`/connections/new`) — matches the issue's explicit out-of-scope.
   - **Acceptance**: Section is self-contained; a reader who has never touched the repo can follow it end-to-end.
   - **Dependencies**: Phase 4 (documented commands must actually work as written).

---

## 7. Alternatives Considered

### Alternative 1: Fully duplicate the infra stack in `docker-compose.demo.yml`
Copy `postgres`/`redis`/`mysql`/`prestashop` service definitions wholesale into a second, standalone compose file instead of overlaying via `-f`.
- **Why Rejected**: Duplicates ~150 lines of already-working, carefully-tuned config (healthchecks, PrestaShop post-install volume mounts, etc.) that would silently drift from `docker-compose.yml` over time. The overlay (`-f base -f demo`) approach is the standard Compose pattern for exactly this "same infra, different app tier" scenario, and keeps `docker-compose.yml` the single source of truth for infra service shape.
- **Trade-off**: Overlay files are slightly less readable in isolation (you have to mentally merge two files) — mitigated by documenting the `-f` invocation clearly in `demo:*` scripts and `README.md`.

### Alternative 2: Bake migrations into the API container's entrypoint (run-then-exec pattern)
Instead of a separate one-shot `migrate` service, wrap the API's `CMD` in a shell entrypoint that runs `migration:run` then `exec`s the real start command.
- **Why Rejected**: Couples migration execution to every API container start/restart (including routine restarts unrelated to schema changes), and duplicates the same logic into the Worker's entrypoint too if the Worker also needs to guarantee schema readiness first. A single `migrate` one-shot service with `depends_on: condition: service_completed_successfully` gating both `api` and `worker` is simpler, matches the issue's own "Preferred: a one-shot migrate init step" wording, and is easy to re-run in isolation for debugging (`docker compose run migrate`).
- **Trade-off**: One extra service definition in the compose file — negligible cost.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No domain/CORE/Integration code touched. Confirmed no `libs/core/src/**`, `libs/integrations/**/src/**`, or `apps/{api,worker}/src/**` files are modified by this plan.
- ✅ No ADR required — per `docs/architecture-overview.md` § ADRs and `docs/architecture/adrs/README.md`, an ADR is warranted for decisions affecting bounded contexts or the plugin contract with non-trivial trade-offs; this is pure build/orchestration tooling with no such effect. (Confirmed no ADR draft is included in this plan's deliverables.)

### Naming Conventions
- ✅ `docker-compose.demo.yml`, `apps/web/Dockerfile` — consistent with existing `docker-compose.yml` / root `Dockerfile` naming.
- ✅ `demo:up` / `demo:down` / `demo:logs` mirror the existing `dev:stack:up` / `dev:stack:down` / `dev:stack:logs` naming family in `package.json`.

### Existing Patterns
- ✅ Multi-stage Dockerfile builds mirror the existing `base` → `production` pattern.
- ✅ One-shot init-container-before-app pattern (`migrate`) is the documented CI/CD recommendation already written in `docs/migrations.md` § CI/CD Integration ("Migrate then start") — this plan just moves that pattern into Compose instead of a CI YAML step.

### Risks
- **Migration command against the compiled image is unverified** (see §4, §6 Phase 4 Step 2) — the single highest-risk item in this plan, because it's never been exercised in this repo (no CI builds the Docker image today). Mitigated by an explicit fallback script documented inline.
- **Worker's exact runtime env var needs are assumed, not confirmed** — mitigated by a boot-and-observe-logs verification step (§6 Phase 4 Step 4) before considering the work done.
- **Fixing the pre-existing `ksef`/`infakt` Dockerfile gap (Phase 0) is technically out of the issue's original file list** but is a hard blocker for the issue's own acceptance criteria (an API image that builds at all) — flagged explicitly here rather than silently expanding scope.

### Edge Cases
- Running `pnpm demo:up` twice in a row (idempotency): the `migrate` service must be safely re-runnable — TypeORM's `migration:run` is naturally idempotent (tracks applied migrations in the `migrations` table), so a second `demo:up` on an already-migrated volume is a no-op for that service.
- Running `pnpm dev:stack:up` and `pnpm demo:up` concurrently on the same machine: both resolve to the same Compose *project* name (`name: openlinker` at the top of `docker-compose.yml`, unchanged by the overlay), so `postgres`/`redis`/`mysql`/`prestashop` are shared, not duplicated — this is intentional for local single-host evaluation (per the "not a hosted deployment" assumption) and should be called out in the `README.md` Demo section so it isn't surprising.

### Backward Compatibility
- ✅ No breaking changes. `docker-compose.yml`'s existing services and `dev:stack:*` scripts are unmodified; `docker-compose.demo.yml` is additive.

---

## 9. Testing Strategy & Acceptance Criteria

This is infrastructure/orchestration work with no application logic — Jest unit/integration tests (per `docs/testing-guide.md`) do not apply. Verification is manual, structured as the checklist in §6 Phase 4, executed against a real from-scratch Docker environment before this work is considered done.

### Acceptance Criteria (from the issue, restated as verification steps)
- [ ] `pnpm demo:up` brings up the full stack from empty volumes with no manual steps (§6 Phase 4.1)
- [ ] Migrations apply automatically before API traffic; `synchronize` stays `false` (§6 Phase 4.2; `synchronize: false` is untouched by this plan by construction)
- [ ] Web UI reachable, `admin`/`admin` login works, reaches the configured API (§6 Phase 4.3)
- [ ] Worker starts, connects to Redis/Postgres, processes at least one sync job (§6 Phase 4.4)
- [ ] PrestaShop reachable with seeded catalog + OL module, unchanged from today (§6 Phase 4.5)
- [ ] `docker-compose.demo.yml` doesn't alter the existing `dev:stack:up` flow (§6 Phase 4.6)
- [ ] `README.md` documents the full demo flow (§6 Phase 5)
- [ ] No CORE/Integration boundary violations (§8, confirmed by file-scope audit)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — N/A scope (no domain code)
- [x] Respects CORE vs Integration boundaries — nothing in those layers is touched
- [x] Uses existing patterns (no unnecessary abstractions) — reuses the existing multi-stage Dockerfile pattern, the documented migrate-then-start pattern, and Compose overlay composition instead of inventing something new
- [x] Idempotency considered — migration re-run safety addressed (§8 Edge Cases)
- [ ] Event-driven patterns — N/A, no application logic
- [ ] Rate limits & retries — N/A, no external API calls
- [x] Error handling comprehensive — N/A for compose/Dockerfile; migration failure surfaces as a non-zero exit on the `migrate` service, which blocks `api`/`worker` from starting via `depends_on: condition: service_completed_successfully`
- [x] Testing strategy complete — manual verification checklist mapped 1:1 to acceptance criteria (§9)
- [x] Naming conventions followed (§8)
- [x] File structure matches standards — new files land at repo root / `apps/web/` matching existing sibling files
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Migrations Guide](../migrations.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
