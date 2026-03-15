# OpenLinker Web

Frontend foundation app for OpenLinker.

## Stack

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- React Hook Form + Zod
- Vitest + Testing Library

## Commands

From the repository root:

- `pnpm --filter @openlinker/web dev`
- `pnpm --filter @openlinker/web lint`
- `pnpm --filter @openlinker/web type-check`
- `pnpm --filter @openlinker/web test`
- `pnpm --filter @openlinker/web build`

## Structure

- `src/app`: app shell, providers, router, route registration
- `src/pages`: route-level pages
- `src/features`: vertical feature slices
- `src/shared`: reusable UI, config, auth, API client, shared helpers
- `src/test`: shared test setup and utilities

## Architecture

See `docs/frontend-architecture.md` for the source-of-truth conventions around:

- state ownership
- routing
- API client usage
- auth/session evolution
- env/runtime config
- dependency boundaries
