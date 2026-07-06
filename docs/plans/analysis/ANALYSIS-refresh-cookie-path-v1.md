# Pre-implement Analysis — refresh-cookie-path-v1 (#1327)

**Gate run**: 2026-07-03, against worktree `1327-refresh-cookie-path-v1` @ `e6298374`.
**Plan**: `docs/plans/implementation-plan-refresh-cookie-path-v1.md`

## Verdict: READY

No Critical findings. One Warning (stale operator doc the plan doesn't touch) — fold into the
same PR; it does not require re-planning.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `REFRESH_COOKIE_PATH` (re-derive + export) | PARTIAL (extend existing) | Exists module-private at `apps/api/src/auth/auth.cookies.ts:22`; sole definition in the tree. Export is additive — the file header already declares constants as test-consumable, and `REFRESH_COOKIE_NAME` is exported from the same file as precedent. |
| `LEGACY_AUTH_COOKIE_PATH` (new const) | NEW (confirmed absent) | No existing constant names the legacy `'/auth'` scope; the #748 cleanups at `auth.cookies.ts:83,93` borrow `REFRESH_COOKIE_PATH` for it — exactly the coupling the plan unwinds. |
| `API_VERSION_LABEL` (consume) | ALREADY EXISTS → reuse | `apps/api/src/app-info/app-info.types.ts:16`; existing consumers `app-info.service.ts:17` and `main.ts` (via `API_VERSION`). No new definition needed. |
| Drift-guard unit test (`PATH_METADATA`) | NEW | No prior `PATH_METADATA` / `@nestjs/common/constants` usage in the repo — this is a first use, not a collision. Keep the plan's `'auth'` sanity guard so an undefined metadata read fails loudly. |
| Int-spec `Path=/v1/auth` assertion | PARTIAL (flip existing) | `apps/api/test/integration/auth-refresh.int-spec.ts:122` currently asserts the buggy `Path=\/auth`; the epoch-expiry filter to extend exists at `:116-118`. |

Consumer sweep (`ol_refresh` / `REFRESH_COOKIE` / `path: '/auth'` across `apps/` + `libs/`):
every hit is either `auth.cookies.ts` itself, its two spec files, `auth.controller.ts`
(name-only, no path), comment references (`main.ts:53`, `setup.ts:57`), or the FE's
`no-localstorage-jwt.test.ts` (name-only). **No hidden consumer binds to the path value.**
`csrf.guard.ts` carries no path logic.

## Backward-compat findings

| Surface | Finding | Severity |
|---|---|---|
| Top-level barrels | Not touched — change is entirely in `apps/api` (no `@openlinker/*` package surface). | — |
| Port signatures / DTOs / Symbol tokens / ORM schema | None touched; no migration needed. | — |
| Set-Cookie wire contract | `Path` attribute changes `/auth` → `/v1/auth`. Not a published contract (issue's stated assumption: no proxy/CDN pins the literal). Stale browser cookies are handled by the plan's legacy-path clears. | OK (documented assumption) |
| `check:invariants` | `auth → app-info` is a same-app relative import (`../app-info/…`, depth ≤ `../..`); no cross-context walker scope (`apps/**` walker only guards `@openlinker/core/*` deep paths). No rule fires. | — |
| **`docs/operations/auth-cookies.md`** | **Warning**: states "Both cookies share the same `Path=/auth`" (`:21-24`) — already stale post-#748 (csrf is `/`), and doubly stale after this fix. Plan does not list it. | Warning |

## Open questions

None blocking. One addition for the implementation step list: update
`docs/operations/auth-cookies.md`'s cookie-path paragraph (`:21-24`, and the `/auth/refresh`
route mentions) to the versioned reality in the same PR — it is the operator-facing statement
of exactly the contract this fix changes.
