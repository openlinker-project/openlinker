# Implementation Plan — #590 Add `ai` and `content` to top-level core barrel

**Issue**: #590 `[F3] [HIGH] Two bounded contexts (ai, content) are missing from the top-level core barrel`
**Parent epic**: #552 (Modularity Thread F — SDK boundary preparation)
**Tracking**: #546 (Modularity audit)

> Originally selected as a pair with #591. After audit (86 deep-path imports across 5 packages, three structural decisions, runtime circular-require precedent), #591 was scoped out of this PR and deferred to a follow-up. This plan ships #590 only.

---

## 1. Goal

Two bounded contexts in `libs/core/src/` — `ai` and `content` — have full sub-barrels (`libs/core/src/ai/index.ts`, `libs/core/src/content/index.ts`) but are not re-exported from the top-level `libs/core/src/index.ts`. The AI integration adapter consequently writes ~30 deep imports of the form `@openlinker/core/ai/domain/...`, which the audit calls out as a stability surface that plugin authors should not be exposed to.

The fix has two parts, both explicitly listed in the issue's recommendation:

1. Add `export * from './ai';` and `export * from './content';` to `libs/core/src/index.ts`.
2. Refactor the AI integration package (`libs/integrations/ai/`) to import from the `@openlinker/core/ai` sub-barrel rather than deep paths.

**Layer**: SDK boundary / public-surface metadata. Zero runtime behaviour change — type-only and value-import path renames; the resolved module graph stays identical because `libs/core/src/ai/index.ts` and `libs/core/src/content/index.ts` already exist and re-export the same symbols.

---

## 2. Non-goals (explicit)

- **#591 is out of scope.** That issue calls for dropping the `./*/*` wildcard exports in `libs/core/package.json` and forcing every consumer through the barrel + adding an ESLint guard. The audit revealed three structural problems that #591 must solve before it can land:
  1. **`SyncJob` rename collision** — `libs/core/src/sync/index.ts` exports the class as `SyncJobEntity` and the type as `SyncJob`. Value-import consumers need either a class alias or call-site renames.
  2. **`ContentSuggestionService` (concrete class) is not on the `content` sub-barrel.** Per the listings precedent in `architecture-overview.md` §6, runtime-wiring classes live on a separate sub-subpath (`@openlinker/core/listings/services`) to avoid runtime circular requires. The same split is needed for content before the wildcard can drop.
  3. **ORM-entity boundary** — int-specs in `apps/api/test/integration/*.int-spec.ts` deep-import `ProductContentFieldOrmEntity` and `IntegrationCredentialOrmEntity`. Audit issue #594 [F7] explicitly says ORM entities shouldn't be on the public barrel. Dropping the wildcard requires picking one of: (a) put ORM entities on the main barrel and accept #594 stays open longer; (b) named subpath `./{ctx}/orm-entities`; (c) move int-spec ORM dependencies behind a fixture helper that uses runtime ports; (d) keep the wildcard *only* for ORM-entity paths and scope the ESLint guard to non-ORM patterns.

  Plus a runtime risk: the existing `.eslintrc.js:191-202` override turning off `no-restricted-imports` for `**/infrastructure/**`, `**/persistence/**`, `**/application/**` carries the comment "Infrastructure/persistence layers use relative imports to avoid runtime `ERR_PACKAGE_PATH_NOT_EXPORTED` errors" — direct evidence the codebase has previously broken at runtime when forced through barrels. Closing #591 must validate against `pnpm test:integration` end-to-end, not just unit tests + type-check.

  All of these decisions belong in #591's own PR. They are not blockers for #590.

- **No source semantics change.** Every import either stays as-is or moves to a path that re-exports the same symbol. Production behaviour is byte-identical.
- **No `package.json` exports edits.** The wildcards stay. They're how non-AI deep imports continue to resolve.
- **`apps/web` is unaffected.** It doesn't import `@openlinker/core/ai` or `@openlinker/core/content`.

---

## 3. Research notes

### 3.1 Current state of the top-level barrel

`libs/core/src/index.ts` re-exports 12 contexts: `customers`, `events`, `identifier-mapping`, `integrations`, `orders`, `products`, `inventory`, `sync`, `listings`, `users`, `mappings`, `webhooks`. Missing: `ai`, `content`.

### 3.2 AI deep-import surface (post #617 merge)

Re-audit confirms 30 deep-path imports across 6 files in `libs/integrations/ai/`:

| File | Imports |
|---|---|
| `src/ai-integration.module.ts` | 3 |
| `src/infrastructure/adapters/fake-ai-completion.adapter.ts` | 2 |
| `src/infrastructure/adapters/multi-provider-ai-completion.adapter.ts` | 5 |
| `src/infrastructure/adapters/multi-provider-ai-completion.adapter.spec.ts` | 5 |
| `src/infrastructure/adapters/vercel-ai-completion.adapter.ts` | 9 |
| `src/infrastructure/adapters/vercel-ai-completion.adapter.spec.ts` | 6 |

Symbols referenced: `AiCompletionPort` (type), `AiProviderCredentialsPort` (type), `IAiProviderActiveSettingsService` (type), `AiCompletionTypes` (types — `Provider`, etc.), `AiCompletionError` (value), `DuplicateAiProviderError` (value), `AiInvalidResponseError` (value), `AiProviderKeyMissingError` (value), `AiProviderSettingsNotApplicableError` (value), `AiRateLimitError` (value), `AiTimeoutError` (value).

All are already re-exported from `libs/core/src/ai/index.ts` (verified — see lines 20-52).

### 3.3 Runtime safety check

The AI sub-barrel re-exports `AiModule` (`libs/core/src/ai/index.ts:52`). When a file in `libs/integrations/ai/` imports `AiCompletionError` from `@openlinker/core/ai`, Node's module loader evaluates the entire `index.ts` chain — including `AiModule`. `AiModule` is a NestJS module class with `@Module` decorators that imports from `libs/core/src/ai/**`, NOT from `libs/integrations/ai/**`. There is no path back to the consuming integration package, so no circular require.

The integration package's `AiIntegrationModule` does import `AiModule` (transitively, via the multi-provider adapter wiring), but that's an existing dependency direction and is unchanged by this PR.

### 3.4 Why the ESLint hoisting concern from §2 doesn't apply here

The `.eslintrc.js:191-202` override is scoped to `**/infrastructure/**`, `**/persistence/**`, `**/application/**`. The 6 files we're refactoring sit under those patterns, but the override only disables `no-restricted-imports` — it doesn't *cause* the `ERR_PACKAGE_PATH_NOT_EXPORTED` problem. The runtime concern is real for **modules that have not yet been validated to load via the barrel**. Here, `libs/core/src/ai/index.ts` is already a registered package-export entry (`libs/core/package.json` lines 125-129) and is the value-import path used by `apps/api/src/ai/http/...` today (verified — those files use `@openlinker/core/ai/application/...` deep paths but that's a separate concern for #591). Switching the AI integration adapter to use the same `@openlinker/core/ai` entry that other consumers already exercise at runtime is low-risk.

The integration tests in `apps/api/test/integration/` exercise the full Nest bootstrap including `AiIntegrationModule` registration, so any runtime regression surfaces there.

---

## 4. Design

### 4.1 `libs/core/src/index.ts` — add 2 lines

```diff
 export * from './customers';
 export * from './events';
 export * from './identifier-mapping';
 export * from './integrations';
 export * from './orders';
 export * from './products';
 export * from './inventory';
 export * from './sync';
 export * from './listings';
 export * from './users';
 export * from './mappings';
 export * from './webhooks';
+export * from './ai';
+export * from './content';
```

Order: append. Keeping the existing alphabetic-by-merge-order works because no symbol from `ai` or `content` collides with names already in the barrel (verified — sub-barrel exports use the `Ai*`, `Prompt*`, `ContentPublisher*`, `ProductContentField*` prefixes; no overlap).

### 4.2 AI integration package — replace 30 deep-import paths

For each of the 6 files, collapse the deep imports into a single (or two — type vs value) import from `@openlinker/core/ai`. Example for `vercel-ai-completion.adapter.ts`:

```diff
-import type { AiCompletionPort } from '@openlinker/core/ai/domain/ports/ai-completion.port';
-import type { AiProviderCredentialsPort } from '@openlinker/core/ai/domain/ports/ai-provider-credentials.port';
-import type {
-  AiCompletionInput,
-  AiCompletionResult,
-  Provider,
-} from '@openlinker/core/ai/domain/types/ai-completion.types';
-import { AiCompletionError } from '@openlinker/core/ai/domain/exceptions/ai-completion.exception';
-import { AiInvalidResponseError } from '@openlinker/core/ai/domain/exceptions/ai-invalid-response.exception';
-import { AiProviderKeyMissingError } from '@openlinker/core/ai/domain/exceptions/ai-provider-key-missing.exception';
-import { AiProviderSettingsNotApplicableError } from '@openlinker/core/ai/domain/exceptions/ai-provider-settings-not-applicable.exception';
-import { AiRateLimitError } from '@openlinker/core/ai/domain/exceptions/ai-rate-limit.exception';
-import { AiTimeoutError } from '@openlinker/core/ai/domain/exceptions/ai-timeout.exception';
+import type {
+  AiCompletionInput,
+  AiCompletionPort,
+  AiCompletionResult,
+  AiProviderCredentialsPort,
+  Provider,
+} from '@openlinker/core/ai';
+import {
+  AiCompletionError,
+  AiInvalidResponseError,
+  AiProviderKeyMissingError,
+  AiProviderSettingsNotApplicableError,
+  AiRateLimitError,
+  AiTimeoutError,
+} from '@openlinker/core/ai';
```

Same pattern for the other 5 files. Where a file has only type imports (e.g. `fake-ai-completion.adapter.ts`), one consolidated `import type { ... } from '@openlinker/core/ai'` line suffices.

### 4.3 No `apps/api` changes in this PR

`apps/api/src/ai/http/...` and `apps/api/src/content/content.module.ts` also have deep imports into the same surfaces. Refactoring them is mechanically equivalent but isn't required by #590's recommendation (which calls out the *integration package* specifically). Including them would expand the diff without expanding the surface fix, and they'll be addressed by #591's full refactor anyway. **Out of scope.**

---

## 5. Step-by-step plan

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/index.ts` | Append `export * from './ai';` and `export * from './content';` | Both contexts now reachable via `@openlinker/core` top-level. |
| 2 | `libs/integrations/ai/src/ai-integration.module.ts` | Rewrite 3 deep-path imports as `import type { ... } from '@openlinker/core/ai'` | No deep paths remain in this file. |
| 3 | `libs/integrations/ai/src/infrastructure/adapters/fake-ai-completion.adapter.ts` | Rewrite 2 deep-path imports | No deep paths remain. |
| 4 | `libs/integrations/ai/src/infrastructure/adapters/multi-provider-ai-completion.adapter.ts` | Rewrite 5 deep-path imports | No deep paths remain. |
| 5 | `libs/integrations/ai/src/infrastructure/adapters/multi-provider-ai-completion.adapter.spec.ts` | Rewrite 5 deep-path imports | No deep paths remain. |
| 6 | `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.ts` | Rewrite 9 deep-path imports | No deep paths remain. |
| 7 | `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.spec.ts` | Rewrite 6 deep-path imports | No deep paths remain. |
| 8 | (quality gate) | `pnpm lint && pnpm type-check && pnpm test` | All pass. Existing AI-package test counts unchanged. |
| 9 | (smoke) | `pnpm build` (full monorepo) | Exit 0. Confirms type re-export resolution at declaration emission. |
| 10 | (verify zero AI deep-paths remain) | `grep -rEn "from '@openlinker/core/ai/" libs/integrations/ai` | Zero matches. |

Estimated diff: 7 files (1 barrel + 6 AI integration files), ~50 lines net.

---

## 6. Risks & mitigations

### R1 — Hidden circular require at module load
**Likelihood**: low. **Impact**: NestJS bootstrap fails at runtime.
The `@openlinker/core/ai` sub-barrel re-exports `AiModule`. Adding it to the import path of files that are themselves loaded by `AiIntegrationModule.register()` could in principle create a cycle.

**Mitigation**: §3.3 establishes `AiModule` does not transitively import from `libs/integrations/ai/`. The follow-up safeguard is `pnpm test` — the `multi-provider-ai-completion.adapter.spec.ts` and `vercel-ai-completion.adapter.spec.ts` files exercise both the AI module and the adapters in test bootstrap. Any cycle surfaces as a `Cannot read properties of undefined` or `ReferenceError` during Jest `beforeAll`.

### R2 — Symbol name collision in the top-level barrel
**Likelihood**: very low. **Impact**: TypeScript compile error.
`export * from './ai'` collides with `export * from './products'` if any symbol name overlaps.

**Mitigation**: §4.1 verified no overlap. The quality gate (`pnpm type-check`) is the explicit canary.

### R3 — Lint rule fires on the new sub-barrel imports
**Likelihood**: low. **Impact**: `pnpm lint` warning/error.
The repo's `no-restricted-imports` config bans some patterns. The 6 AI files sit under `**/infrastructure/**`, where the rule is disabled (per `.eslintrc.js:191-202`). The new imports are `@openlinker/core/ai` (no `/domain/`, `/application/`, `/infrastructure/` segments) — they don't match any banned pattern.

**Mitigation**: `pnpm lint` is the explicit canary.

### R4 — Build emits broken `.d.ts` for re-exported `AiModule`
**Likelihood**: very low. **Impact**: downstream type errors.
TypeScript's `export *` re-export of a class with `@Module` decorators is well-trodden territory, but worth a build smoke.

**Mitigation**: Step 9 (`pnpm build`) emits declaration files; any structural mismatch surfaces at API or worker build time.

---

## 7. Validation strategy

### 7.1 Quality gate (mandatory)

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all unit tests pass
```

### 7.2 Build smoke

```bash
pnpm build
```

Verifies declaration emission for the new top-level re-exports and confirms downstream packages still type-check against the new import paths.

### 7.3 Grep canary

```bash
grep -rEn "from '@openlinker/core/ai/" libs/integrations/ai
# expect zero matches
```

This is the explicit closure check for the issue's "Refactor the AI integration package" recommendation.

### 7.4 Integration tests — not run

This PR is a metadata + import-path change only. Integration tests are unaffected and `pnpm test:integration` is not part of the quality gate.

---

## 8. Architecture compliance

| Standard | Compliance |
|---|---|
| Hexagonal layering (`docs/architecture-overview.md` §Hexagonal) | N/A — public-surface change only. |
| `*.port.ts` / `*.adapter.ts` naming | Unchanged. |
| TypeScript strict mode | Unchanged. |
| No `any`, no `console.log` | Unchanged. |
| Migrations workflow | N/A — no schema changes. |
| Engineering standards §Import Aliases | Strictly aligned — moves from deep `@openlinker/core/ai/domain/...` to canonical `@openlinker/core/ai` sub-barrel alias. |
| Plugin-readiness contract (#552 epic) | **Direct compliance**. Closes one of the SDK-boundary HIGH findings. |

---

## 9. Out-of-scope follow-ups

- **#591 [F4] HIGH** — Connection entity exposed via deep path AND via barrel; broader wildcard cleanup. See §2 for the three structural decisions and runtime-validation requirement that need to land in that PR.
- **#594 [F7] MEDIUM** — ORM entities exported from public barrels. Conflicts with #591's "drop wildcards" recommendation; resolved together.
- **`apps/api` deep-path imports** into `@openlinker/core/ai/...` and `@openlinker/core/content/...` (~10 files). Not required by #590's recommendation; addressed by #591.
- **`apps/worker` deep-path imports** into `@openlinker/core/sync/...` (~9 files in tests + handlers). Same — #591.

---

## 10. Branch + PR conventions

- Branch: `590-591-core-barrel-cleanup` (already created via worktree). Note: branch name kept as the original paired-issue name since the worktree was already set up; PR title and body will scope to #590 only.
- Commit style: `refactor(core,ai): expose ai/content from top-level barrel and route AI adapter through the sub-barrel`
- Commit scope: 7 files (1 barrel + 6 AI integration).
- PR body: include `Closes #590`. Note that #591 remains open and link to the corrected scope (the three structural decisions + runtime-validation requirement).
