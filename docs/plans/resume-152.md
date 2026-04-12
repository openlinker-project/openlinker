# Resume context — Epic #152 (E2E clean-state walkthrough)

Drop this file to the next Claude session to reload context.

## Branch

`152-e2e-clean-state` — rebased on `main`. Shipping as PR at the end of session 2.

## Goal

Walk a clean-state install (#152) end-to-end. For every gap: file a child issue and, where small, fix it on this branch. Build `docs/getting-started.md` incrementally as we go (#153).

## Issues filed across sessions 1 + 2

Filed and **already fixed** on this branch:
- #154 — `apps/api/.env.example` (+ `apps/worker/.env.example` for symmetry)
- #155 — PrestaShop unattended install in docker-compose
- #156 — stable `/admin-dev/` admin folder via post-install script

Filed, **not implemented on this branch** (check state on resume):
- #157 — seed default admin user on first boot
- #158 — password reset flow
- #159 — Redis health false positive on dashboard (xREAD timeout)
- #160 — "Reset connection draft?" modal stuck visible — **merged in #162**
- #161 — guided per-platform connection wizard — **merged in #162**
- #163 — wizard: silent form reset after successful create
- #164 — connection detail: add Test connection button + show capabilities
- #165 — **blocking for step 4 UX:** wizard-created connections don't resolve credentials
- #166 — let users select which capabilities a connection should fulfil
- #167 — surface worker health on dashboard
- #168 — PrestaShop Webhooks module: auto-provision connection id + secret (step 7)
- #169 — **blocking for step 5:** no initial catalog discovery job

## Progress on epic checklist

- [x] §1 Bootstrap & auth
- [x] §2 Env + migrations + API/web/worker boot
- [x] §3 Admin login (manual bcrypt insert until #157)
- [x] §4 Connections — PrestaShop connection created; credentials resolve via env-var workaround until #165 lands
- [ ] §5 Catalog pull — **blocked on #169** (no discovery job)
- [ ] §6 Inventory
- [ ] §7 Listings / Offers
- [ ] §8 Orders
- [ ] §9 Operations (job visibility, retries, webhooks — #168 lands here)

## Working style (user preferences, observed)

- User runs commands themselves; I guide step by step
- File issues for discovered gaps; **work on related small ones in-session**, file-and-move-on for bigger ones
- Keep everything on single branch `152-e2e-clean-state`; one PR per session
- When scoping a bigger issue, propose a pragmatic v1 and ask before expanding
- Don't pull unrelated backend refactors (#157, #158, #165, #169) into the getting-started PR

## Dev stack

```bash
docker compose down -v && pnpm dev:stack:up   # ~2-3 min for PS unattended install
cp apps/api/.env.example apps/api/.env.local
cp apps/worker/.env.example apps/worker/.env.local
pnpm --filter @openlinker/api migration:run
pnpm start:dev:api       # :3000
pnpm start:dev:web       # :5173
pnpm start:dev:worker    # background sync
```

- PrestaShop admin: http://localhost:8080/admin-dev/ · `demo@prestashop.com` / `prestashop_demo`
- OpenLinker admin login: seed manually via bcrypt insert until #157 lands
- PS webservice key → add to BOTH `apps/api/.env.local` AND `apps/worker/.env.local` as `CREDENTIALS_<KEY_UPPER>=<KEY>` until #165 lands

## Resume prompt suggestion

> Resuming #152. Branch `152-e2e-clean-state` was merged in PR <NNN>. State of blockers: #165 <done/open>, #169 <done/open>. If both done, next is epic step 5 (catalog pull) → 6 (inventory) → 7 (listings). See `docs/plans/resume-152.md` for full context.
