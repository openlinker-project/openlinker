# Resume context — Epic #152 (E2E clean-state walkthrough)

Drop this file to the next Claude session to reload context.

## Branch

`152-e2e-clean-state` — one commit `4c96d10` on top of `main` at the time of the split. Nothing pushed.

## Goal

Walk a clean-state install (#152) end-to-end. For every gap: file a child issue and, where small, fix it on this branch. Build `docs/getting-started.md` incrementally as we go (#153).

## Issues

Filed and **already fixed** on this branch:
- #154 — `apps/api/.env.example`
- #155 — PrestaShop unattended install in docker-compose
- #156 — stable `/admin-dev/` admin folder via post-install script

Filed, **not implemented in this session** (may or may not be done before resume — check their state):
- #157 — seed default admin user on first boot
- #158 — password reset flow
- #159 — Redis health false positive on dashboard (xREAD timeout)
- #160 — "Reset connection draft?" modal stuck visible (FE bug)
- #161 — guided per-platform connection wizard

## Progress on epic checklist

- [x] §1 Bootstrap & auth — reachable end-to-end (admin seed is manual until #157)
- [x] §2 Env + migrations + API/web boot
- [x] §3 Admin login (manual bcrypt insert as workaround)
- [ ] §4 Connections — **next step**
  - Blocked on #160/#161 if we want a good UX; otherwise can push through with the raw form
  - First attempt was a PrestaShop connection; config shape is `{ baseUrl: "http://localhost:8080" }`, `adapterKey: prestashop.webservice.v1`, `credentialsRef` resolves from env var `CREDENTIALS_<REF>` (plain string auto-wraps as `{ webserviceApiKey: value }`)
  - Need: generate a PrestaShop webservice API key in admin → Advanced Parameters → Webservice
- [ ] §5 Catalog pull
- [ ] §6 Inventory
- [ ] §7 Listings / Offers (category + attribute mapping, first offer, sync)
- [ ] §8 Orders (ingest, customer/address resolution, status sync)
- [ ] §9 Operations (job visibility, retries, webhooks)

## Working style (user preferences, observed)

- Run commands themselves; I guide step by step
- File issues for discovered gaps, but **work on related small ones in-session** rather than deferring everything
- Keep everything on single branch `152-e2e-clean-state`; one PR closes the whole cluster
- When scoping a bigger issue, propose a pragmatic v1 and ask before expanding
- Do not implement #157/#158 in this session; they are separate work

## Dev stack

```bash
docker compose down -v && pnpm dev:stack:up   # ~2-3 min for PS unattended install
pnpm --filter @openlinker/api migration:run
pnpm start:dev:api    # :3000
pnpm start:dev:web    # :5173
```

- PrestaShop admin: http://localhost:8080/admin-dev/ · `demo@prestashop.com` / `prestashop_demo`
- API env: `apps/api/.env.local` (template at `.env.example`)
- OpenLinker admin login: seed manually via bcrypt insert until #157 lands

## Resume prompt suggestion

> Resuming #152 from where we left off. Branch `152-e2e-clean-state` (commit 4c96d10). Status of #160 and #161: <done / still open>. Next up is epic step 4: create the first PrestaShop connection. See `docs/plans/resume-152.md` for full context.
