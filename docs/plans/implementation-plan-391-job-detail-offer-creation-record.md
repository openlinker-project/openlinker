# Implementation Plan — #391 Part A: Surface `OfferCreationRecord` on the Job detail page

## Goal

When a `marketplace.offer.create` sync job is rendered on the Job detail page,
load and display the linked `OfferCreationRecord` so the operator can see the
actual business outcome — rather than just the green "succeeded" badge that
hides terminal platform rejections (e.g. validation errors from Allegro).

This is **Part A only** per the issue body. Part B (changing what
`succeeded` means at the job-runner level) is an explicit non-goal here —
the issue body recommends "ship A first; align on B before changing runner
contract."

## Layer classification

Frontend only. No BE/CORE/DB work.

## Discovery — what already exists (don't rebuild)

The investigation showed the entire stack is already in place:

| Layer | What | Where |
|---|---|---|
| BE endpoint | `GET /listings/connections/:connectionId/offers/creation/:recordId` returning `OfferCreationStatusResponseDto` | `apps/api/src/listings/http/listings.controller.ts:221-239` |
| FE API wrapper | `getOfferCreationStatus(connectionId, recordId)` | `apps/web/src/features/listings/api/listings.api.ts:91-95` |
| FE types | `OfferCreationStatusResponse`, `OfferCreationStatus`, `TERMINAL_OFFER_CREATION_STATUSES`, `OfferCreationError` | `apps/web/src/features/listings/api/listings.types.ts:82-145` |
| FE query hook | `useOfferCreationStatusQuery(connectionId, recordId)` (polls until terminal) | `apps/web/src/features/listings/hooks/use-offer-creation-status-query.ts` |
| FE panel | `OfferCreationTracker` — header (label + status badge + ID + optional Retry/Dismiss), body text per status, error list on `failed` | `apps/web/src/features/listings/components/OfferCreationTracker.tsx` |
| FE pieces | `OfferCreationStatusBadge`, `OfferCreationErrorList` | `apps/web/src/features/listings/components/` |

**The only thing missing is the wiring on the Job detail page**, plus one
tiny gap in the `JobType` union and a small affordance on the existing
Tracker so it can be rendered without session-scoped Dismiss/Retry actions.

## Non-goals

- **Part B** of #391 — changing job runner success/failure semantics. Explicitly deferred.
- **A new dedicated panel component** mirroring `OfferCreationTracker`. The existing Tracker covers the layout the issue body asks for; rebuilding would duplicate the rendering logic and the test surface. Reuse > parallel build.
- **A retry-from-job-detail flow.** Retrying offer creation already lives on the listings list-page session tracker. Adding it here mixes lifecycle concerns and is out of scope per the issue body's Part A.
- **A "view created listing" deep link** when status is `active`. The Tracker shows the external offer ID as text today; that matches how it renders on the listings page. A linked variant can ship later.

## Implementation steps

### 1. Add `marketplace.offer.create` to the `JobType` union

**File:** `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts:25-37`

Currently `JOB_TYPE_VALUES` lists five values; `'marketplace.offer.create'`
is missing. Add it. The existing `'marketplace.offer.updateFields'` entry
has a comment marking it as "internal job, not user-triggerable, listed for
status display only" — same applies here. No new comment needed since
the new type *is* user-triggerable from the Create-Offer wizard.

**Acceptance:** `JobType` union now includes `'marketplace.offer.create'`. Build passes.

### 2. Make `onDismiss` optional on `OfferCreationTracker`

**File:** `apps/web/src/features/listings/components/OfferCreationTracker.tsx`

Two changes:
- `onDismiss: () => void` → `onDismiss?: () => void`
- The two `<Button onClick={onDismiss}>Dismiss</Button>` sites (lines 65-67 and 108-112) become conditional on `onDismiss !== undefined`, mirroring the existing `canRetry` pattern.

This is a backward-compatible refactor. The single existing call site on
the listings list-page passes `onDismiss` and continues to work. The new
Job-detail call site omits it.

**Acceptance:** Tracker renders with no Dismiss button when `onDismiss` is undefined. Existing call site still gets the button. Co-located test (`OfferCreationTracker.test.tsx`) extended with one case asserting button absence when prop is undefined.

### 3. Render the Tracker on the Job detail page when applicable

**File:** `apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx`

When `job.jobType === 'marketplace.offer.create'`:
1. Safely parse `job.payloadJson` for the `offerCreationRecordId` field. The payload is a JSON string serialized by the worker enqueue path. Wrap `JSON.parse` in try/catch — return `null` on any parse error or if the field is absent / not a string.
2. Use `job.connectionId` (already on the `SyncJob` entity) for the API call. Don't trust the payload's `connectionId` for this — the job entity is canonical.
3. If the record ID is present, render the Tracker without `onDismiss`/`onRetry`:
   ```tsx
   <section className="detail-section">
     <OfferCreationTracker
       connectionId={job.connectionId}
       offerCreationRecordId={recordId}
     />
   </section>
   ```
4. If the record ID is absent (orchestrator threw before record creation, or older payload schema, or non-JSON payload), render nothing — matches AC3 ("gracefully shows nothing rather than crashing").

Place the new section between the existing key-value list (line 122) and the "Last error" / "Payload" sections (line 124+), so the offer-creation status sits next to the job metadata and above the raw debugging surfaces.

**Helper:** Extract `extractOfferCreationRecordId(job: SyncJob): string | null` as a small pure function in the same file (or a colocated `*.utils.ts` if the file gets unwieldy — a single helper inline is fine for now). Keeps the JSON-parse + type-guard logic out of the JSX and unit-testable.

**Acceptance:**
- For a `marketplace.offer.create` job whose payload contains `offerCreationRecordId`, the page renders the Tracker section.
- For the same job type with a payload missing the field, the page renders without the Tracker section and without throwing.
- For any other `jobType`, the page renders unchanged.
- For a payload that is not valid JSON, the page renders without the Tracker and without throwing.

### 4. Tests

**File:** `apps/web/src/pages/sync-jobs/sync-job-detail-page.test.tsx`

Three new cases (all using `renderWithProviders` + `createMockApiClient` per the FE testing convention):

- `marketplace.offer.create` job + payload with `offerCreationRecordId` → Tracker renders, mock `getOfferCreationStatus` returns a `failed` record, `OfferCreationErrorList` content appears on the page.
- `marketplace.offer.create` job + payload missing the field → Tracker section not rendered.
- `marketplace.offer.create` job + payload that is invalid JSON → Tracker section not rendered, no throw.

**File:** `apps/web/src/features/listings/components/OfferCreationTracker.test.tsx`

One new case:
- Tracker renders without Dismiss button when `onDismiss` is omitted.

The existing OfferCreationTracker tests cover the with-Dismiss path; the new case asserts the optional-prop branch.

## Edge cases to confirm in tests

- **Payload is `null` / empty string** — already covered by AC3.
- **Record ID is a non-string value** (e.g. a number, accidentally) — type guard rejects it.
- **`connectionId` on the job is empty / falsy** — possible? Unlikely (the SyncJob entity requires it), but the API call simply 404s if invalid; the Tracker's existing error path already handles this without crashing.

## Validation

- **Architecture:** stays inside FE; no BE/CORE work; no port contracts touched. Frontend dependency direction obeyed: pages → features → shared. The Job detail page imports the Tracker from `features/listings/components/`, which is a cross-feature import — already permitted by the codebase convention (`ListingDetailPage` already imports `ConnectionEntityLabel` from `features/connections/`).
- **State ownership:** Tracker's existing query hook lives in `features/listings/hooks/`. URL state, form state, and session state are not involved.
- **Naming:** existing files; no new ones unless the helper extraction in step 3 grows.
- **No `any`, no `console.log`, no hardcoded secrets, no migration**. ✅
- **Testing convention:** colocated `*.test.tsx`, `renderWithProviders`, `createMockApiClient` (per `.claude/rules/fe-pages.md`).

## Risks

- **Tracker repurposing has a polling side-effect.** The existing `useOfferCreationStatusQuery` polls until terminal status. Rendering it on the Job detail page means as long as the user keeps the page open, it'll keep polling for non-terminal records. This is consistent with the existing tracker behaviour on the listings page and is not a regression — but worth noting. If a stop-when-page-not-focused optimisation is wanted later, that's a follow-up to the hook, not this issue.
- **`payloadJson` schema drift.** If a future change to the `marketplace.offer.create` payload renames `offerCreationRecordId`, the Tracker silently disappears from the Job detail page. Acceptable for this issue (graceful degrade matches AC3); the type-safety story for FE access to the payload is its own backlog item.

## Files expected to change

**Production (3):**
- `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts` — extend `JOB_TYPE_VALUES`
- `apps/web/src/features/listings/components/OfferCreationTracker.tsx` — make `onDismiss` optional
- `apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx` — render Tracker conditionally

**Tests (2):**
- `apps/web/src/pages/sync-jobs/sync-job-detail-page.test.tsx` — three new cases
- `apps/web/src/features/listings/components/OfferCreationTracker.test.tsx` — one new case

## Quality gate

```
pnpm lint
pnpm type-check
pnpm test
```

All three must pass. No backend changes → no migration check needed.
