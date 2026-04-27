# Implementation Plan — #416 Configurable HTTP/Adapter Log-Body Truncation

**Issue**: [#416](https://github.com/SilkSoftwareHouse/openlinker/issues/416)
**Type**: DX / Logging
**Layer**: `libs/shared/src/logging/` (new helper) + integration call-site replacements
**Branch**: `416-log-body-truncation-env`

---

## Phase 1 — Understand the task

**Goal.** Replace hand-rolled `body.substring(0, N)` / `body.slice(0, N)` calls scattered across HTTP clients and adapters with a single shared helper `formatBodyForLog(body)` whose cap is controlled by `OL_LOG_BODY_MAX_BYTES` (default `0` = uncapped, full body).

**Why.** A 200-char silent truncation in `allegro-http-client.ts:431` cut an Allegro 422 `userMessage` mid-string and produced what looked like malformed JSON — operators lost the actionable half of the diagnostic. Truncation policy should be:

- **Off by default** (full-fidelity logs in dev / staging / debugging incidents)
- **Operator-tunable in prod** if log volume / cost is a concern, with a single knob

**Layer classification.** This is a **DX** change. The helper lives in `@openlinker/shared/logging`. Call sites are inside Integration adapters (Allegro, PrestaShop). No CORE / domain logic touched.

**Non-goals (per issue "Out of Scope").**
- DB-column-bound caps stay (`webhook-to-job.handler.ts:243` `dlqReason`, `webhook.service.ts:197` `rejectionReason`, `sync-job.repository.ts:195,204` `lastError`).
- Security caps stay (`webhook-auth.service.ts:45` signature first 20 chars).
- Identifier / hash / pluralisation slicing stays.
- Log-level / verbosity controls (e.g. `LOG_LEVEL=debug`) — orthogonal, separate ticket if/when wanted.

---

## Phase 2 — Research the codebase

**Existing shared logging surface** (`libs/shared/src/logging/`):
- `logger.ts` — thin `Logger extends NestLogger` wrapper.
- `index.ts` — barrel that re-exports `./logger`.

The new helper will be added alongside `logger.ts` and re-exported via `index.ts`. Public path: `@openlinker/shared/logging`.

**Existing truncation marker convention.** `prestashop-webservice.client.ts:427` already produces `${body.substring(0, 1000)}... [truncated, total length: ${body.length}]`. Issue spec aligns with this format (slight typographic upgrade to `…` ellipsis is a SUGGESTION, not required).

**Env-read pattern.** `libs/integrations/ai/src/ai-integration.module.ts:45` reads `process.env.OL_AI_PROVIDER` directly at module init (no `ConfigService` dependency). Same pattern fits here — the helper is module-scoped, framework-agnostic, and read-once is acceptable (operators restart on config change).

**Call-site survey.** Issue lists 9 file/line groups; concretely 14 `.substring(0, N)` / `.slice(0, N)` occurrences when each comma-separated group is expanded:

| # | File | Line | Current pattern | Surface |
|---|---|---|---|---|
| 1 | `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts` | 431 | `body.substring(0, 200)` | `logger.error` line |
| 2 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | 960 | `responseBody.slice(0, 500)` | `logger.warn` line |
| 3 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | 396 | `options.body.substring(0, 500)` | `logger.debug` request body |
| 4 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | 427 | `body.substring(0, 1000)... [truncated, total length: ${body.length}]` | `logger.debug` response body (already has marker) |
| 5 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | 497 | `body.substring(0, 1000)` | `logger.error` 5xx line |
| 6 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | 503 | `body.substring(0, 500)` | `PrestashopApiException` body arg |
| 7 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | 512 | `body.substring(0, 500)` | `PrestashopApiException` body arg |
| 8 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-response.parser.ts` | 69 | `responseBody.substring(0, 500)` | `PrestashopParseException` body arg |
| 9 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-response.parser.ts` | 80 | `responseBody.substring(0, 500)` | `PrestashopParseException` body arg |
| 10 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-response.parser.ts` | 98 | `responseBody.substring(0, 500)` | `PrestashopParseException` body arg |
| 11 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-response.parser.ts` | 115 | `responseBody.substring(0, 500)` | `PrestashopParseException` body arg |
| 12 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-response.parser.ts` | 126 | `responseBody.substring(0, 500)` | `PrestashopParseException` body arg |
| 13 | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` | 309 | `errorMessage.substring(0, 200)` | `logger.warn` line |
| 14 | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` | 318 | `responseBody.substring(0, 500)` | `logger.warn` line |

**Surface mix.** 7 sites are direct log-line interpolations; 7 sites pass the truncated body to a domain exception (`PrestashopApiException` / `PrestashopParseException`). Tech-review (post-plan) raised that wrapping the exception payload in `formatBodyForLog` is semantically off — the helper name says "for log", but the exception field is *captured data* that may be re-logged, parsed, or both. Allegro's `parseAllegroErrors` (`allegro-offer-manager.adapter.ts:948`) demonstrates the risk: it parses `error.responseBody` to extract `errors[]`, which is exactly why #409 made `AllegroApiException` carry the **full** body (lines 425, 438) and truncate only the inline log line.

**Decision (revised after tech-review):** apply the Allegro #409 pattern to PrestaShop too. The 7 log sites get `formatBodyForLog(body)`. The 7 exception-construction sites get **full** `body` — truncation is dropped entirely. Today this changes nothing (no PrestaShop caller currently parses `error.responseBody`), but it removes a future foot-gun and aligns the two integrations on the same convention. The PrestaShop log site at `prestashop-order-processor-manager.adapter.ts:318` that re-logs `createError.responseBody` will run that field through `formatBodyForLog` itself, so the operator cap still applies on the log surface even though the exception carries the full payload.

---

## Phase 3 — Design the solution

### Helper

**File**: `libs/shared/src/logging/format-body-for-log.ts`

```ts
/**
 * Format Body For Log
 *
 * Caps the length of an HTTP/adapter response or request body before it is
 * embedded in a log line. The cap is read once at module load from
 * `OL_LOG_BODY_MAX_BYTES`:
 *   - unset / empty / `0` / negative / non-numeric → return body unchanged (default)
 *   - strict positive integer N → if `body.length > N`, return
 *     `${body.slice(0, N)}… [truncated, total length: ${body.length}]`;
 *     otherwise return body unchanged.
 *
 * The cap operates on JS string units (UTF-16 code units), not UTF-8 bytes.
 * For ASCII the two are equivalent; for multi-byte content (Polish chars in
 * PrestaShop / Allegro responses) the resulting log line may exceed N bytes.
 * The env name is kept per #416 for operator clarity; this caveat lives here
 * so the next debugger sees it.
 *
 * The helper is intentionally log-only — values stored on domain exceptions
 * keep the FULL body (matches #409 / AllegroApiException). If you ever do
 * store the helper's output, treat it as opaque text: a truncation marker may
 * be appended and the result is no longer guaranteed to JSON-parse.
 *
 * Read-once at module init matches `AiIntegrationModule.register()`. Restart
 * the process to change the cap.
 *
 * @module libs/shared/src/logging
 */

const MAX_CHARS = parseMaxChars(process.env.OL_LOG_BODY_MAX_BYTES);

function parseMaxChars(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  // Use Number(), not parseInt() — parseInt('10abc', 10) silently returns 10.
  // We want strict integer parsing: anything else falls back to uncapped.
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return 0;
  return n;
}

export function formatBodyForLog(body: string): string {
  if (MAX_CHARS === 0 || body.length <= MAX_CHARS) return body;
  return `${body.slice(0, MAX_CHARS)}… [truncated, total length: ${body.length}]`;
}
```

**Design notes:**
- **`Number()` over `Number.parseInt()`.** Strict numeric parse — `Number('10abc') === NaN`, so malformed values like `OL_LOG_BODY_MAX_BYTES=10abc` correctly fall back to uncapped instead of being silently treated as `10`. Acceptance criterion 5 ("invalid env value falls back to no truncation") is honoured literally.
- **`Number.isInteger()` rather than `Number.isFinite()`.** Rejects `'1.5'`, `'1e3'`, `Infinity` — the env var is conceptually a non-negative integer count of chars.
- **Module-scoped `MAX_CHARS`.** Cheaper than re-parsing on every call. Matches `AiIntegrationModule.register()` pattern.
- **`MAX_CHARS` not `MAX_BYTES`.** The runtime constant reflects what the helper actually measures (JS chars). The env var keeps the public name `OL_LOG_BODY_MAX_BYTES` per the issue.
- **Marker uses `…` (U+2026) per issue spec.** PrestaShop's existing inline marker uses `...` (three ASCII dots) — that string is removed as part of this refactor (line 4 in the call-site table), so consistency is achieved.
- **No exports from `parseMaxChars`.** Internal. Tests inject via `process.env` + module re-import (see test plan).

### Barrel export

`libs/shared/src/logging/index.ts` — add `export * from './format-body-for-log';`.

### Call-site replacement

Each site becomes `formatBodyForLog(body)`. Imports added at the top of each file:

```ts
import { formatBodyForLog } from '@openlinker/shared/logging';
```

**Special case — line 427** (`prestashop-webservice.client.ts`): the existing inline marker (`... [truncated, total length: ${body.length}]`) is removed; the helper now produces the marker. Resulting line:

```ts
this.logger.debug(`Response body: ${formatBodyForLog(body)}`);
```

### Spec

**File**: `libs/shared/src/logging/format-body-for-log.spec.ts`

The helper reads env at module load — tests use `jest.isolateModules` (or `vi.resetModules` equivalent — this codebase is on Jest) to re-import with different env values. Coverage:

| Case | Env | Body | Expected |
|---|---|---|---|
| Unset env | `delete process.env.OL_LOG_BODY_MAX_BYTES` | `'hello world'` | `'hello world'` (unchanged) |
| Zero | `'0'` | `'hello world'` | `'hello world'` (unchanged) |
| Empty string | `''` | `'hello world'` | `'hello world'` (unchanged) |
| Negative | `'-100'` | `'hello world'` | `'hello world'` (unchanged) |
| Non-numeric | `'abc'` | `'hello world'` | `'hello world'` (unchanged) |
| Trailing garbage | `'10abc'` | `'hello world'` | `'hello world'` (unchanged — `Number('10abc')` is `NaN`) |
| Float | `'5.5'` | `'hello world'` | `'hello world'` (unchanged — not an integer) |
| Cap above body | `'100'` | `'hello world'` | `'hello world'` (unchanged) |
| Cap equal to body | `'11'` | `'hello world'` (length 11) | `'hello world'` (unchanged — boundary `<=` not `<`) |
| Cap below body | `'5'` | `'hello world'` | `'hello… [truncated, total length: 11]'` |
| Empty body | `'10'` | `''` | `''` (unchanged) |

The spec file gets the same `@module libs/shared/src/logging` header as the helper.

### Env documentation

**`apps/api/.env.example`** — append a new section after the AI block (lines 107–126), before the trailing newline. Both `apps/api/` and `apps/worker/` files get the same block, since both processes run integration adapters.

```
# --- Logging -----------------------------------------------------------------
# Cap on HTTP/adapter response and request body length when embedded in log
# lines (and integration exception payloads). Default 0 = uncapped — full
# body in logs, useful for dev / staging / debugging incidents. Set to a
# positive integer (chars) to truncate; truncated lines get a
# `… [truncated, total length: N]` marker so consumers can distinguish a
# clipped log from a malformed payload.
# OL_LOG_BODY_MAX_BYTES=0
```

---

## Phase 4 — Step-by-step implementation

| # | Step | File(s) | Acceptance |
|---|---|---|---|
| 1 | Create helper | `libs/shared/src/logging/format-body-for-log.ts` | Compiles; default-export-free |
| 2 | Add barrel export | `libs/shared/src/logging/index.ts` | `import { formatBodyForLog } from '@openlinker/shared/logging'` resolves |
| 3 | Write spec | `libs/shared/src/logging/format-body-for-log.spec.ts` | All 9 cases above pass |
| 4 | Replace call site #1 | `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts:431` | Line uses `formatBodyForLog(body)`; import added |
| 5 | Replace call site #2 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:960` | Line uses `formatBodyForLog(responseBody)`; import added |
| 6 | Replace log sites in PrestaShop client | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` (lines 396, 427, 497) | Three log calls use helper; line 427's inline marker removed; import added |
| 7 | Drop truncation on PrestaShop client exception bodies | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` (lines 503, 512) | Pass full `body` to `PrestashopApiException`; matches Allegro #409 |
| 8 | Drop truncation on PrestaShop parser exception bodies | `libs/integrations/prestashop/src/infrastructure/http/prestashop-response.parser.ts` (lines 69, 80, 98, 115, 126) | Pass full `responseBody` to `PrestashopParseException` (5 sites) |
| 9 | Replace log sites in PrestaShop order-processor adapter | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` (lines 309, 318) | Both log lines use helper; import added |
| 10 | Document env in API | `apps/api/.env.example` | New `--- Logging ---` block added |
| 11 | Document env in Worker | `apps/worker/.env.example` | Same block appended |
| 12 | Quality gate | — | `pnpm lint && pnpm type-check && pnpm test` all green |
| 13 | Manual fixture verify | — | Replay a captured Allegro 422 body locally with `OL_LOG_BODY_MAX_BYTES` unset; confirm full `userMessage` appears in `[AllegroHttpClient]` log. If a captured body isn't accessible in this branch, note as a gap and rely on unit + e2e via the spec. |
| 14 | Self-review per code-review-guide | — | No BLOCKING / IMPORTANT remaining |
| 15 | Commit & push | — | Conventional commit message |
| 16 | Open PR | — | Body contains `Closes #416` |

---

## Phase 5 — Validate

**Architecture compliance.**
- ✅ Helper lives in `libs/shared/` — pure utility, no NestJS / domain coupling. Domain layer untouched.
- ✅ Integrations import from `@openlinker/shared/logging` (existing alias, used elsewhere via `Logger`). Dependency direction preserved.
- ✅ No CORE / Integration boundary touched.

**Naming.**
- ✅ `format-body-for-log.ts` matches kebab-case file convention.
- ✅ `formatBodyForLog` is a pure utility function — no class, no port, naming aligns with shared utility conventions (e.g. existing logger surface).
- ✅ `OL_LOG_BODY_MAX_BYTES` matches the `OL_*` env-var family.

**Testing strategy.**
- ✅ Unit test only (no Docker / network) — pure function with env-driven module init. `jest.isolateModules` per case.
- ✅ Coverage of acceptance criteria: unset, 0, positive cap below, positive cap above, invalid value (extended to negative + non-numeric).

**Security.**
- ✅ Helper does not log anything itself — it returns a string. Caller decides what to log.
- ✅ Default `0` (full body) preserves diagnostic visibility for incidents.
- ✅ `webhook-auth.service.ts:45` (signature truncation) is explicitly out of scope — not touched.

**Risk surface.**
- The 7 exception-body sites now pass **full body** (truncation dropped) instead of being routed through the helper. This means: (a) regardless of `OL_LOG_BODY_MAX_BYTES`, `error.responseBody` is always the complete upstream payload — safe to parse, safe to inspect; (b) the operator log cap still applies on the log surface, because `prestashop-order-processor-manager.adapter.ts:318` re-logs the field through `formatBodyForLog`. Aligns with the Allegro #409 precedent (`AllegroApiException` carries full body; `parseAllegroErrors` parses it).
- With `OL_LOG_BODY_MAX_BYTES=0` (default), all 14 surfaces show the full body — strictly more diagnostic than today.
- With operator-set cap `N`, the 7 log sites cap; the 7 exception bodies stay full. No parse-corruption risk on either surface.

**Rollback.**
- Single-commit change. Revert PR #N if needed.

---

## Open questions / SUGGESTIONs

- **None blocking.** One stylistic SUGGESTION already implicit in the helper: use `…` (U+2026) for the marker rather than `...` — issue spec calls for it; PrestaShop's existing `...` is removed by the refactor naturally.
