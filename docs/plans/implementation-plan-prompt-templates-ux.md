# Implementation Plan — Prompt Templates UX (#488 + #489)

**Goal**: Close the two operator-facing gaps on `/ai/prompt-templates`:

- **#488 (FE)** — surface a "New template" affordance so admins can author drafts without curl.
- **#489 (BE + FE)** — let admins soft-archive a template via the UI; back-end refuses to archive the only published row for a `(key, channel)` unless `{ force: true }`.

Single PR. Both issues share the same list-page surface and benefit from being shipped together.

---

## 1 · Layer & scope

| Concern | Layer | Status |
|---|---|---|
| `POST /prompt-templates` (create) | Interface (controller) | **Already exists** (`prompt-templates.controller.ts:129`) |
| `apiClient.promptTemplates.create` | FE API | **Already exists** (`prompt-templates.api.ts:77`) |
| `useCreatePromptTemplateMutation` | FE hook | **Already exists** (`use-prompt-template-mutations.ts:25`) |
| New-template dialog | FE feature component | **New** |
| `POST /prompt-templates/:id/archive` | Interface (controller) | **New** |
| `PromptTemplateService.archive` | Application service | **New** |
| `archiveById` repo method | Domain port + Infra impl | **New** |
| `CannotArchivePublishedTemplateException` | Domain exception | **New** |
| Archive dialog + per-row trigger | FE feature component | **New** |
| Status filter on list page | FE page | **New** (client-side) |

Non-goals (per issues):

- No hard delete (#489 explicitly out of scope).
- No un-archive UI (existing `revert` already covers cloning a historical version into a fresh draft, archived included).
- No bulk archive.
- No "duplicate" affordance (#488 explicitly out of scope).
- No edit-from-list, no JSON-import.

---

## 2 · Backend (#489)

### 2.1 Domain exception

**File**: `libs/core/src/ai/domain/exceptions/cannot-archive-published-template.exception.ts` (new)

```typescript
/**
 * Cannot Archive Published Template Exception
 *
 * Thrown when an admin tries to archive the only published row for a
 * `(key, channel)` pair without `{ force: true }`. Archiving the live
 * row would leave the suggestion service with no template to render —
 * the API surfaces this as 409 so the operator can either pick a
 * different row or pass `force: true`.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import type { PromptTemplateChannel } from '../types/prompt-template.types';

export class CannotArchivePublishedTemplateException extends Error {
  public readonly templateId: string;
  public readonly key: string;
  public readonly channel: PromptTemplateChannel | null;

  constructor(args: {
    templateId: string;
    key: string;
    channel: PromptTemplateChannel | null;
  }) {
    const channelLabel = args.channel ?? 'master';
    super(
      `Cannot archive published template ${args.templateId} (key=${args.key}, channel=${channelLabel}): no other published version exists for this (key, channel) pair. Publish a replacement first, or pass { "force": true } to bypass.`,
    );
    this.name = 'CannotArchivePublishedTemplateException';
    this.templateId = args.templateId;
    this.key = args.key;
    this.channel = args.channel;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

Export from `libs/core/src/ai/index.ts`.

### 2.2 Repository port + impl

**File**: `libs/core/src/ai/domain/ports/prompt-template-repository.port.ts` — add one method.

```typescript
export interface PromptTemplateRepositoryPort {
  // …existing methods…

  /**
   * Set state to `archived`. Caller validates pre-conditions (state guard
   * + force-flag check) — this method just performs the write and returns
   * the refreshed row.
   */
  archiveById(id: string): Promise<PromptTemplate>;
}
```

**File**: `libs/core/src/ai/infrastructure/persistence/repositories/prompt-template.repository.ts` — add the implementation. Plain `UPDATE …` (no transaction needed; service already validates state). Use `RETURNING *` style consistent with `updateContent`:

```typescript
async archiveById(id: string): Promise<PromptTemplate> {
  const result = await this.ormRepository
    .createQueryBuilder()
    .update(PromptTemplateOrmEntity)
    .set({ state: 'archived' })
    .where('id = :id', { id })
    .execute();

  if (result.affected === 0) {
    throw new PromptTemplateNotFoundException({ templateId: id });
  }
  const refreshed = await this.ormRepository.findOne({ where: { id } });
  if (refreshed === null) {
    throw new PromptTemplateNotFoundException({ templateId: id });
  }
  return this.toDomain(refreshed);
}
```

No new tests for the repo (existing repo tests don't cover the other mutators directly — they're exercised via the service spec).

### 2.3 Service method

**File**: `libs/core/src/ai/application/services/prompt-template.service.ts`

```typescript
async archive(id: string, opts: { force?: boolean; actor?: string | null }): Promise<PromptTemplate> {
  const existing = await this.repository.findById(id);
  if (existing === null) {
    throw new PromptTemplateNotFoundException({ templateId: id });
  }
  if (existing.state === 'archived') {
    throw new PromptTemplateStateException({
      templateId: id,
      actualState: existing.state,
      requiredState: 'draft',
      operation: 'be archived (already archived)',
    });
  }
  if (existing.state === 'published' && opts.force !== true) {
    // Partial unique index ensures at most one published row per (key, channel) —
    // a published target IS by definition the only published row for the pair.
    throw new CannotArchivePublishedTemplateException({
      templateId: id,
      key: existing.key,
      channel: existing.channel,
    });
  }

  const archived = await this.repository.archiveById(id);
  this.logger.log(
    `[prompt-template] archived templateId=${archived.id} key=${archived.key} channel=${
      archived.channel ?? 'master'
    } version=${archived.version} priorState=${existing.state} actor=${opts.actor ?? 'system'} forced=${opts.force === true}`,
  );
  return archived;
}
```

**File**: `libs/core/src/ai/application/services/prompt-template.service.interface.ts` — add the method to `IPromptTemplateService`.

### 2.4 Service unit tests

**File**: `libs/core/src/ai/application/services/prompt-template.service.spec.ts` — add a new `describe('archive')` block. Cases:

1. **happy path: draft → archived** (no force needed, no exception).
2. **happy path: published + force=true → archived**.
3. **refuses published without force** — throws `CannotArchivePublishedTemplateException`.
4. **refuses already-archived** — throws `PromptTemplateStateException`.
5. **NotFound** when repo returns null.
6. **emits archive log line** containing `templateId`, `key`, `channel`, `version`, `actor`, `forced`.

### 2.5 Controller endpoint

**File**: `apps/api/src/ai/http/dto/archive-prompt-template.dto.ts` (new)

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ArchivePromptTemplateDto {
  @ApiPropertyOptional({
    description:
      'Bypass the "no other published version" guard. Required when archiving the only published row for a (key, channel) pair — the suggestion service will then have no template to render until a replacement is published.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
```

**File**: `apps/api/src/ai/http/prompt-templates.controller.ts`

Add:

```typescript
@Roles('admin')
@Post(':id/archive')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Archive a draft or published prompt template' })
@ApiResponse({ status: 200, type: PromptTemplateResponseDto })
@ApiResponse({ status: 404, description: 'Template not found' })
@ApiResponse({ status: 409, description: 'Cannot archive the only published row without force' })
async archive(
  @Param('id', new ParseUUIDPipe()) id: string,
  @Body() dto: ArchivePromptTemplateDto,
  @CurrentUser() user: AuthenticatedUser,
): Promise<PromptTemplateResponseDto> {
  return this.withDomainExceptionMapping(async () => {
    const archived = await this.service.archive(id, {
      force: dto.force,
      actor: user.username,
    });
    return PromptTemplateResponseDto.fromDomain(archived);
  });
}
```

Extend `withDomainExceptionMapping` to map `CannotArchivePublishedTemplateException → ConflictException (409)`. Import `CannotArchivePublishedTemplateException` from `@openlinker/core/ai` and `ConflictException` from `@nestjs/common`.

### 2.6 Controller spec

**File**: `apps/api/src/ai/http/prompt-templates.controller.spec.ts` (likely exists — verify and extend; if it doesn't exist, this is the file path to add).

Cases:
- 200 happy path on draft archive.
- 200 happy path on published archive with `force: true`.
- 409 when archiving published without force (`CannotArchivePublishedTemplateException` → `ConflictException`).
- 404 when service throws `PromptTemplateNotFoundException`.

---

## 3 · Frontend — #488 (New template dialog)

### 3.1 Schema

**File**: `apps/web/src/features/prompt-templates/components/new-prompt-template.schema.ts` (new)

Zod schema mirroring `CreatePromptTemplateDto`:

```typescript
import { z } from 'zod';
import {
  PromptTemplateChannelValues,
  PromptTemplateVariableTypeValues,
} from '../api/prompt-templates.types';

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const variableSchema = z.object({
  name: z.string().trim().min(1, 'Variable name is required').max(128),
  type: z.enum(PromptTemplateVariableTypeValues),
  required: z.boolean(),
  description: z.string().trim().max(256).optional(),
});

export const newPromptTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Key is required')
    .max(128)
    .regex(KEY_PATTERN, 'Use lowercase letters, digits, dots and dashes only'),
  // 'master' is the dialog-side label that maps to channel: null.
  channel: z.enum(['master', ...PromptTemplateChannelValues]),
  systemPrompt: z.string().trim().min(1, 'System prompt is required').max(65536),
  userPromptTemplate: z.string().trim().min(1, 'User prompt is required').max(65536),
  variables: z.array(variableSchema).max(64, 'At most 64 variables allowed'),
});

export type NewPromptTemplateFormValues = z.input<typeof newPromptTemplateSchema>;
export type NewPromptTemplateSubmission = z.output<typeof newPromptTemplateSchema>;
```

### 3.2 Dialog component

**File**: `apps/web/src/features/prompt-templates/components/new-prompt-template-dialog.tsx` (new)

Shape:
- Wraps `Dialog` + `DialogContent` from `shared/ui/dialog`.
- React Hook Form + `zodResolver(newPromptTemplateSchema)`.
- Fields: `Input` for key, `Select` for channel (`Master (generic)` + `prestashop` + `allegro`), `Textarea` x2 for system + user prompts.
- **Variables editor**: keep deliberately simple — JSON textarea, parsed on submit. Reusing the rich `VariablesEditor` from `prompt-template-detail-page.tsx` is overkill for the on-ramp; the detail page is the editor, the dialog is the on-ramp (per #488 acceptance: "Keep the dialog deliberately simple").
- Inline `Alert` at top of form for `mutation.error` (per `frontend.md` form patterns).
- `FormErrorSummary` after first submit if validation errors exist.
- Submit calls `useCreatePromptTemplateMutation`. On success: invalidate list query (already wired in the hook), navigate to `/ai/prompt-templates/{newId}` via `useNavigate`, close dialog, toast success.
- `noValidate` on `<form>`.

Channel-mapping helper:

```typescript
function channelToApi(channel: 'master' | PromptTemplateChannel): PromptTemplateChannel | null {
  return channel === 'master' ? null : channel;
}
```

### 3.3 List page integration (#488)

**File**: `apps/web/src/pages/prompt-templates/prompt-templates-list-page.tsx`

- Local state `[newOpen, setNewOpen]`.
- `<PageLayout actions={<Button tone="primary" onClick={() => setNewOpen(true)}>New template</Button>}>` — only when `session.user?.role === 'admin'` (mirrors the existing admin gate in this page).
- Render `<NewPromptTemplateDialog open={newOpen} onOpenChange={setNewOpen} />`.

---

## 4 · Frontend — #489 (Archive flow)

### 4.1 FE API + mutation

**File**: `apps/web/src/features/prompt-templates/api/prompt-templates.api.ts`

Add `archive(id, opts?)` to `PromptTemplatesApi`:

```typescript
archive: (id: string, opts?: { force?: boolean }) => Promise<PromptTemplate>;
// implementation:
archive(id, opts): Promise<PromptTemplate> {
  return request<PromptTemplate>(`/prompt-templates/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify(opts ?? {}),
  });
},
```

**File**: `apps/web/src/features/prompt-templates/hooks/use-archive-prompt-template-mutation.ts` (new) — pattern mirrors the existing hooks in `use-prompt-template-mutations.ts`. Return the full `UseMutationResult`. Invalidate `promptTemplatesQueryKeys.all` on success.

### 4.2 Archive dialog component

**File**: `apps/web/src/features/prompt-templates/components/archive-prompt-template-dialog.tsx` (new)

- Wraps `Dialog`. NOT `ConfirmDialog` because we need a `force` checkbox + dynamic copy when the row is `published`.
- Props: `{ row: PromptTemplateSummary | null; open: boolean; onOpenChange(open): void }`.
- Body copy adapts on `row.latestState`:
  - draft: "Archive draft v{N}? It will be hidden from the list but kept in history."
  - published: "Archive published v{N}? Pass force to bypass the safety guard. Active suggestions for `(key, channel)` will fail until you publish a replacement." + force checkbox.
- Submit calls `useArchivePromptTemplateMutation`. Toast success, close on success.
- Inline `Alert` for mutation error (e.g., 409 on force=false).

### 4.3 Per-row trigger + status filter on list page

**File**: `apps/web/src/pages/prompt-templates/prompt-templates-list-page.tsx`

**Per-row action**: add a final column `actions` rendering a `Button tone="ghost"` "Archive" — visible only when `row.latestState !== 'archived'`. Click sets local state `[archiveTarget, setArchiveTarget]: PromptTemplateSummary | null` and opens the archive dialog.

DataTable's `rowHref` would conflict with row-level button clicks — the existing setup navigates the whole row. The archive button needs to stop event propagation (or use `event.preventDefault()` + `event.stopPropagation()` in its onClick) so clicking it doesn't also navigate to the detail page.

**Status filter**: add a second `<Select>` next to the existing channel filter:
- `Active` (default) — shows rows where `hasDraft || publishedVersion !== null`.
- `Archived` — shows rows where `!hasDraft && publishedVersion === null`.
- `All` — no filter.

URL state: `?status=active|archived|all`. Default is `active` (omitted from URL). Same pattern as the existing channel filter.

### 4.4 List page tests (extend)

**File**: `apps/web/src/pages/prompt-templates/prompt-templates-list-page.test.tsx`

Add cases:
- "New template" button visible for admin, opens dialog.
- "New template" button NOT in DOM for viewer (existing admin-gate test already covers most of this; verify the button isn't rendered).
- Archive button visible for admin on a non-archived row, opens dialog.
- Status filter "Active" hides a fully-archived summary row (where `hasDraft=false && publishedVersion === null && latestState === 'archived'`).

### 4.5 New dialog tests

**Files** (new):
- `apps/web/src/features/prompt-templates/components/new-prompt-template-dialog.test.tsx`
- `apps/web/src/features/prompt-templates/components/archive-prompt-template-dialog.test.tsx`

For new-template dialog:
- Renders all fields.
- Validation error on empty key shows inline.
- "Master (generic)" channel → submission sends `channel: null`.
- Success: `apiClient.promptTemplates.create` called with the right payload, navigate fired (mock `useNavigate`), dialog closes.
- API error → `Alert` rendered with the message; dialog stays open.

For archive dialog:
- Draft target: shows draft copy, no force checkbox; confirm calls `archive(id)` without `force`.
- Published target: shows force checkbox; confirm without force calls `archive(id, { force: false })`; with force calls `archive(id, { force: true })`.
- 409 from API → `Alert` rendered; dialog stays open.

---

## 5 · Quality gate

After implementation:

```bash
pnpm lint        # 0 errors
pnpm type-check  # clean across all 8 workspaces
pnpm test        # all unit tests pass; new BE + FE tests included
pnpm --filter @openlinker/api migration:show   # NO new migrations expected
```

No DB schema changes — `state='archived'` is already supported by the table CHECK constraint and the partial unique index.

---

## 6 · Self-review checklist (Phase 5)

- **Architecture**: domain port additions are minimal (`archiveById` only), service depends on port, controller maps domain exceptions → HTTP. ✅
- **Naming**: `CannotArchivePublishedTemplateException`, `archiveById`, `PromptTemplateService.archive`, `useArchivePromptTemplateMutation`, `ArchivePromptTemplateDialog`, `NewPromptTemplateDialog` — all match documented patterns. ✅
- **Symbol token**: reuses existing `PROMPT_TEMPLATE_SERVICE_TOKEN` and `PROMPT_TEMPLATE_REPOSITORY_TOKEN`. ✅
- **Type definitions**: Zod schema in `*.schema.ts`, types kept colocated. ✅
- **No `any`**: enforced. ✅
- **CSS tokens**: any new styles use existing `--status-*` / spacing tokens. ✅
- **Tests**: BE service spec + controller spec extended; FE dialog tests + list page extension. ✅
- **Audit log**: archive emits `{ templateId, key, channel, version, actor, action: archive, forced }` per `architecture-overview.md §13` telemetry contract. ✅
- **Authorization**: every new endpoint carries `@Roles('admin')` matching the existing controller convention. ✅

---

## 7 · Open questions / risks

1. **Re-archiving an already-archived row**: the plan throws `PromptTemplateStateException` (already archived). The issue doesn't specify; this matches the existing pattern (`updateDraft` + `publish` reject non-draft / wrong-state rows). If we'd rather make it idempotent (no-op), flip in the service before merge. **Default: throw.**
2. **`force=true` on a non-published row**: ignored (no effect — archiving a draft is unconditional). The DTO accepts it for forward-compatibility / consistency. No test coverage needed for this branch beyond confirming it doesn't break.
3. **Status filter on the BE**: I'm doing it client-side because the list endpoint already returns one summary per `(key, channel)` and the filter compose-logic is small. If we later need server-side pagination the filter should move to BE — out of scope for this PR.
4. **Archive button vs row-click navigation**: the existing `rowHref` pattern wraps the whole row. The new per-row Archive button must `stopPropagation` to avoid double action. Will verify during implementation.
