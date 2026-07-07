# Pre-Implementation Analysis: One-Command Docker Demo Environment

**Plan**: [`docs/plans/implementation-plan-docker-demo-environment.md`](../implementation-plan-docker-demo-environment.md)
**Issue**: [#1352](https://github.com/openlinker-project/openlinker/issues/1352)
**Date**: 2026-07-06

---

## Verdict: **READY**

No Critical contract-surface breaks and no reuse collisions were found. The plan touches zero CORE/Integration application code (no ports, services, DI tokens, ORM entities, DTOs, or barrels), so most of this gate's standard checklist is structurally N/A for this plan — verified below rather than assumed. Two non-blocking Warning-level items and one wording clarification are called out; none require revising the plan before implementation starts.

---

## Reuse findings

The plan's artifacts are Dockerfile stages, a compose overlay, npm scripts, and docs — not domain-layer constructs — so the standard port/service/token/ORM-entity sweep doesn't apply. Each proposed artifact was instead verified directly against the live tree (fresh `origin/main` checkout via worktree, not the analyst's possibly-stale local branch):

| Plan artifact | Classification | Evidence |
|---|---|---|
| `worker` build stage in `Dockerfile` | **NEW (confirmed absent)** | `find . -iname "Dockerfile*"` → only root `Dockerfile` exists, repo-wide; it has exactly one runtime stage (`production`), no `worker` stage. |
| `apps/web/Dockerfile` | **NEW (confirmed absent)** | Same `find` sweep — no `apps/web/Dockerfile` anywhere in the tree. |
| `apps/web/nginx.conf` | **NEW (confirmed absent)** | `find . -iname "nginx*.conf"` — zero hits repo-wide. |
| `docker-compose.demo.yml` | **NEW (confirmed absent)** | Only `docker-compose.yml` exists at repo root. One other compose file exists — `libs/integrations/woocommerce/src/infrastructure/docker/docker-compose.woocommerce.yml` — but it is an **orphaned/legacy artifact**, not a near-miss: it defines a different WooCommerce setup (image `woocommerce:6.8-php8.2-apache`, port `8081`, container names `openlinker-woocommerce`/`openlinker-woocommerce-db`) than the one actually wired into root `docker-compose.yml` today (`bitnamilegacy/wordpress:6.7.1`, port `8082`, `openlinker-woocommerce-mysql`). Nothing in `package.json` scripts or CI references this file — it appears dead. Not a collision with the plan (different concern, unreferenced), but see Open Questions. |
| `pnpm demo:up` / `demo:down` / `demo:logs` | **NEW (confirmed absent)** | `grep -rn "\"demo" package.json apps/*/package.json` — zero hits. No `Makefile` exists either. |
| README "Demo" section | **NEW (confirmed absent)** | `grep -n "^## "` against `README.md` — no heading matching "Demo" today. |
| Fix: `ksef`/`infakt` missing from Dockerfile's package-copy + dist-copy lists | **PARTIAL (extend existing)** | The `Dockerfile`'s `base`/`production` stages already have an established per-package `COPY .../package.json` + `COPY --from=base .../dist` pattern for 8 of the 10 packages both `apps/api` and `apps/worker` depend on (`ai, allegro, dpd-polska, erli, inpost, prestashop, subiekt, woocommerce`). `ksef` and `infakt` are absent from that list — confirmed via `grep -n "ksef\|infakt" Dockerfile` → no matches — while both `apps/api/package.json` and `apps/worker/package.json` declare `workspace:*` deps on both. This is a **fix to an incomplete existing pattern**, not a new pattern; Phase 0 of the plan correctly frames it this way. |

**Worker dependency list re-verified**: `apps/worker/package.json` lists exactly the same 10 `@openlinker/integrations-*` packages as `apps/api/package.json` (`ai, allegro, dpd-polska, erli, infakt, ksef, inpost, prestashop, subiekt, woocommerce`) — confirmed by direct read in this worktree. The plan's own Phase 1 wording ("the same 10 integration packages as the API plus `dpd-polska`/`inpost`/`woocommerce` already present") is **confusing, not incorrect** — those three are already part of the 10, not additional to them. See Open Questions.

---

## Backward-compat findings

No Critical items. The plan changes no top-level barrel, no port signature, no DTO shape, no `*.tokens.ts` Symbol token, and no ORM schema — confirmed by the plan's own file list (`Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`, `docker-compose.demo.yml`, `package.json` scripts block, `README.md`) touching none of `libs/core/src/**`, `libs/integrations/**/src/**`, or `apps/{api,worker}/src/**`.

`check:invariants` sweep (`package.json:29`) — none of the wired checks are triggered by this plan's file set:
- `check-cross-context-imports.mjs` — scans `libs/core/src/**`, `libs/integrations/**`, `apps/{api,worker}/**` source; this plan edits none of those.
- `check-service-interfaces.mjs` — scans `application/services/*.service.ts`; N/A.
- `check-jest-integration-mappers.mjs` — fires only when `apps/{api,worker}/src/plugins.ts` gains a new plugin entry; this plan does not touch either `plugins.ts` (it only fixes the *Docker build's* package-copy list, a separate concern from plugin registration).
- `check-migration-timestamps.mjs` — fires on new files under `apps/api/src/migrations/` or a plugin migrations dir; the plan *runs* existing migrations via a new `migrate` compose service, it does not author a new migration file.
- `check-repo-urls.mjs` — forbids stale-fork/old-slug URL substrings; the plan and its README addition should reference `openlinker-project/openlinker` only (already the case in the plan doc itself).

**Warning (non-blocking) — no `.dockerignore` exists anywhere in the repo.** The `base` stage's `COPY . .` (`Dockerfile`) currently copies the entire build context — including `.git/`, any local `.claude/`, and anything else in the working tree — into every stage that inherits from `base`. This isn't introduced by the plan, but the plan's new `apps/web/Dockerfile` build (`docker build -f apps/web/Dockerfile .`, per Phase 2) inherits the same characteristic if it also uses `.` as its context. Not a correctness blocker (multi-stage builds still produce correct output), but worth a one-line follow-up recommendation: add a root `.dockerignore` (at minimum `.git`, `node_modules`, `.claude`, `**/dist`) alongside this work, since it directly affects the build-time cost of the very stages this plan is adding.

---

## Open questions

1. **Migration-command risk (carried forward from the plan itself, not newly discovered here)**: `docs/migrations.md`'s documented production migration invocation (`node node_modules/.bin/typeorm migration:run -d apps/api/dist/apps/api/src/database/data-source.js`) has never been exercised against this repo's actual compiled output — no CI job builds the Docker image today (confirmed via `.github/workflows/ci.yml` comment: *"Dockerfile is deliberately NOT ignored: it feeds the future image build once CD is enabled"*). The plan already flags this as its highest-risk item with a documented fallback (Phase 4, Step 2) — re-flagging here only to confirm it's a genuine, verified gap (not a stale assumption) and should be the very first thing implemented/tested, before investing in the rest of the compose overlay.
2. **Worker runtime env vars are assumed, not confirmed** (carried forward from the plan): the plan assumes `apps/worker` reads the same `DB_*`/`REDIS_*` variable names as `apps/api/src/database/data-source.ts`. This wasn't independently re-verified in this pass (worker's own config-reading source wasn't re-inspected) — low risk given the consistent naming convention observed everywhere else in this codebase, but still an assumption, not a fact, until the worker container is actually booted.
3. **Minor plan wording fix recommended**: Phase 1's parenthetical about the worker's integration-package list should be corrected before an implementer copies it verbatim — the worker depends on the *same* 10 packages as the API (not "10 plus 3 more"). Cosmetic; does not change what Phase 1 needs to actually do (copy `dist/` for all 10 integration packages into the new `worker` stage).
4. **Orphaned `docker-compose.woocommerce.yml`** (`libs/integrations/woocommerce/src/infrastructure/docker/`): unreferenced, describes a WooCommerce setup that diverges from the one actually running today. Out of scope for this plan to fix, but worth a separate cleanup issue — flagging here so it isn't mistaken for an "existing demo pattern" to build on.

---

## Summary

The plan is infrastructure-only and was checked against the live `origin/main` tree in an isolated worktree: every artifact it proposes to add (`worker` Dockerfile stage, `apps/web/Dockerfile` + `nginx.conf`, `docker-compose.demo.yml`, `demo:*` npm scripts, README "Demo" section) is confirmed genuinely new with no existing implementation or near-duplicate to reuse instead, and the one "fix" it proposes (adding the missing `ksef`/`infakt` entries to the Dockerfile's package-copy lists) is correctly framed as completing an existing pattern rather than inventing a new one. No Critical contract-surface breaks apply because the plan never touches a port, service interface, DI token, DTO, or ORM entity, and a full sweep of the repo's `check:invariants` gates confirms none of them fire on this file set. Two non-blocking Warnings were surfaced (missing `.dockerignore` repo-wide; an unrelated orphaned WooCommerce compose file that could confuse a future reader) plus one wording clarification in the plan's own Phase 1 — none block starting implementation. **Verdict: READY.**
