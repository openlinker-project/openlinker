# Implementation Plan — #423: FE serializer hardening + category-parameters cache version

## 1. Goal

Allegro rejects offer creation with `ParameterCategoryException` when `Marka` (Brand, parameter `248811`) is submitted under `body.parameters[]` (offer-section) instead of `body.productSet[0].product.parameters[]` (product-section). Investigation (issue #423) traced the bug to two cooperating causes:

1. **Stale wizard cache.** `useCategoryParametersQuery` has `staleTime: 24 * 60 * 60 * 1000` (24h) and a `queryKey` that doesn't include a schema version. An operator whose browser TanStack Query cache predates #417 (when the `section` field landed on `CategoryParameter`) gets served a cached response where Marka has no `section` field. The cache happily serves it for 24h; no refetch.
2. **Silent FE serializer fallback.** `serialize-allegro-parameters.ts:59-62` defaults to offer-section when `param.section !== 'product'`, which includes the case where `section` is `undefined`. The CORE type marks `section` as required (no `?`), so the `else` branch was *intended as defensive code for an impossible case* — but in practice it fires when the cache returns a stale response, and silently mis-routes the parameter.

The fix is two coordinated changes that fail-loud and cache-bust:

- **Tighten the serializer** — replace the silent `else` with an explicit `if (param.section === 'offer')` and throw a `MissingCategoryParameterSectionError` when neither branch matches. Makes future regressions fail loudly at the boundary instead of silently producing wrong wire shapes.
- **Version the cache key** — add a `CATEGORY_PARAMETERS_SCHEMA_VERSION` constant to the queryKey so a schema bump forces every browser to refetch, regardless of staleTime. Prevents the same staleness from recurring on the next field addition.

## 2. Layer classification

| Layer | Change |
|---|---|
| **CORE** | None — `CategoryParameter.section` flag is correct as a required field. |
| **Integration (Allegro)** | None — mapper correctly emits `section: 'product' | 'offer'` from `options.describesProduct`. |
| **Interface (API)** | None — API echoes the CORE type. |
| **Frontend** | (a) Tighten `serializeAllegroParameters` — explicit branch + throw on missing section. (b) Bump query key with a schema-version constant. (c) Unit tests for both branches. |
| **DX** | None. |

## 3. Non-goals

- **No** change to the `staleTime` itself. 24h is reasonable for a slowly-changing category-schema fetch; the issue is cache *correctness*, not freshness. Shorter staleTime would only narrow the bad-state window; the version key eliminates it.
- **No** backend cache change. The CachePort-side server cache is keyed by category and stores the response Allegro returned at fetch time; once the mapper translates `describesProduct → section`, the server cache always has the field. The issue is browser-side cache.
- **No** UI change. The wizard form's behavior is unaffected — the operator never sees `section`.
- **No** schema-migration / fixture re-capture. Existing `category-parameters-257933.json` fixture is correct.
- **No** retroactive cache-clear instruction in operator UI. The version-key bump auto-busts on next deploy.

## 4. Design

### 4.1 Serializer hardening

**Current** (`serialize-allegro-parameters.ts:59-62`):

```typescript
if (param.section === 'product') {
  productParameters.push(out);
} else {
  offerParameters.push(out);  // ← also fires when section is undefined
}
```

**After**:

```typescript
if (param.section === 'product') {
  productParameters.push(out);
} else if (param.section === 'offer') {
  offerParameters.push(out);
} else {
  // CORE marks `section` as required; reaching this branch means the data
  // arrived from outside the type contract — almost certainly a stale
  // TanStack Query cache predating #417 (when `section` was added). Fail
  // loud rather than silently mis-routing the parameter to offer-section
  // and getting `ParameterCategoryException` from Allegro on submit.
  throw new MissingCategoryParameterSectionError(param.id, param.name);
}
```

A new `MissingCategoryParameterSectionError` class is introduced in the same file (single consumer, colocated with the throw site).

**Pinned developer-facing message** (carried by the error, surfaces in stack traces and the wizard's debug logs):

```
Category parameter '{parameterId}' ({parameterName}) is missing a 'section'
value. This usually means the wizard's category-parameters data was cached
before the schema field was introduced (#417). Reload the wizard to refetch.
```

The error class stores `parameterId` and `parameterName` as public readonly properties so the wizard's catch-handler can drop them into the operator-facing alert copy without re-parsing the message.

### 4.2 Cache version key

The version constant lives in **`listings.types.ts`** (next to the `CategoryParameter` interface itself), not in `listings.query-keys.ts`. Co-location matters: a future engineer adding a required field to `CategoryParameter` is staring at the bump-protocol comment as they edit, and is more likely to remember to bump the version. The query-keys file imports the constant.

**`listings.types.ts`** — new export, placed immediately above the `CategoryParameter` interface:

```typescript
/**
 * Cache-bust version for the category-parameters TanStack Query response shape.
 *
 * **BUMP THIS** every time the `CategoryParameter` interface gains a new
 * required field (or removes one), so every browser's in-flight TanStack
 * Query cache for this endpoint is invalidated on next deploy.
 *
 * Why: the FE caches the categoryParameters response for 24h (see
 * `useCategoryParametersQuery`'s `staleTime`). When a required field is
 * added to the interface, browsers holding pre-bump cached responses will
 * serve stale data that violates the type contract — causing the
 * `MissingCategoryParameterSectionError` throw in `serializeAllegroParameters`
 * (the runtime backstop). Bumping this constant routes around the staleness
 * by changing the queryKey, so old caches become orphaned and a fresh fetch
 * is forced.
 *
 * Bump history:
 *   - 2 (#423, 2026-04): post-#417 schema with `section: 'offer' | 'product'`.
 *   - 1 (implicit): pre-#417 schema without `section`.
 *
 * @see {@link CategoryParameter}
 * @see #423 for the original cache-staleness incident.
 */
export const CATEGORY_PARAMETERS_SCHEMA_VERSION = 2;
```

**`listings.query-keys.ts:15-16`** — imports the constant and includes it in the queryKey:

```typescript
import { CATEGORY_PARAMETERS_SCHEMA_VERSION } from './listings.types';

// ...
categoryParameters: (connectionId: string, categoryId: string) =>
  ['listings', 'categoryParameters', CATEGORY_PARAMETERS_SCHEMA_VERSION, connectionId, categoryId] as const,
```

The version starts at `2` because the `section` field was added in #417; bumping from an implicit `1` to `2` represents the post-#417 schema and forces every existing browser cache to bust on this PR's deploy.

**Important context — TanStack Query is in-memory only.** No `persistQueryClient` is configured (verified in `apps/web/src/app/providers/app-providers.tsx:12`), so each fresh page load constructs a new `QueryClient` with empty cache. This means the version-bump's value for **the immediate #423 bug** is *secondary* — any deploy that triggers a hard-refresh on the operator's browser already resets the cache. The version-bump's primary value is for **future schema changes**:

1. Operators who keep a long-running SPA session across multiple deploys (no full page reload between bundles).
2. Future schema additions where we want the bump to be the deliberate cache-busting tool, not "hope they refresh."

The strict serializer throw (§4.1) is the *runtime* backstop that catches the case where neither (1) nor (2) helps.

### 4.3 Why throw, not warn

Three reasons to escalate from `console.error + skip` to `throw`:

1. **The bug is high-impact.** Silent mis-routing produces an offer-creation 422 at the very last step of a multi-step wizard — terrible operator UX, hard to diagnose without sandbox access. Throwing surfaces immediately in the wizard's submit handler.
2. **The version key makes the throw unreachable in well-behaved deploys.** Once the queryKey includes the schema version, every cache hit is guaranteed-current. The throw becomes a strict-mode assertion that catches future regressions (e.g., someone forgets to bump the version after adding a new required field).
3. **The throw is recoverable from the operator's side.** The wizard's submit handler shows a toast/alert; operator hard-refreshes; cache busts; flow resumes. Better than a silent 422 they can't act on.

### 4.4 Where the throw is caught

The wizard's submit flow has a single call site for `serializeAllegroParameters`: **`apps/web/src/features/listings/components/CreateOfferWizard.tsx:472`**, inside the `onSubmit = form.handleSubmit(async (values) => { … })` block. The serializer call sits *before* the existing `try/catch` that surrounds the `mutation.mutateAsync(...)` call (lines 496-509), so an unhandled throw would propagate out of `handleSubmit` rather than landing in the existing error UI.

The fix wraps the serializer call in its own `try/catch` block and routes the typed error to a **distinct local-state Alert** — separate from the existing `mutation.error` Alert (line 532-534) so operators can tell "wizard data is stale" apart from "API call failed":

```typescript
const [staleSchemaError, setStaleSchemaError] = useState<string | null>(null);

const onSubmit = form.handleSubmit(async (values) => {
  setStaleSchemaError(null); // clear on every submit attempt

  let serialized: SerializedParameters;
  try {
    serialized = serializeAllegroParameters(
      (values.parameters as CategoryParameterFormValues | undefined) ?? {},
      categoryParameters,
    );
  } catch (error) {
    if (error instanceof MissingCategoryParameterSectionError) {
      setStaleSchemaError(error.parameterName); // operator-facing message rendered below
      return; // don't proceed to mutation
    }
    throw error; // anything else is a real bug — let it surface
  }

  // … rest of submit flow uses `serialized.offerParameters` / `serialized.productParameters`
});
```

**Pinned operator-facing alert copy** (rendered when `staleSchemaError !== null`):

> **Title:** "Wizard data is out of date"
>
> **Body:** "Category parameter `{parameterName}` is missing data that was added in a recent update. Please reload this page to refetch the latest category schema. **Reloading will discard your in-progress wizard values** — copy the offer title, price, and any filled fields before refreshing if you want to preserve them."
>
> **Action:** primary button "Reload now" → `window.location.reload()`; secondary button "Dismiss" → `setStaleSchemaError(null)`.

The "discards in-progress values" warning is important: form state lives outside the TanStack Query cache, so a reload empties everything the operator has typed.

## 5. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `apps/web/src/features/listings/components/serialize-allegro-parameters.ts` | (a) Add a `MissingCategoryParameterSectionError` class (export it; constructor takes `parameterId: string, parameterName: string`; both stored as `public readonly` so the wizard catch can drop them into UI copy without re-parsing the message). (b) Replace the `else` branch with explicit `else if (param.section === 'offer')` + `else { throw }`. (c) Update the file header to reference #423 and explain the strict branching. | Serializer throws on missing `section` with typed error carrying both ids; passes existing tests that cover `'offer'` and `'product'` branches. |
| 2 | `apps/web/src/features/listings/api/listings.types.ts` (constant) + `apps/web/src/features/listings/api/listings.query-keys.ts` (consumer) | (a) Export `CATEGORY_PARAMETERS_SCHEMA_VERSION = 2` from `listings.types.ts`, placed immediately above the `CategoryParameter` interface, with the doc-comment block from §4.2 (bump-protocol + bump history). (b) Import the constant in `listings.query-keys.ts` and inject into the `categoryParameters` queryKey factory at index 2: `['listings', 'categoryParameters', CATEGORY_PARAMETERS_SCHEMA_VERSION, connectionId, categoryId]`. | New queryKey includes the version constant; old browser caches auto-bust on deploy; co-located doc-comment guides future bumps. |
| 3 | `apps/web/src/features/listings/components/serialize-allegro-parameters.test.ts` | Add two new tests: (a) throws `MissingCategoryParameterSectionError` when a parameter has `section: undefined`; (b) throws when `section` is an unrecognized string. Both tests use a `// @ts-expect-error` pragma above the offending property assignment with the comment `simulating a stale-cached response that violates the CategoryParameter type contract — the runtime throw is the backstop for this case`. Assertions verify `error instanceof MissingCategoryParameterSectionError`, `error.parameterId === 'p_marka'`, `error.parameterName === 'Marka'`. Existing 'offer' / 'product' branch tests stay green. | All branches covered; thrown error is the typed class with correct `parameterId` + `parameterName`; type-system intent is explicit via `@ts-expect-error`. |
| 4 | `apps/web/src/features/listings/components/CreateOfferWizard.tsx` (line 472, inside `onSubmit = form.handleSubmit(...)`) | (a) Add `const [staleSchemaError, setStaleSchemaError] = useState<string | null>(null)` to the wizard's local state. (b) At submit-handler entry, `setStaleSchemaError(null)`. (c) Wrap the `serializeAllegroParameters(...)` call in a `try/catch` per §4.4 — on `MissingCategoryParameterSectionError` catch, set `staleSchemaError` to `error.parameterName` and `return` early; rethrow anything else. (d) Render a new `<Alert tone="error" title="Wizard data is out of date">` between the existing `mutation.error` Alert (line 532-534) and the rest of the form, with the operator-facing copy from §4.4 — including the "**Reloading will discard your in-progress wizard values**" warning. The Alert exposes a primary action `Reload now` (calls `window.location.reload()`) and a secondary `Dismiss` (clears `staleSchemaError`). | Operator gets an actionable error distinct from server-side mutation errors; refresh resolves the cache-staleness root cause; in-progress form state loss is signposted. |
| 5 | `apps/web/src/features/listings/api/listings.query-keys.test.ts` (new, or extend existing) | One unit test asserting the queryKey shape: `expect(listingsQueryKeys.categoryParameters('c1', 'cat1')).toEqual(['listings', 'categoryParameters', CATEGORY_PARAMETERS_SCHEMA_VERSION, 'c1', 'cat1'])`. Catches accidental queryKey shape changes (including someone moving the version from index 2). | QueryKey contract is pinned by a test. |
| 6 | All — quality gate | `pnpm lint`, `pnpm type-check`, `pnpm test`. | Clean. |
| 7 | Manual sandbox repro — **hard merge gate** | After deploying, the same sandbox flow that surfaced this on 2026-04-27 (cat 257933, Canon variant) must reach `active`/`validating` (modulo the unrelated `TOO_SMALL_IMAGE` blocker tracked in #424 — that's outside #423's scope). The operator does NOT need to manually clear cache: the version bump auto-busts on next page load, and TanStack Query's in-memory cache resets on any fresh app mount anyway. | Sandbox round-trip submits with `body.productSet[0].product.parameters[]` containing Marka (`248811`); no `ParameterCategoryException`. The `TOO_SMALL_IMAGE` 422 from #424 is *acceptable evidence* that #423 itself is structurally validated — Allegro got past parameter routing to image validation. |

## 6. Tests-of-record

- **Serializer spec** — adds 2 branches (`section: undefined`, `section: 'unrecognized'`); existing 13+ branches stay green.
- **QueryKey spec** — pins the queryKey shape so future changes are deliberate.
- **No new integration test** — the bug is FE-pure; existing E2E coverage of offer creation continues to exercise the happy path.

## 7. Validation

- **FE architecture compliance** — change is purely inside `apps/web/src/features/listings/`; no `shared` ↔ `features` boundary crossing introduced; no new dependency directions. ✅
- **Naming** — `MissingCategoryParameterSectionError` matches the project's `*Error` convention. `CATEGORY_PARAMETERS_SCHEMA_VERSION` is `UPPER_SNAKE_CASE` per engineering-standards.md. ✅
- **Headers** — existing files keep their headers; updates note #423. ✅
- **Tests** — co-located `*.test.ts` per FE rules. ✅
- **Type contract** — preserves `CategoryParameter.section` as required (no change to CORE). The throw is a runtime assertion of the static contract. ✅
- **Logging** — frontend has no `Logger` wrapper; the throw IS the observability mechanism (it surfaces in the wizard UI + browser devtools). FE rules do not require a structured logger here. ✅
- **No backwards-compat shim** — version key bump is a one-time hard cache-bust; we do NOT keep a fallback path for old `section`-less responses. ✅
- **Migrations** — none. ✅

## 8. Risks & open questions

- **The throw might surface in places we haven't enumerated.** `serializeAllegroParameters` is called only inside the wizard's submit flow today (per the codebase grep). If a future caller invokes it without try/catch, the throw will propagate. Acceptable — that's the point. The error class is exported so future callers can choose to handle it.
- **Cache-version bump is a one-shot tool.** Bumping the constant from `2` to `3` next time costs nothing; the doc-comment in step 2 explains the protocol. The risk is forgetting to bump on a future schema change — the strict serializer throw is the backstop that catches it.
- **The wizard's existing submit handler may already swallow errors.** §5 step 4 needs to verify that the error surfaces visibly; if there's a generic `catch (error) { ... }` that maps everything to a toast, the typed error needs explicit handling there.
- **TanStack Query staleTime semantics.** Even with version-key-busted cache, `staleTime: 24h` means within a session the response is reused. That's fine — the serializer throw is the tripwire if something drifts mid-session. We are not shortening `staleTime`.

## 9. Out of scope (explicitly deferred)

- Backend cache invalidation (it's already correct; this is a browser-cache issue).
- Operator-facing "your wizard data is stale, click to refresh" banner outside the submit-error path. The submit error covers the only path where stale data manifests; pre-emptive UX is not justified yet.
- Generalized "schema-version key" for other queries. `categoryParameters` is the one query whose response shape we know has evolved; introducing a generalized pattern is premature.
