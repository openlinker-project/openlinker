# Implementation Plan — #399 AI provider settings admin UI

## 1. Goal

Build the admin-only frontend for `/ai-provider-settings` (BE merged in #402). Admins can view the current key-resolution status, paste a new API key (PUT), or clear the stored key (DELETE). Mirrors the existing `prompt-templates` feature slice for structure and the connections / content pages for form patterns.

**Layer**: Frontend (`features/ai-provider-settings/`, `pages/ai-provider-settings/`, `app/`).

**Non-goals**:
- Multi-provider selection UI (BE only ships `anthropic` for v1).
- Key rotation history / audit trail (BE doesn't expose one).
- Editing `OL_AI_PROVIDER` from the UI (deploy-time config).

## 2. Codebase research

### Precedent
- Feature slice layout: `apps/web/src/features/prompt-templates/` — `api/`, `hooks/`, ~~`components/`~~ (prompt-templates is read/list-heavy and keeps components in `pages/`; this feature has a form so we'll use `components/` as documented in `.claude/rules/fe-pages.md`).
- API client registration: `apps/web/src/app/api/api-client.ts:48,145` — interface entry + factory call.
- Admin gating: `apps/web/src/pages/prompt-templates/prompt-templates-list-page.tsx:79-92` — render `ErrorState` when `session.user?.role !== 'admin'`.
- Route registration: `apps/web/src/app/routes/prompt-templates-list.route.tsx` — single `RouteObject` with `path: 'ai/...'` (no leading slash).
- Nav + breadcrumb: `apps/web/src/app/app-shell.tsx:110-116` (AI group, admin-only) and `:131-150` (`staticCrumbs`).

### Shared UI inventory (already present)
`PageLayout`, `LoadingState`/`ErrorState`/`EmptyState` (from `feedback-state`), `StatusBadge`, `Chip`, `KeyValueList`, `Button`, `Input`, `FormField`, `FieldError`, `FormErrorSummary`, `Alert`, `ConfirmDialog`, `ToastProvider`/`useToast`. Nothing new to add to `shared/`.

### BE contract (#402)
```
GET    /ai-provider-settings → 200 { provider, configured, source }
PUT    /ai-provider-settings   body { apiKey } → 204
DELETE /ai-provider-settings → 204
- 400 when active provider doesn't take a key (e.g. fake)
- 400 on apiKey validation failure (server trims first)
- 403 for non-admin
```
Response shape comes from `apps/api/src/ai/http/dto/ai-provider-settings-response.dto.ts`.

## 3. Design

### Feature slice
```
apps/web/src/features/ai-provider-settings/
├── api/
│   ├── ai-provider-settings.api.ts          # request factory
│   ├── ai-provider-settings.query-keys.ts   # key factory
│   └── ai-provider-settings.types.ts        # FE-local wire types
├── hooks/
│   ├── use-ai-provider-settings-query.ts
│   └── use-ai-provider-settings-mutations.ts  # update + clear
└── components/
    ├── ai-provider-status-card.tsx
    ├── ai-provider-status-card.test.tsx
    ├── ai-provider-settings-form.tsx
    ├── ai-provider-settings-form.test.tsx
    └── ai-provider-settings-form.schema.ts
```

### Page composition (`apps/web/src/pages/ai-provider-settings/`)
- One `ai-provider-settings-page.tsx` with `PageLayout` wrapping a `<section>` for the status card and a `<section>` for the form.
- Loading → Error → admin-gate → success states per `.claude/rules/fe-pages.md`.

### Status card (read side)
- Shows `provider` (monospace), `configured` (green check ✓ / muted dash), and a `Chip` for `source` with three tones:
  - `source=db` → `success` chip "Stored encrypted"
  - `source=env` → `warning` chip "Env fallback (deprecated)" + helper "Save a key here to override the env."
  - `source=none` → `neutral` chip "Not configured" + helper "Paste an API key below to enable AI suggestions."
- Plus a fourth visual case driven purely from `provider === 'fake'`: render an info alert "Active provider is `fake` — no API key required" and *hide* the form section entirely (the BE returns 400 on PUT/DELETE; gating in the UI avoids the round-trip).

### Form (write side)
- Single `apiKey` field (`<Input type="password" autoComplete="off">`).
- Zod schema: `z.string().trim().min(8, 'API key must be at least 8 characters').max(512, 'API key is too long')`.
- Submit → `useUpdateAiProviderSettingsMutation`. On success: toast "Key saved", reset form, query invalidates → status card refetches.
- "Clear stored key" button (only rendered when `source === 'db'`) → `ConfirmDialog` ("Remove the stored API key? Falls back to the environment variable or 'not configured'.") → `useClearAiProviderSettingsMutation`. On success: toast "Key cleared".
- API errors surfaced in `<Alert tone="error">` at form top (DTO validation errors from server, plus the 400 "not applicable" case as a defense-in-depth — though the form is hidden when `provider === 'fake'`).

### Mutations
- `useUpdateAiProviderSettingsMutation` — invalidates `aiProviderSettingsQueryKeys.all` on success.
- `useClearAiProviderSettingsMutation` — same invalidation.

### Route
- Path: `ai/provider-settings` (matches `frontend-architecture.md` initial route convention; the BE is at `/ai-provider-settings` which the api client adapter handles).
- Sibling to `ai/prompt-templates` under the AI nav group.
- Route element: `<AiProviderSettingsPage />`.

### Nav + breadcrumbs
- Add `{ to: '/ai/provider-settings', label: 'Provider settings' }` to the existing AI group at `app-shell.tsx:114` (only mounts for admins via the existing `isAdmin` guard).
- Add `'/ai/provider-settings': { group: 'AI', title: 'Provider settings' }` to `staticCrumbs`.

## 4. Step-by-step

| # | File | What |
|---|---|---|
| 1 | `apps/web/src/features/ai-provider-settings/api/ai-provider-settings.types.ts` | Wire types: `AiProvider` (`'anthropic' \| 'fake'` as `as const`), `AiProviderKeySource` (`'db' \| 'env' \| 'none'` as `as const`), `AiProviderSettingsView`, `UpdateAiProviderSettingsInput`. |
| 2 | `apps/web/src/features/ai-provider-settings/api/ai-provider-settings.query-keys.ts` | `aiProviderSettingsQueryKeys = { all, current() }`. |
| 3 | `apps/web/src/features/ai-provider-settings/api/ai-provider-settings.api.ts` | `AiProviderSettingsApi` interface + `createAiProviderSettingsApi(request)`. Three methods: `get`, `update`, `clear`. The `clear` method ignores the 204 by typing `Promise<void>`. |
| 4 | `apps/web/src/app/api/api-client.ts` | Add `aiProviderSettings: AiProviderSettingsApi` to `ApiClient` interface; register `createAiProviderSettingsApi(request)` in the factory. |
| 5 | `apps/web/src/test/test-utils.tsx` | Add `aiProviderSettings` to `DeepPartialApiClient` and to the `createMockApiClient` defaults: `get` returns `{ provider: 'anthropic', configured: false, source: 'none' }`, `update` / `clear` return `undefined`. |
| 6 | `apps/web/src/features/ai-provider-settings/hooks/use-ai-provider-settings-query.ts` | TanStack Query hook keyed by `aiProviderSettingsQueryKeys.current()`. |
| 7 | `apps/web/src/features/ai-provider-settings/hooks/use-ai-provider-settings-mutations.ts` | `useUpdateAiProviderSettingsMutation` + `useClearAiProviderSettingsMutation`. Both invalidate `aiProviderSettingsQueryKeys.all`. |
| 8 | `apps/web/src/features/ai-provider-settings/components/ai-provider-status-card.tsx` | Stateless presentation. Takes `view: AiProviderSettingsView`. Renders `KeyValueList` rows + the source `Chip` with tone mapping. |
| 9 | `apps/web/src/features/ai-provider-settings/components/ai-provider-status-card.test.tsx` | Snapshot the three source variants (`db` / `env` / `none`) and the `provider=fake` case. |
| 10 | `apps/web/src/features/ai-provider-settings/components/ai-provider-settings-form.schema.ts` | Zod schema + `FormValues` / `FormSubmission` types. Trim + min(8) + max(512). |
| 11 | `apps/web/src/features/ai-provider-settings/components/ai-provider-settings-form.tsx` | RHF form. Props: `currentSource: AiProviderKeySource`. Renders `<Input type="password">`, `Save` + (conditional) `Clear stored key` button. Toasts + Alert on error. `noValidate`. |
| 12 | `apps/web/src/features/ai-provider-settings/components/ai-provider-settings-form.test.tsx` | Tests: validation error on empty input; submit triggers update mutation with trimmed value; API error renders in Alert; clear button only renders when `source === 'db'`; clear flow goes through ConfirmDialog. |
| 13 | `apps/web/src/pages/ai-provider-settings/ai-provider-settings-page.tsx` | Composes `PageLayout` + `LoadingState` / `ErrorState` / status card / form. Admin gate matches the prompt-templates pattern. Hides form when `provider === 'fake'`, surfaces the info alert instead. |
| 14 | `apps/web/src/pages/ai-provider-settings/ai-provider-settings-page.test.tsx` | Tests: loading state; error state with retry; non-admin shows admin-required ErrorState; admin sees status card + form; `provider=fake` hides the form. |
| 15 | `apps/web/src/app/routes/ai-provider-settings.route.tsx` | `RouteObject` at `path: 'ai/provider-settings'`. |
| 16 | `apps/web/src/app/routes/root.route.tsx` | Import + register the new route alongside the prompt-templates routes. |
| 17 | `apps/web/src/app/app-shell.tsx` | Add nav entry under AI group + breadcrumb entry. |

## 5. Risks / open questions

- **`source: 'env'` semantics on initial pageload**: GET returns `source=env` if BE successfully resolves the env var. The FE warns "deprecated, save here to override". Behaviour after a successful PUT — server reports `source=db` (the new key takes precedence). Test coverage exercises both.
- **Concurrent admins**: Two PUTs racing → last write wins. The status card refetches after each mutation, so the displayed state converges. Acceptable for a low-concurrency admin endpoint (matches BE).
- **Toast vs Alert**: API errors go to `Alert` at form top (per `.claude/rules/fe-pages.md` — alerts for errors needing user action). Success → toast.
- **Mobile tap targets**: Form is single-column; "Save" button uses `Button` size `md` (32 px) which grows to 36 px on touch per `frontend-ui-style-guide.md`.
- **Out of scope, deliberate**: no rotation history, no per-provider switching, no copy-current-key affordance (server never returns the value).

## 6. Quality gate

```bash
pnpm lint        # all packages
pnpm type-check  # strict TS
pnpm test        # vitest unit + RTL component tests
```

All must pass with zero errors before commit. No backend changes → no migrations, no integration tests.
