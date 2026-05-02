# Implementation plan — master-channel prompt template (#490)

## 1. Goal

Master-tab AI suggestions are silently broken: the FE sends `channel: null`, `PromptTemplateService.getPublished({ key: 'offer.description.suggest', channel: null })` finds no row (only `allegro` + `prestashop` are seeded), and the request 404s with `Prompt template not found: key=offer.description.suggest, channel=master`. Three changes, one PR:

1. **Seed** the missing `(offer.description.suggest, channel=NULL, v1, published)` row so master-tab Suggest actually generates copy.
2. **Tighten the exception message** when `channel === null` so operators landing on the error know what to do.
3. **FE Alert with deep-link** in `suggestion-dialog.tsx` so the operator can jump straight to `/ai/prompt-templates` to author the missing row (also serves as future-proofing if a new key gets added without a master seed).

**Layer:** Infrastructure (seed migration in `apps/api`) + Domain (exception copy in `libs/core/src/ai`) + Frontend (dialog error rendering in `apps/web`).

**Non-goals**
- Channel-fallback logic (`null → channel` or `channel → null`). The strict per-`(key, channel)` lookup is intentional — channel-specific divergence is the feature.
- Authoring "great" master prompt prose. The seed is sensible, neutral, channel-agnostic; iteration belongs to the admin UI (#488).
- Adding seeds for new keys (e.g., future `product.title.suggest`).

## 2. Codebase research

### BE
- **Existing seed migration** (`apps/api/src/migrations/1790000000001-seed-prompt-templates.ts`): inserts `prestashop` + `allegro` rows for `offer.description.suggest` v1 with shared `VARIABLES_JSON`. Plain `INSERT INTO prompt_templates (...) VALUES (...)`. Down deletes those two rows. Channel-specific copy lives in the prompt body.
- **Latest migration timestamp** in the tree: `1793000000000-add-order-record-sync-attempts.ts`. Next free lane: **`1794000000000`** (per the timestamp-uniqueness invariant in `docs/migrations.md`).
- **Exception**: `libs/core/src/ai/domain/exceptions/prompt-template-not-found.exception.ts` line 27 builds the `channel=...` part with `args.channel ?? 'master'` — the message word is correct, just incomplete for the operator. Constructor receives `channel?: PromptTemplateChannel | null`, so `channel === null` is distinguishable from `channel === undefined` (id-based lookup).
- **HTTP boundary**: `apps/api/src/content/http/content.controller.ts:194` rethrows `PromptTemplateNotFoundException` as a NestJS `NotFoundException` (HTTP 404) with the exception's message string as the body.
- **No existing test** for the exception class itself (grep confirmed). The service spec covers thrown-exception cases by class but not message format.
- **Partial unique index**: `prompt_templates` has "at most one published per (key, channel)" (per architecture-overview §13 + the migration adding the table). For a fresh DB this insert is uncontested; for an existing DB where someone already inserted a master row manually, `ON CONFLICT DO NOTHING` is cheap insurance (matches the spirit of "idempotent seed").

### FE
- **API client**: errors land as `ApiError` (`apps/web/src/shared/api/api-error.ts`) with `.status: number` + `.message: string` + `.isNotFound()` helper. The 404 body's `message` field becomes `error.message`.
- **Dialog**: `apps/web/src/features/content/components/suggestion-dialog.tsx:140` currently renders `<Alert tone="error">{mutation.error.message}</Alert>` with no special-casing. Today's UX is the bare exception message, no link to remediate.
- **Existing dialog test**: `apps/web/src/features/content/components/suggestion-dialog.test.tsx` exists and uses the standard `renderWithProviders` + `createMockApiClient` pattern. Good place to add the 404-branch test.

### Open question (resolved)
- Should the FE match by status code or by message content? **Status code + message-prefix.** `error instanceof ApiError && error.isNotFound() && error.message.includes('Prompt template not found')` — matches even if the message gets future polish, and avoids false positives on other 404s (e.g., product not found).

## 3. Design

### BE — seed migration (idempotent)

```ts
// apps/api/src/migrations/1794000000000-seed-prompt-template-offer-description-suggest-master.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const VARIABLES_JSON = JSON.stringify([
  { name: 'product.name', type: 'string', required: true },
  { name: 'product.attributes', type: 'object', required: false },
  { name: 'product.category', type: 'string', required: false },
  { name: 'tone', type: 'string', required: false },
  { name: 'extraInstructions', type: 'string', required: false },
]);

const SYSTEM_PROMPT = `You are a senior e-commerce copywriter producing canonical product
descriptions for the OpenLinker master catalogue. Write clean, persuasive prose without any
HTML, markdown, or platform-specific formatting. The output is the master copy — it gets
adapted into HTML for shop platforms (PrestaShop) and into block-formatted listings for
marketplaces (Allegro) by channel-specific publishers, so keep the structure simple: a short
benefit-focused opening sentence or two, then a clear bulleted-on-newlines feature
enumeration, then a closing sentence. Match the language of the product name.`;

const USER_TEMPLATE = `Write a master product description (120–220 words) for the following product.

Product: {{product.name}}
Category: {{product.category}}
Attributes: {{product.attributes}}

Tone: {{tone}}
Additional instructions: {{extraInstructions}}

Output plain prose only — no HTML, no markdown, no platform-specific formatting. The
description will be adapted by channel publishers downstream.`;

export class SeedPromptTemplateOfferDescriptionSuggestMaster1794000000000 implements MigrationInterface {
  name = 'SeedPromptTemplateOfferDescriptionSuggestMaster1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "prompt_templates"
        ("key", "channel", "version", "system_prompt", "user_prompt_template", "variables", "state", "published_at", "created_by")
      VALUES
        ($1, NULL, 1, $2, $3, $4::jsonb, 'published', now(), NULL)
      ON CONFLICT DO NOTHING
      `,
      ['offer.description.suggest', SYSTEM_PROMPT, USER_TEMPLATE, VARIABLES_JSON],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompt_templates" WHERE "key" = $1 AND "version" = 1 AND "channel" IS NULL`,
      ['offer.description.suggest'],
    );
  }
}
```

`ON CONFLICT DO NOTHING` is the idempotent escape hatch: if the partial-unique index for "at most one published per (key, channel)" already has a master row (manually inserted), the migration is a no-op rather than a failure. `down` is symmetric.

### BE — exception message

Only expand the message when `channel === null` (the master case). Other branches stay unchanged:

```ts
constructor(args: {...}) {
  const parts: string[] = [];
  if (args.templateId !== undefined) parts.push(`id=${args.templateId}`);
  if (args.key !== undefined) parts.push(`key=${args.key}`);
  if (args.channel !== undefined) parts.push(`channel=${args.channel ?? 'master'}`);
  if (args.version !== undefined) parts.push(`version=${args.version}`);
  const base = `Prompt template not found: ${parts.join(', ')}`;
  // #490: master-channel hits the unseeded gap most often. Append an
  // operator-actionable hint so the FE / API consumer knows what to do.
  const isMasterLookup = args.channel === null && args.key !== undefined;
  super(
    isMasterLookup
      ? `${base}. Seed a template with channel=null for this key, or pick a channel-specific tab in the content editor.`
      : base,
  );
  // ... rest unchanged
}
```

The hint text is operator-facing but stable (no template-string interpolation of user input), safe to ship through the 404 body.

### FE — dialog error rendering

Replace the bare `<Alert>{mutation.error.message}</Alert>` with a status-aware branch:

```tsx
{mutation.error && (
  isMissingTemplateError(mutation.error) ? (
    <Alert tone="error">
      {mutation.error.message}{' '}
      <Link to="/ai/prompt-templates" className="content-suggestion__alert-link">
        Open prompt templates →
      </Link>
    </Alert>
  ) : (
    <Alert tone="error">{mutation.error.message}</Alert>
  )
)}
```

Helper colocated in the file (small, single-use):

```ts
function isMissingTemplateError(error: Error): boolean {
  return (
    error instanceof ApiError &&
    error.isNotFound() &&
    error.message.startsWith('Prompt template not found')
  );
}
```

The `ApiError` import already exists at the FE app layer; needs a relative import path. The `Link` is React Router's standard nav link (already used elsewhere in `apps/web/src/pages/...`). The CSS class is one tiny addition to `index.css` matching existing alert-link conventions.

### Why not parse a structured error code?

We could pipe a structured `code: 'PROMPT_TEMPLATE_NOT_FOUND'` field through the 404 body via a NestJS exception filter and have the FE match on `error.details.code`. Cleaner, but pulls in an exception filter rewrite that's out of scope for a behavioural fix. Status + message-prefix is fine and follows the existing #486 Allegro-422 pattern (the FE also matches on body shape, not on a custom code).

## 4. Step-by-step plan

### Step 1 — BE: seed migration

**File:** `apps/api/src/migrations/1794000000000-seed-prompt-template-offer-description-suggest-master.ts` (new)

Insert the master row with `ON CONFLICT DO NOTHING`. Standard `MigrationInterface` shape, file-header comment per `engineering-standards.md`.

**Acceptance:** `pnpm lint` passes (timestamp-uniqueness invariant green). `pnpm --filter @openlinker/api migration:show` lists the new migration as pending.

### Step 2 — BE: exception copy

**File:** `libs/core/src/ai/domain/exceptions/prompt-template-not-found.exception.ts`

Append the operator-actionable hint to the message body when `channel === null && key !== undefined`. Other cases unchanged.

**Acceptance:** Type-check green. Existing service spec still passes (it asserts class identity, not message content).

### Step 3 — BE: exception unit test

**File:** `libs/core/src/ai/domain/exceptions/prompt-template-not-found.exception.spec.ts` (new)

Three cases:
- `channel === null` (master) → message ends with the actionable hint.
- `channel === 'allegro'` → message has no hint, ends with `channel=allegro`.
- id-based lookup (`templateId` only) → message has no hint, body is just `id=...`.

**Acceptance:** 3/3 pass with `pnpm --filter @openlinker/core test`.

### Step 4 — FE: dialog deep-link Alert

**File:** `apps/web/src/features/content/components/suggestion-dialog.tsx`

- Import `ApiError` from `../../../shared/api/api-error`.
- Import `Link` from `react-router-dom`.
- Add `isMissingTemplateError` helper (top of file or below `MAX_*` constants).
- Replace the single `Alert` line with the conditional rendering described above.

Add the small CSS class `.content-suggestion__alert-link` in `apps/web/src/index.css` styled as a standard inline alert link (matches existing alert link styling — find a sibling pattern like `.alert__link` if one exists; otherwise inline tokens: `color: var(--accent-primary); text-decoration: underline; margin-left: 0.25rem`).

**Acceptance:** `pnpm --filter @openlinker/web type-check` + `lint` green. Dialog still renders normal `<Alert>` for non-template errors.

### Step 5 — FE: dialog test for the 404 branch

**File:** `apps/web/src/features/content/components/suggestion-dialog.test.tsx`

Add one case: when `useSuggestContentMutation`'s underlying API call rejects with `new ApiError('Prompt template not found: key=offer.description.suggest, channel=master. Seed...', 404, ...)`, the dialog renders an `<Alert>` whose body contains the message AND a link with `href="/ai/prompt-templates"`. Assert the link is absent for a generic non-404 error (or non-matching message).

**Acceptance:** new test passes with the existing test file's full suite.

### Step 6 — Quality gate

```
pnpm --filter @openlinker/api lint && type-check
pnpm --filter @openlinker/core lint && type-check && test
pnpm --filter @openlinker/web lint && type-check && test
pnpm --filter @openlinker/api migration:show
```

All clean; the new migration shows as pending against any non-migrated DB.

## 5. Validation

- **Architecture (BE):** Migration in `apps/api/src/migrations/` (correct layer). Exception change in `libs/core/src/ai/domain/exceptions/` (correct layer). No CORE/Integration boundary crossed.
- **Architecture (FE):** Dialog stays under `features/content/components/` — no page-level changes needed. Imports `ApiError` from `shared/api/`, follows `features → shared` direction. `Link` is a `react-router-dom` primitive (allowed).
- **Naming:** Migration class name matches its filename timestamp suffix (`...1794000000000`) per the timestamp invariant. Test file follows `*.spec.ts` for BE, `*.test.tsx` for FE.
- **Idempotency:** `ON CONFLICT DO NOTHING` covers re-runs against a DB where someone manually authored a master row; `down()` is symmetric.
- **No regression risk:** allegro/prestashop seed migration untouched; channel-specific lookup still hits its row first; the new master row is only consulted when the master tab is active (FE sends `channel: null`).
- **Security:** No user input in the prompt body. The hint text is a static string. The deep link is a same-origin route. No XSS / injection vectors.
- **Migration safety:** Single `INSERT` wrapped in TypeORM's default transaction. No DDL — no lock-up risk.

## 6. Risks & open questions

- **Master-prompt prose quality.** The seed body is sensible-but-generic. If operators dislike the channel-neutral output once they actually use it, they can override per-product or author a v2 via the admin UI. Acceptable risk for a seed.
- **Nest exception filter coupling.** This PR doesn't introduce a structured error code. If a future PR (#488 or the unified error-shape work) wants to do that, the FE matcher gets simpler — the message-prefix match here is a stepping stone, not a long-term design.
- **`ON CONFLICT DO NOTHING` masking real failures.** The only way it masks a problem is if a master row already exists with different prompt body. That's intended — operators who manually authored one keep theirs. If it later turns out we need to refresh the seed across environments, that's a separate "v2 seed" migration.
