# Implementation Plan: Frontend ESLint Layer Boundaries (#99)

## Goal

Enforce the frontend dependency direction (`app` → `pages` → `features` → `shared`) via ESLint rules so violations fail `pnpm lint`.

## Classification

**Frontend / DX** — `apps/web/`

## What existed before

- `shared/**` blocked from importing `features/**` or `pages/**`
- `features/**` blocked from importing `pages/**`

## Changes made

### 1. Strengthened `shared/` restriction
- Added `**/app/**` to the blocked import patterns (shared must not import app modules)

### 2. Added `pages/` restriction
- New override: `pages/**` cannot import from `**/app/**`

### 3. Added `no-restricted-globals` for `fetch`
- `shared/**`, `features/**`, and `pages/**` all block raw `fetch()` calls
- Forces use of API client modules from `shared/api`

### 4. Exempted `shared/auth/` from fetch restriction
- Session adapter (`jwt-bearer-session-adapter.ts`) is low-level auth infra that the API client itself depends on — it must use raw fetch

### 5. Documented enforcement in `docs/frontend-architecture.md`

## Files changed

- `.eslintrc.js` — added/modified ESLint overrides
- `docs/frontend-architecture.md` — updated dependency rules section

## Not in scope

- `features/` → `app/` restriction: `useApiClient()` is the designed DI boundary that all feature hooks use. Blocking this would require a larger architectural refactor (moving the API client context to shared). This can be addressed in a follow-up issue.
