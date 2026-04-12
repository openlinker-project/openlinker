# Resume context — Epic #152 (E2E clean-state walkthrough)

Drop this file to the next Claude session to reload context.

## Branch

`152-e2e-clean-state` — rebased on `main`. Session 3 PR being opened on ship.

## Goal

Walk a clean-state install (#152) end-to-end. For every gap: file a child issue and, where small, fix it on this branch. Build `docs/getting-started.md` incrementally as we go (#153).

## Issues filed across sessions 1–3

Fixed on branch or already merged:
- #154 · #155 · #156 — onboarding (merged in PR #170)
- #161 — guided connection wizard (merged in PR #162)
- #169 — catalog discovery (merged in PR #171)
- #174 — category mappings FE shape mismatch (fixed in this PR)

Filed, **not implemented** (check state on resume):
- #157 seed default admin · #158 password reset · #159 dashboard Redis health false positive · #163 wizard post-create UX · #164 connection detail Test button + capabilities · #165 **blocking for wizard UX:** wizard credentials resolution · #166 per-connection capability selection · #167 worker health on dashboard · #168 PS webhooks module auto-provisioning · #172 Allegro OAuth callback multiple fires · #173 **blocking for step 7:** category mappings needs marketplace connection selector

## Progress on epic checklist

- [x] §1 Bootstrap & auth
- [x] §2 Env + migrations + API/web/worker boot
- [x] §3 Admin login (manual bcrypt insert until #157)
- [x] §4 PrestaShop connection (credentials env-var workaround until #165)
- [x] §5 Allegro connection (OAuth sandbox; WARN spam from #172 is harmless)
- [x] §6 Catalog pull — auto-enqueued by #171; inventory scheduler every 15 min
- [ ] §7 Category mapping — **blocked on #173** (PS side now works via #174; Allegro side needs marketplace connection selector on the page)
- [ ] §8 First offer
- [ ] §9 First order end-to-end

## Working style (user preferences, observed)

- User runs commands themselves; I guide step by step
- File issues for discovered gaps; **fix small ones in-session** (#174 was small), **file-and-ship for bigger ones** (#165, #173)
- Keep everything on single branch `152-e2e-clean-state`; one PR per session
- Never pull unrelated backend refactors into the getting-started PR

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
- PS webservice key → add `CREDENTIALS_<KEY_UPPER>=<KEY>` to BOTH `apps/api/.env.local` AND `apps/worker/.env.local` until #165 lands
- Allegro redirect URI for sandbox app: `http://localhost:5173/integrations/allegro/connect/callback`

## Resume prompt suggestion

> Resuming #152. Branch `152-e2e-clean-state` was merged in PR <NNN>. State of blockers: #165 <done/open>, #173 <done/open>. If both done, next is epic step 7 (category mapping) → 8 (first offer) → 9 (first order). See `docs/plans/resume-152.md` for full context.
