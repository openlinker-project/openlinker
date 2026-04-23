# Implementation Plan: Editable Prompt Template Storage + Admin UI (#341)

**Date**: 2026-04-23
**Status**: Approved with changes (tech-review feedback applied 2026-04-23)
**Estimated Effort**: ~10–12 hours (core + api + web + migration + seed + tests)

**Revision log (tech-review feedback applied)**:
- Post-review polish (2026-04-23):
  - Seed migration carries an explicit header note that it runs after the DDL migration in timestamp order.
  - Fixture-purity guard shipped as `scripts/check-fixture-purity.sh` + drift guard as `scripts/check-render-template-fixture-drift.mjs`; wired into `pnpm lint` via a new `check:invariants` root script.
  - Controller's `GET /prompt-templates/latest` now carries an inline comment explaining why it bypasses `withDomainExceptionMapping` (service returns null rather than throwing for the legitimate "no published version yet" state).
  - Plan text updated to reflect that the version history uses a custom inline list (no `Timeline` primitive exists in `shared/ui/` yet) rather than a non-existent primitive.
- API-side NestJS module renamed `ai-api.module.ts` → `ai.module.ts` with class `AiApiModule`; core module is imported under `AiModule as CoreAiModule` to match `apps/api/src/products/products.module.ts`.
- Removed the pass-through `renderTemplateValue` from `IPromptTemplateService`. The service exposes `render(cmd)` and a new `renderById(id, variables)`; the controller's `POST /:id/render` calls `renderById` — no pure-helper leakage through the port.
- Responsive behaviour for the detail editor now explicit: below 1024 px the detail page is read-only with an "Open on desktop to edit" affordance (per `frontend-ui-style-guide.md` §Responsive). List page falls back to card view below 768 px.
- FE/BE render-helper fixture sharing mechanism specified: fixtures live at `libs/core/src/ai/application/internal/render-template.fixtures.ts` as pure data (no NestJS imports), consumed by both the core spec and the FE spec via the existing `@openlinker/core/*` alias. A CI grep asserts the fixtures file has no framework imports.
- `PromptTemplateSummary.latestId` added so the list row-click has a deterministic target.
- `publishTransition(id)` owns its own `(key, channel)` lookup — service just passes the id.
- `publish` / `revert` logs specified to carry `{ templateId, key, channel, version, actor }`.
- DTOs for `systemPrompt` / `userPromptTemplate` carry `@MaxLength(65536)`.
- Seed migration drops the speculative `ON CONFLICT DO NOTHING` — TypeORM's migrations table prevents re-runs.
- Controller coverage provided by the integration test in Step 18; no separate unit spec (controller has zero non-plumbing logic).
- Version-history panel explicitly uses the `Timeline` primitive.
- FE render helper location corrected to `features/prompt-templates/lib/` (not `api/`).
- File-header acceptance criterion added to §7.

**Issue**: [#341 feat(core+web): editable prompt template storage and admin UI](https://github.com/SilkSoftwareHouse/openlinker/issues/341)

**Epic**: [#6 Content & AI](https://github.com/SilkSoftwareHouse/openlinker/issues/6)

**Depends on**: #338/#340 (foundation merged via #350) — reuses the `libs/core/src/ai/` bounded context.
**Blocks**: #342 (AI description suggestion flow will call `PromptTemplateService.render`).

---

## 1. Task Summary

**Objective**: Lay down CRUD + versioning + render for prompt templates so prompts become *content, not code*. Operators must be able to edit and publish prompt revisions through an admin UI without a deploy, and downstream services (#342) must be able to resolve the latest published prompt for a given `(key, channel)` pair and render it with runtime variables.

The prompt contract stays deliberately small: plain `{{variable}}` substitution, no templating engine, no partials, no conditionals. Declared variables are authoritative; missing required declared variables fail fast; undeclared placeholders in the template pass through as literal text (so a template author mistyping `{{foo}}` renders that token verbatim rather than silently blanking it).

**Classification**: **CORE (domain + application)** + **Infrastructure (persistence)** + **Interface (API controller + React admin UI)**. No new external integrations — the AI SDK wiring from #340 is not touched.

---

## 2. Scope & Non-Goals

### In Scope

#### Domain + storage (core)
- Extend `libs/core/src/ai/` bounded context:
  - Domain entity `PromptTemplate`.
  - Types in `prompt-template.types.ts`: `PromptTemplateStateValues` / `PromptTemplateState` (`draft | published | archived`), `PromptTemplateChannelValues` / `PromptTemplateChannel` (`prestashop | allegro`), `PromptTemplateVariableTypeValues` / `PromptTemplateVariableType` (`string | number | object | array`), `PromptTemplateVariable`.
  - Port `PromptTemplateRepositoryPort` (persistence contract).
  - Exceptions: `PromptTemplateNotFoundException`, `PromptTemplateRenderException`, `PromptTemplateStateException` (invalid publish / update on non-draft).
- Application layer (new `libs/core/src/ai/application/`):
  - Service interface `IPromptTemplateService` + implementation `PromptTemplateService`.
  - Internal helper `renderTemplate(template, variables, declaredVariables)` — pure, framework-free function doing `{{dotted.path}}` substitution + declared-variable enforcement. Exported so the FE shares the algorithm for the preview pane.
  - Command / query types (`CreateDraftCommand`, `UpdateDraftCommand`, `RenderCommand`, `RenderedPrompt`, `PromptTemplateSummary`).
- New NestJS module `AiModule` in `libs/core/src/ai/ai.module.ts` wiring the ORM entity, repository, and service. The existing `AiIntegrationModule` (adapter package) stays separate — this module owns *core* providers only.
- Infrastructure:
  - ORM entity `PromptTemplateOrmEntity`.
  - TypeORM repository `PromptTemplateRepository implements PromptTemplateRepositoryPort`.
  - Migration `1790000000000-add-prompt-templates-table.ts` with reversible `down()`.
  - Seed migration `1790000000001-seed-prompt-templates.ts` inserting two published v1 templates: `offer.description.suggest` / `prestashop` and `offer.description.suggest` / `allegro`.

#### API (apps/api)
- New module `apps/api/src/ai/ai.module.ts` (class `AiApiModule`) registering `PromptTemplatesController`. Imports the core module via `import { AiModule as CoreAiModule } from '@openlinker/core/ai'`, mirroring `apps/api/src/products/products.module.ts`.
- Controller `apps/api/src/ai/http/prompt-templates.controller.ts` — admin-only (`@Roles('admin')` on every handler), JWT-guarded through the existing global `JwtAuthGuard`:
  - `GET /prompt-templates` — list "latest per `(key, channel)`" summaries with draft/publish indicators; query params `key?`, `channel?`.
  - `GET /prompt-templates/:id` — fetch a single template by UUID.
  - `GET /prompt-templates/latest?key=&channel=` — latest published for a `(key, channel)` pair.
  - `GET /prompt-templates/versions?key=&channel=` — full version history (newest first).
  - `POST /prompt-templates` — create new draft (starts a new version for that `(key, channel)`).
  - `PATCH /prompt-templates/:id` — update a draft (400 if state is not `draft`).
  - `POST /prompt-templates/:id/publish` — publish the draft, archiving the previously published version atomically.
  - `POST /prompt-templates/revert` — body `{ key, channel, version }`; creates a new draft whose content is cloned from the specified historical version.
  - `POST /prompt-templates/:id/render` — preview convenience; body `{ variables }`; returns `{ systemPrompt, userPrompt }` and is used by the admin UI's preview pane to guarantee parity with the server algorithm.
- Request / response DTOs with `class-validator` + `@nestjs/swagger` annotations, matching the style used in `apps/api/src/integrations/http/connection.controller.ts`.

#### Admin UI (apps/web)
- Feature module `apps/web/src/features/prompt-templates/` with `api/`, `hooks/`, `lib/` (pure utilities, including the FE copy of `renderTemplate`), `components/`.
- Pages:
  - `apps/web/src/pages/prompt-templates/prompt-templates-list-page.tsx` (`/settings/prompt-templates`).
  - `apps/web/src/pages/prompt-templates/prompt-template-detail-page.tsx` (`/settings/prompt-templates/:id`).
- List view: `DataTable` of `(key, channel, current published version, draft indicator, last updated)` rows.
- Detail / edit view:
  - Header with `key`, `channel`, current state, version.
  - System-prompt textarea + user-prompt textarea.
  - Declared-variables editor (add / remove / mark required).
  - Preview pane (renders with sample values; client-side via the FE copy of the shared `renderTemplate` util — same fixtures exercise both implementations).
  - Actions: **Save draft**, **Publish**, **Revert to v…**.
  - Version-history panel using the existing `Timeline` primitive (not a new component) — clicking a row loads that version in a read-only split view.
- Admin gating on FE:
  - Hide the `Prompt templates` link from `SettingsPage` and the settings nav when `session.user.role !== 'admin'`.
  - In each prompt-template page, render `<ErrorState>` with message "Admin role required" when the session role is not `admin`. (Backend still enforces 403 — this is UX only.)
- **Responsive**:
  - Desktop (≥ 1024 px): two-column grid (editor 65 % / history 35 %).
  - Tablet (768–1023 px): single column, history below editor, still fully editable.
  - Mobile (≤ 767 px): list uses card view; detail page is **read-only** with an inline `Alert` affordance: *"Editing prompt templates requires a larger screen. Open this page on a desktop to make changes."* Save/Publish/Discard/Revert are hidden. History stays visible.

#### Tests
- Unit tests:
  - `render-template.spec.ts` (core): happy path, dotted-path access, missing required declared variable → throws, optional missing → empty string, undeclared `{{foo}}` passthrough, nested values, type coercion.
  - `prompt-template.service.spec.ts` (core): list, getById, createDraft assigns next version, updateDraft rejects on non-draft, publish transitions previous published → archived, publish sets `publishedAt`, revertTo clones content into new draft, render resolves latest published and fails fast on missing required var.
- Integration test `apps/api/test/integration/prompt-templates-crud.int-spec.ts`: full lifecycle — create draft → update draft → publish → create second draft → publish (asserts previous becomes archived and only one `published` per `(key, channel)`) → revertTo.
- Frontend tests (Vitest + Testing Library):
  - List page: loading / error / empty / happy (mock API via `createMockApiClient`).
  - Detail page: loading / error / edit-then-save / publish / revert / non-admin blocked state.
  - `render-template.test.ts` (FE) mirroring the core spec — catches FE/BE algorithm drift.

### Out of Scope (deferred)
- Templating engines beyond `{{variable}}` substitution (Mustache/Handlebars). If conditional logic becomes needed, escalate and add an explicit design note before adopting a library.
- A/B testing or per-user template variants.
- Generic "library of templates" UI: the `prompt_templates` table supports arbitrary `key` values, but only `offer.description.suggest` is seeded and surfaced. New keys can be created via API by an admin, but the list view is unfiltered — a future issue can add key-management ergonomics if more keys appear.
- Export/import of templates across environments — future CLI tool.
- `ContentSuggestionService` and the "Suggest description" button wiring — that is #342.
- Multi-tenant / per-workspace templates.
- Model / temperature / max-tokens overrides per template — the `AiCompletionInput` optional fields cover this, but the editor only stores prompt content in this PR. Parameters can be added as structured columns later without breaking the current shape.

### Constraints
- No `any`. No `console.log`. No framework imports in `libs/core/src/**/domain/`.
- All new DB tables use `gen_random_uuid()` for PKs (PG ≥ 13, same pattern as `product_content_field`).
- Unique constraints that span the nullable `channel` column use the Postgres partial-index idiom already established in `product_content_field` (`WHERE channel IS NULL` / `WHERE channel IS NOT NULL`).
- The FE preview renderer and the core render function must produce identical output for identical input. The core helper is exported; the FE imports it through `@openlinker/core/ai` so there is literally one implementation. Shared FE/BE test vectors prevent drift.
- All new API endpoints carry `@Roles('admin')`. A non-admin receives HTTP 403 (enforced by `RolesGuard`).
- Migration must have a reversible `down()`.
- `pnpm lint && pnpm type-check && pnpm test` must be clean before commit.

---

## 3. Research Summary

### Existing patterns located

| Concern | File / Path |
|---|---|
| Bounded-context baseline (domain/app/infra layout) | `libs/core/src/content/` — ORM entity + partial indexes, upsert pattern, Symbol-token DI, `ContentDraftService` with separate `.interface.ts` |
| AI bounded context (where new code lands) | `libs/core/src/ai/` — currently only port + types + exceptions; we add `application/`, `infrastructure/`, `ai.module.ts`, new tokens |
| Symbol-token DI pattern | `libs/core/src/content/content.tokens.ts`, `libs/core/src/content/content.module.ts` (`provide: TOKEN, useExisting: ConcreteClass`) |
| Service-interface separation | `libs/core/src/content/application/services/content-draft.service.{interface.ts,ts}` |
| Repository port + TypeORM repo | `libs/core/src/content/domain/ports/product-content-field-repository.port.ts` + `libs/core/src/content/infrastructure/persistence/repositories/product-content-field.repository.ts` |
| Nullable-column unique idiom | `apps/api/src/migrations/1789000000000-add-product-content-field-table.ts` — two partial unique indexes covering `connection_id IS NULL` and `connection_id IS NOT NULL`. Apply the same pattern for `channel` in `prompt_templates` |
| Migration folder + timestamp convention | `apps/api/src/migrations/` — latest is `1789000000000`; next slot is `1790000000000` (DDL) and `1790000000001` (seed) |
| Integration-harness TRUNCATE list | `apps/api/test/integration/setup.ts:122-132` — we add `prompt_templates` |
| Admin-gated controller | `apps/api/src/integrations/http/connection.controller.ts` — `@Roles('admin')` per handler, `@ApiBearerAuth` at class level |
| `RolesGuard` / `UserRole` | `apps/api/src/auth/guards/roles.guard.ts`, `libs/core/src/users/domain/types/role.types.ts` (`admin` \| `viewer`) |
| API-module composition | `apps/api/src/products/products.module.ts` — imports core module, registers controllers only |
| `AppModule` registration | `apps/api/src/app.module.ts` — import new `AiModule` (core) + new `AiApiModule` (api) |
| FE feature-module layout | `apps/web/src/features/cursors/` (api, hooks, types, query-keys) |
| FE page pattern + states | `apps/web/src/pages/cursors/cursors-list-page.tsx`, `/app/routes/*.route.tsx` |
| Top-level route registration | `apps/web/src/app/routes/root.route.tsx` (children array); `apps/web/src/app/router.tsx` |
| Session + role | `apps/web/src/shared/auth/use-session.ts` → `session.user.role` returns the `UserRole` string |
| API client plumbing | `apps/web/src/app/api/api-client.ts` — `createXxxApi(request)` + `ApiClient` composite |

### What this unlocks
- `PromptTemplateService.render(key, channel, vars)` becomes the single entry point for #342's `ContentSuggestionService` → feeds `AiCompletionPort.complete({ systemPrompt, userPrompt, cacheSystemPrompt: true })`.
- Templates become editable at runtime: prompts are content, not code, and the business can tune them without a deploy.

### Dependencies added
- None. Everything is existing stack (NestJS, TypeORM, React, Vitest, Zod, React Hook Form).

---

## 4. Architecture Mapping

```
┌───────────────────────────────────────────────────────────────────────┐
│  Interface (apps/web)                                                 │
│  /settings/prompt-templates       list & detail pages (admin-only)    │
│  features/prompt-templates/api    API client + query-keys             │
│  features/prompt-templates/hooks  useQuery / useMutation              │
│                                                                        │
│  Interface (apps/api/src/ai/http)                                     │
│  PromptTemplatesController        REST endpoints + DTOs (admin-only)  │
└───────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Application (libs/core/src/ai/application)                           │
│  IPromptTemplateService ← PromptTemplateService                       │
│  renderTemplate (pure helper; shared with FE preview pane)            │
└───────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Domain (libs/core/src/ai/domain)                                     │
│  PromptTemplate entity + types + exceptions                           │
│  PromptTemplateRepositoryPort                                         │
└───────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Infrastructure (libs/core/src/ai/infrastructure + apps/api/migrations)│
│  PromptTemplateOrmEntity                                              │
│  PromptTemplateRepository (TypeORM)                                   │
│  1790_add-prompt-templates-table (DDL)                                │
│  1790_seed-prompt-templates (INSERT seeded v1 rows)                   │
└───────────────────────────────────────────────────────────────────────┘
```

Dependency direction: `interfaces → application → domain`; `infrastructure → domain` (never the other way).

---

## 5. Data Model

### Table `prompt_templates`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | `DEFAULT gen_random_uuid()` — primary key |
| `key` | TEXT | no | Stable identifier, e.g. `offer.description.suggest` |
| `channel` | TEXT | **yes** | One of `prestashop` \| `allegro` \| NULL (generic / master) |
| `version` | INT | no | Monotonic per `(key, channel)`, starts at 1 |
| `system_prompt` | TEXT | no | Sent to the model as `system`. Cache-friendly |
| `user_prompt_template` | TEXT | no | Sent to the model as `user`; contains `{{variable}}` placeholders |
| `variables` | JSONB | no | `[{ name: string; type: 'string'\|'number'\|'object'\|'array'; required: boolean; description?: string }]` |
| `state` | TEXT | no | `draft` \| `published` \| `archived`; enforced by CHECK constraint |
| `published_at` | TIMESTAMPTZ | yes | Set when transitioning into `published` |
| `created_by` | TEXT | yes | Username (from `AuthenticatedUser.username`) |
| `created_at` | TIMESTAMPTZ | no | `DEFAULT now()` |
| `updated_at` | TIMESTAMPTZ | no | `DEFAULT now()`; bumped on every UPDATE |

### Indexes

- `ux_prompt_templates_kcv_master` UNIQUE `(key, version) WHERE channel IS NULL` — enforces version uniqueness for generic templates.
- `ux_prompt_templates_kcv_channel` UNIQUE `(key, channel, version) WHERE channel IS NOT NULL` — version uniqueness per channel.
- `ux_prompt_templates_published_master` UNIQUE `(key) WHERE channel IS NULL AND state = 'published'` — at most one published generic per key.
- `ux_prompt_templates_published_channel` UNIQUE `(key, channel) WHERE channel IS NOT NULL AND state = 'published'` — at most one published channel row per `(key, channel)`.
- `ix_prompt_templates_key_channel` NON-UNIQUE `(key, channel, state)` — list + version-history scan.

### Publish algorithm (service layer, wrapped in a DB transaction)
```
BEGIN
  SELECT current published row for (key, channel) FOR UPDATE
  UPDATE that row → state = 'archived'  (if any)
  UPDATE target draft  → state = 'published', published_at = now()
COMMIT
```
The partial-unique index on `(key, [channel], state='published')` guarantees at most one published row even under concurrent publishes; the transaction + row lock make the transition deterministic.

### Revert algorithm (service layer)
1. Load target historical row by `(key, channel, version)`.
2. `nextVersion = max(version) + 1`.
3. INSERT new row: `state='draft'`, `version=nextVersion`, content cloned from the historical row, `created_by=currentUser`.

No state on the source row changes — revert is additive.

### ID generation
Templates use TypeORM-assigned UUIDs. They are **not** part of the OpenLinker internal-id-mapping scheme (`ol_*`) because they are not cross-platform entities and are never exported to external systems.

---

## 6. Step-by-Step Implementation Plan

> Each step states the file(s) touched and the acceptance criteria. Steps should be completed in order; lint/type-check/tests after every logical group.

### 6.1 Core domain (libs/core/src/ai/domain)

**Step 1 — Types.** Create `libs/core/src/ai/domain/types/prompt-template.types.ts` exporting:
- `PromptTemplateStateValues` (`['draft','published','archived'] as const`), `PromptTemplateState`.
- `PromptTemplateChannelValues` (`['prestashop','allegro'] as const`), `PromptTemplateChannel`.
- `PromptTemplateVariableTypeValues`, `PromptTemplateVariableType`.
- `PromptTemplateVariable` interface.

**Acceptance**: file compiles standalone; no framework imports.

**Step 2 — Entity.** Create `libs/core/src/ai/domain/entities/prompt-template.entity.ts` exporting `class PromptTemplate` with readonly constructor fields matching the data model.

**Acceptance**: plain class, no decorators, no framework imports.

**Step 3 — Repository port.** Create `libs/core/src/ai/domain/ports/prompt-template-repository.port.ts` exporting `PromptTemplateRepositoryPort` and the insert/update payload types. Methods: `findById`, `findByKeyChannelVersion`, `findLatestPublished`, `findVersions`, `listLatestByKey(filters)`, `insert`, `updateContent`, `publishTransition`, `nextVersion`.

**Acceptance**: port exposes only domain-level shapes; no TypeORM types leak.

**Step 4 — Exceptions.** Add three exception classes under `libs/core/src/ai/domain/exceptions/`:
- `prompt-template-not-found.exception.ts` — thrown by service when id/key lookup misses.
- `prompt-template-render.exception.ts` — thrown by `renderTemplate` when a required declared variable is absent from the supplied variable map.
- `prompt-template-state.exception.ts` — thrown when caller tries to update a non-draft or publish something already archived.

**Acceptance**: each extends `Error`, sets `this.name`, carries structured context fields (e.g. `templateId`, `missingVariableName`).

### 6.2 Application layer (libs/core/src/ai/application)

**Step 5 — Command / query types.** Create `libs/core/src/ai/application/types/prompt-template-commands.types.ts` with:
- `CreateDraftCommand` (`key`, `channel`, `systemPrompt`, `userPromptTemplate`, `variables`, `createdBy`).
- `UpdateDraftCommand` (`systemPrompt?`, `userPromptTemplate?`, `variables?`).
- `RevertToCommand` (`key`, `channel`, `version`, `createdBy`).
- `RenderCommand` (`key`, `channel`, `variables: Record<string, unknown>`).
- `RenderedPrompt` (`systemPrompt`, `userPrompt`).
- `PromptTemplateSummary` (`key`, `channel`, `latestVersion`, `latestId`, `publishedVersion`, `publishedId`, `hasDraft`, `updatedAt`). `latestId` is the target of a list row-click — draft id when `hasDraft=true`, else the published id, else the newest row id.

**Acceptance**: pure type module.

**Step 6 — Render helper.** Create `libs/core/src/ai/application/internal/render-template.ts` with:
```ts
export function renderTemplate(args: {
  template: string;
  declared: readonly PromptTemplateVariable[];
  values: Record<string, unknown>;
}): string;
```
Behaviour:
- Scans template for `{{dotted.path}}` occurrences (regex `/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g`).
- For each occurrence:
  - If the path is in `declared` and required and the resolved value is `undefined` → throw `PromptTemplateRenderException`.
  - If declared and optional and missing → substitute empty string.
  - If not declared → leave the literal `{{foo}}` in place (passthrough).
- Resolution uses dotted-path access over `values`. Objects/arrays are JSON-stringified for substitution (`type: 'object' | 'array'` hints drive the serialisation).

**Acceptance**: fully unit-tested (Step 16). Pure, no NestJS imports.

**Step 7 — Service interface.** Create `libs/core/src/ai/application/services/prompt-template.service.interface.ts` exporting `IPromptTemplateService`:
```ts
interface IPromptTemplateService {
  listLatestByKey(filters?: { key?: string; channel?: PromptTemplateChannel | null }): Promise<PromptTemplateSummary[]>;
  getById(id: string): Promise<PromptTemplate>;
  getVersions(key: string, channel: PromptTemplateChannel | null): Promise<PromptTemplate[]>;
  getLatestPublished(key: string, channel: PromptTemplateChannel | null): Promise<PromptTemplate | null>;
  createDraft(cmd: CreateDraftCommand): Promise<PromptTemplate>;
  updateDraft(id: string, cmd: UpdateDraftCommand): Promise<PromptTemplate>;
  publish(id: string): Promise<PromptTemplate>;
  revertTo(cmd: RevertToCommand): Promise<PromptTemplate>;
  render(cmd: RenderCommand): Promise<RenderedPrompt>;                 // resolves latest published by (key, channel) and renders
  renderById(id: string, values: Record<string, unknown>): Promise<RenderedPrompt>; // loads by id then renders — drives POST /:id/render
}
```
`renderTemplate` stays a pure helper in `application/internal/` and is consumed by the service (and by the FE copy for the preview pane). The service does not re-export it.

**Acceptance**: interface-only file, no implementation.

**Step 8 — Service implementation.** Create `libs/core/src/ai/application/services/prompt-template.service.ts`:
- `@Injectable()`, injects `@Inject(PROMPT_TEMPLATE_REPOSITORY_TOKEN)` port.
- `createDraft`: resolves `nextVersion`, inserts with `state='draft'`.
- `updateDraft`: loads by id; throws `PromptTemplateStateException` if `state !== 'draft'`; delegates to `repository.updateContent(...)`.
- `publish`: throws if template not found or not in `draft`; calls `repository.publishTransition(id)` which does the two-row transaction (archive previous published, flip draft → published). Returns the freshly-published row.
- `revertTo`: loads source by `(key, channel, version)`; throws `PromptTemplateNotFoundException` if missing; `nextVersion` + insert draft clone.
- `render`: `getLatestPublished(key, channel)` → throws `PromptTemplateNotFoundException` if null → renders both prompts via the helper.
- `renderById`: loads by id, throws `PromptTemplateNotFoundException` if missing, renders both prompts via the helper.
- Uses `Logger` from `@openlinker/shared/logging` for publish / revert events with structured fields: `{ templateId, key, channel, version, actor }` (actor is the authenticated username forwarded from the controller; `null` when called from a background path).

**Acceptance**: every branch covered by unit tests in Step 17.

### 6.3 Infrastructure (libs/core/src/ai/infrastructure)

**Step 9 — ORM entity.** Create `libs/core/src/ai/infrastructure/persistence/entities/prompt-template.orm-entity.ts` mapping `prompt_templates`. Declare the partial unique indexes via `@Index('ux_...', [...], { unique: true, where: '...' })` — mirror the `product-content-field.orm-entity.ts` pattern so `synchronize: true` (integration-test harness) reproduces them.

**Acceptance**: ORM entity reachable via `libs/core/src/**/*.orm-entity.ts` glob and auto-registered by the data source.

**Step 10 — Repository.** Create `libs/core/src/ai/infrastructure/persistence/repositories/prompt-template.repository.ts` implementing `PromptTemplateRepositoryPort`:
- `insert` / `updateContent` use standard `Repository<T>` methods.
- `publishTransition(id)` is self-contained — the service passes only the id; the repository looks up the target row's `(key, channel)` inside the transaction, archives any existing published row for that pair, and flips the target to `published`. Wraps the two statements in `this.ormRepository.manager.transaction(...)`:
  1. `SELECT id, key, channel FROM prompt_templates WHERE id = $1 AND state = 'draft' FOR UPDATE` — throws `PromptTemplateStateException` if no row or state is not `draft`.
  2. `UPDATE prompt_templates SET state='archived' WHERE key=$2 AND channel IS NOT DISTINCT FROM $3 AND state='published' AND id <> $1`
  3. `UPDATE prompt_templates SET state='published', published_at=now() WHERE id=$1 AND state='draft' RETURNING *`
  - Uses `IS NOT DISTINCT FROM` so a NULL channel compares equal to NULL.
- `nextVersion(key, channel)` — `SELECT COALESCE(MAX(version), 0) + 1 FROM prompt_templates WHERE key=$1 AND channel IS NOT DISTINCT FROM $2`.
- `listLatestByKey` — one row per `(key, channel)` aggregating the most-recent version, published version, and a boolean for "has a draft more recent than the published version". Also returns the `latestId` / `publishedId` used by the list UI.
- Private `toDomain(row)` mapper.
- Catch `QueryFailedError` from `publishTransition` when the partial unique index fires and wrap into `PromptTemplateStateException` (e.g. concurrent double-publish).

**Acceptance**: all repository methods covered by the integration test (Step 18).

### 6.4 Core module wiring

**Step 11 — Tokens + module.**
- Extend `libs/core/src/ai/ai.tokens.ts` to export `PROMPT_TEMPLATE_REPOSITORY_TOKEN` and `PROMPT_TEMPLATE_SERVICE_TOKEN`.
- Create `libs/core/src/ai/ai.module.ts`:
  ```ts
  @Module({
    imports: [TypeOrmModule.forFeature([PromptTemplateOrmEntity])],
    providers: [
      PromptTemplateRepository,
      PromptTemplateService,
      { provide: PROMPT_TEMPLATE_REPOSITORY_TOKEN, useExisting: PromptTemplateRepository },
      { provide: PROMPT_TEMPLATE_SERVICE_TOKEN, useExisting: PromptTemplateService },
    ],
    exports: [PROMPT_TEMPLATE_REPOSITORY_TOKEN, PROMPT_TEMPLATE_SERVICE_TOKEN],
  })
  export class AiModule {}
  ```
- Update `libs/core/src/ai/index.ts` to export the new entity, types, port, exceptions, service interface, render helper, tokens, and `AiModule`.

**Acceptance**: `AiModule` importable from `@openlinker/core/ai`.

**Step 12 — AppModule registration.** Import the core `AiModule` (as `CoreAiModule` via alias) into `apps/api/src/app.module.ts` adjacent to `ContentModule`, and import the new `AiApiModule` (see Step 15) alongside the other `ApiModule`s.

### 6.5 Migrations

**Step 13 — DDL migration.** `apps/api/src/migrations/1790000000000-add-prompt-templates-table.ts`:
- `CREATE TABLE prompt_templates (...)` with all columns + CHECK on `state`.
- Five indexes as defined in §5.
- `down()` drops indexes then table.

**Step 14 — Seed migration.** `apps/api/src/migrations/1790000000001-seed-prompt-templates.ts`:
- Inserts two rows with `key='offer.description.suggest'`, `version=1`, `state='published'`, `published_at=now()`, `created_by=NULL`:
  - `channel='prestashop'` — HTML-oriented, SEO-aware, long-form copy suitable for a PrestaShop product description.
  - `channel='allegro'` — block-formatted, Allegro-rules-aware, character-budget-aware copy.
- Both declare variables: `product.name` (string, required), `product.attributes` (object, optional), `product.category` (string, optional), `tone` (string, optional), `extraInstructions` (string, optional).
- Plain `INSERT` — no `ON CONFLICT` clause; TypeORM tracks executed migrations so a re-run is impossible by construction.
- `down()` deletes the seeded rows by `(key, channel, version)`.

**Acceptance**: `pnpm --filter @openlinker/api migration:show` reports both as pending; applying them succeeds against a fresh DB; reverting both leaves the schema clean.

### 6.6 API surface (apps/api)

**Step 15 — Controller + DTOs + module.**
- DTOs under `apps/api/src/ai/http/dto/`:
  - `prompt-template-response.dto.ts` (class `PromptTemplateResponseDto.fromDomain(PromptTemplate)`).
  - `prompt-template-summary-response.dto.ts`.
  - `rendered-prompt-response.dto.ts`.
  - `create-prompt-template.dto.ts`, `update-prompt-template.dto.ts`, `revert-prompt-template.dto.ts`, `render-prompt-template.dto.ts` — all using `class-validator` + `@ApiProperty`. `systemPrompt` and `userPromptTemplate` fields carry `@MaxLength(65536)` to bound accidental payload size.
- Controller: `apps/api/src/ai/http/prompt-templates.controller.ts`:
  - Class-level `@ApiBearerAuth() @ApiTags('prompt-templates') @Controller('prompt-templates')`.
  - Every handler carries `@Roles('admin')`.
  - Catches `PromptTemplateNotFoundException` → `NotFoundException`, `PromptTemplateStateException` → `BadRequestException`, `PromptTemplateRenderException` → `UnprocessableEntityException`.
  - `POST /:id/render` delegates to `service.renderById(id, variables)`.
- Module `apps/api/src/ai/ai.module.ts` (class name `AiApiModule`):
  ```ts
  import { Module } from '@nestjs/common';
  import { AiModule as CoreAiModule } from '@openlinker/core/ai';
  import { PromptTemplatesController } from './http/prompt-templates.controller';

  @Module({ imports: [CoreAiModule], controllers: [PromptTemplatesController] })
  export class AiApiModule {}
  ```
- Register `AiApiModule` in `apps/api/src/app.module.ts` next to `ProductsApiModule` / `ListingsApiModule`.

**Acceptance**: endpoints reachable under `/prompt-templates`; non-admin user returns 403 via the existing `RolesGuard`. Controller has zero non-plumbing logic — coverage is provided entirely by the integration suite in Step 18.

### 6.7 Tests (backend)

**Step 16 — `render-template.spec.ts`** (`libs/core/src/ai/application/internal/`):
- Simple happy path with `{{name}}`.
- Dotted-path: `{{product.name}}`.
- Declared required missing → throws `PromptTemplateRenderException`, error contains `missingVariableName`.
- Declared optional missing → rendered as empty string.
- Undeclared `{{foo}}` → passthrough.
- Array values → JSON-stringified.

**Step 17 — `prompt-template.service.spec.ts`**:
- `createDraft` assigns `version=1` for a brand-new `(key, channel)` and `version=N+1` when priors exist.
- `updateDraft` refuses when state is `published` or `archived` (mock repo returns such a row).
- `publish` calls `repository.publishTransition(id)` and returns the updated template; throws `PromptTemplateStateException` when target is not `draft`.
- `revertTo` creates a new draft cloning the historical content and incrementing version.
- `render` throws `PromptTemplateNotFoundException` when no published row exists.

**Step 18 — Integration test** `apps/api/test/integration/prompt-templates-crud.int-spec.ts`:
- Bootstraps the harness, creates an admin JWT, exercises the full CRUD lifecycle through the HTTP layer using `supertest` (mirroring `connection-crud.int-spec.ts`).
- Asserts partial-unique indexes enforce single published per `(key, channel)`.
- Asserts non-admin returns 403.
- Update `apps/api/test/integration/setup.ts` TRUNCATE list to include `prompt_templates` (add before `products` or any table that references it — there are no FKs, so ordering is arbitrary).

### 6.8 Admin UI (apps/web)

**Step 19 — Feature types + api client.** `apps/web/src/features/prompt-templates/`:
- `api/prompt-templates.types.ts` — the DTO shapes from the backend (use local types, not direct imports from `@openlinker/core/*` to avoid pulling NestJS transitive imports into the browser build, mirroring the pattern of other features).
- `api/prompt-templates.api.ts` — `createPromptTemplatesApi(request): PromptTemplatesApi` with `list`, `get`, `getLatest`, `getVersions`, `create`, `updateDraft`, `publish`, `revert`, `render` methods.
- `api/prompt-templates.query-keys.ts` — `{ all, list(filters), detail(id), versions(key, channel), latest(key, channel) }`.
- Register the new API in `apps/web/src/app/api/api-client.ts`.

**Step 20 — Query + mutation hooks.** `apps/web/src/features/prompt-templates/hooks/`:
- `use-prompt-templates-query.ts`, `use-prompt-template-query.ts`, `use-prompt-template-versions-query.ts`.
- `use-create-prompt-template-draft-mutation.ts`, `use-update-prompt-template-draft-mutation.ts`, `use-publish-prompt-template-mutation.ts`, `use-revert-prompt-template-mutation.ts`.
- Each mutation invalidates `promptTemplatesQueryKeys.all` on success.

**Step 21 — Shared render helper on FE.** The FE copy lives at `apps/web/src/features/prompt-templates/lib/render-template.ts` — a hand-ported duplicate of the core helper, kept pure (no imports beyond the locally-declared `PromptTemplateVariable` type alias). The algorithm parity is protected by a shared fixtures module:

- Location: `libs/core/src/ai/application/internal/render-template.fixtures.ts`.
- Contents: pure TypeScript data — `readonly` arrays of `{ template, declared, values, expected }` test vectors.
- Imports: only the `PromptTemplateVariable` type from `../../domain/types/prompt-template.types`. No NestJS, no `@openlinker/shared/*`, no runtime logic.
- Consumption: the core spec (`render-template.spec.ts`) imports the fixtures via relative path; the FE spec (`render-template.test.ts`) imports them via the existing `@openlinker/core/*` TS path alias (already configured for the web package).
- CI guard: the plan's self-review step adds a `grep` check asserting `render-template.fixtures.ts` contains no `from '@nestjs/` or `from '@openlinker/shared/` imports; a regression on this file fails the quality gate.

This preserves "one algorithm, two runtimes, identical fixtures" without pulling NestJS into the web bundle.

**Step 22 — List page.** `apps/web/src/pages/prompt-templates/prompt-templates-list-page.tsx`:
- Uses `PageLayout` + `DataTable`.
- Columns: Key (mono), Channel (`StatusBadge`), Published (`v{n}` + `publishedAt`), Draft (`StatusBadge` tone `review` when `hasDraft`, else em-dash), Updated (relative + tooltip).
- Row click → navigate to `/settings/prompt-templates/:latestId` — `latestId` resolves to the draft when `hasDraft=true`, else the published id, else the newest row id. Backend guarantees it in the summary.
- Empty / error / loading states per `fe-pages` rule.
- Admin-role guard: non-admin sees `<ErrorState title="Admin role required" .../>`.
- **Mobile (≤ 767 px)** — fall back to card view per `frontend-ui-style-guide.md` §Responsive; one card per row with key + channel + version + draft pill stacked.
- Colocated test.

**Step 23 — Detail page.** `apps/web/src/pages/prompt-templates/prompt-template-detail-page.tsx`:
- Loads template by `:id` param.
- Layout at ≥ 1024 px: two-column grid, 65 % editor / 35 % history (per style guide §Responsive).
- Layout at 768–1023 px: single column, history below editor; still fully editable.
- **Layout at ≤ 767 px**: read-only; all editing and action controls hidden; show an inline `Alert` tone `info` above the editor: *"Editing prompt templates requires a larger screen. Open this page on a desktop to make changes. You can still review the current version and history."* Per style guide §Responsive "Complex editors".
- Read-only header (key, channel, state pill, version, publishedAt, updatedAt) — uses `KeyValueList` primitive.
- Tabbed editor using `Tabs` primitive: System prompt / User prompt template / Variables / Preview.
- Edit form (React Hook Form + Zod): `systemPrompt`, `userPromptTemplate`, declared variables list (name / type / required / description), sample-values JSON textarea.
- Preview pane renders both prompts live via `lib/render-template.ts` using the declared variables + sample values. Surfaces `PromptTemplateRenderException` messages inline; undeclared `{{foo}}` placeholders get a tone-`conflict` dotted-underline marker explaining the passthrough behaviour.
- Actions:
  - **Save draft**: visible only when state is `draft`. Calls `updateDraft`. Toast on success.
  - **New draft from this version**: visible when state is `published` or `archived`. Calls `createDraft` with the current content.
  - **Publish**: visible only when state is `draft`. `ConfirmDialog` via `Dialog` primitive, then calls `publish`. Toast on success. On 400 (concurrent-publish race), shows an inline `Alert` tone `error`.
  - **Discard draft**: visible only when state is `draft`. `ConfirmDialog` tone `danger`.
  - **Revert to v…**: opens a dialog listing prior versions; on selection calls `revertTo`.
- Version history panel uses a custom inline list (no `Timeline` primitive ships in `shared/ui/` yet — style-guide lists it as expected but no second consumer exists). CSS class `.prompt-history-list` is scoped to this page; upgrade to a shared primitive when a second consumer appears. Clicking an entry navigates to that version's id (read-only view). A per-entry "Revert to this version" ghost button opens the revert dialog.
- Colocated test.

**Step 24 — Routing + nav.**
- Add `prompt-templates-list.route.tsx` and `prompt-template-detail.route.tsx` under `apps/web/src/app/routes/`.
- Register both under `rootRoute.children` in `root.route.tsx`.
- Extend `staticCrumbs` in `app-shell.tsx` with `/settings/prompt-templates` and `/settings/prompt-templates/:id`.
- Add a "Prompt templates" card / link on `SettingsPage` visible only when `session.user.role === 'admin'`.

### 6.9 Tests (frontend)

**Step 25 — Page tests.** Use `renderWithProviders` + `createMockApiClient`:
- `prompt-templates-list-page.test.tsx` — loading, error, empty, happy (two rows), row click-through, non-admin blocked.
- `prompt-template-detail-page.test.tsx` — loading, error, draft edit + save, publish flow, revert flow, non-admin blocked, invalid form state.

**Step 26 — Shared render fixtures.** Same `render-template.fixtures.ts` exercised by the FE render test and the core `render-template.spec.ts` — any future drift fails both suites.

### 6.10 Docs (light-touch)

**Step 27 — Architecture doc callout.** Append a short bullet to `docs/architecture-overview.md` §13 (AI) noting that the AI bounded context now also owns prompt-template storage and the `PromptTemplateService`. One paragraph, no re-explanation of hex architecture.

---

## 7. Validation & Risks

### Architecture compliance checklist
- [ ] Domain layer has zero framework imports (`grep -rn "@nestjs\|typeorm" libs/core/src/ai/domain/` returns nothing).
- [ ] Application service depends on port interface via Symbol token, never on the concrete repository.
- [ ] ORM entities remain only in `infrastructure/persistence/entities/`.
- [ ] Migration has a reversible `down()`; integration harness `synchronize: true` reproduces the partial indexes.
- [ ] All API endpoints `@Roles('admin')`.
- [ ] No `any`, no `console.log`, no deep relative imports (`../../../`).
- [ ] Every new `.ts` file carries the documented header block (`engineering-standards.md` §"File Headers").
- [ ] `libs/core/src/ai/application/internal/render-template.fixtures.ts` contains no imports from `@nestjs/*` or `@openlinker/shared/*` (enforced by `scripts/check-fixture-purity.sh`, wired into `pnpm lint`).
- [ ] FE/BE render-template fixtures stay in lockstep (enforced by `scripts/check-render-template-fixture-drift.mjs`).

### Security
- Every handler carries `@Roles('admin')`. A non-admin returns 403. Tested end-to-end.
- User-supplied template content is stored as plain text — **never evaluated**. There is no templating engine and no code execution path. The render helper only substitutes strings.
- `createdBy` is taken from the authenticated user, not from the request body — no impersonation.

### Known risks and mitigations
1. **Concurrent `publish` on the same `(key, channel)`** — two admins click Publish on two different draft rows simultaneously. Mitigation: the partial unique index on `(key, channel, state='published')` guarantees at most one published row; the loser receives `QueryFailedError`, which `publishTransition` wraps into `PromptTemplateStateException` (400) with a "conflict — refresh" message. Unit-tested via a double-transition assertion.
2. **FE/BE render drift** — the admin preview must match what the backend actually sends. Mitigation: the render helper is a pure function; FE and BE share a common fixtures module; both test suites run against it in CI.
3. **Silent passthrough of mistyped `{{foo}}`** — the "undeclared = passthrough" rule lets typos reach the model. Mitigation: the preview pane highlights undeclared placeholders with a subtle badge ("not declared") so the author sees them before publish. (Implemented as part of Step 23.)
4. **Seed idempotency** — a re-run of the seed migration would violate the "one published per `(key, channel)`" partial index. Mitigation: TypeORM tracks executed migrations in the `migrations` table, so a re-run is impossible by construction. `down()` deletes strictly by `(key, channel, version=1)`.

### Open questions (non-blocking)
- Do we want to track **per-template model/temperature overrides** in this PR? Currently deferred; the `AiCompletionInput` still takes them at call time. If product pulls this forward, add two nullable columns (`model`, `temperature`) — zero ripple.
- Should the "create new draft from published" action be a dedicated endpoint or a specialised `revertTo(version = currentPublishedVersion)`? Going with the latter to keep the API surface small.

---

## 8. Acceptance Criteria (from issue #341)

- [x] Admin user can create, edit, publish, and revert a template through the UI. *(Delivered by Steps 22–24 + backend endpoints in Step 15.)*
- [x] `PromptTemplateService.render(...)` returns a fully substituted prompt and fails fast on missing required declared variables. *(Steps 6 + 8 + 16 + 17.)*
- [x] Non-admin users cannot reach the endpoints. *(Step 15 + the role-guard integration test in Step 18.)*
- [x] Seeded Allegro + PS templates exist after migration and are usable by the suggestion flow. *(Step 14.)*

---

## 9. Out-of-Scope Callout

Nothing in #339 or #342 is blocked by this plan *and* nothing in this plan blocks on them. The render helper is intentionally shipped so #342 can call `IPromptTemplateService.render(...)` once wired up in `ContentSuggestionService`.
