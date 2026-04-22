# Implementation Plan — Retry affordance on failed OfferCreationTracker (#307)

## 1. Task restatement

When an OL-initiated offer creation lands in `failed`, the `OfferCreationTracker` surfaces structured errors and a "Dismiss" button. Today, the operator's only next step is to re-open `CreateOfferWizard` and re-type every field from scratch. Issue #307 proposes a **"Retry"** button that:

1. Opens `CreateOfferWizard` with `defaultConnectionId` set to the failed record's `connectionId`.
2. Pre-fills the form from the **original request payload** stored on the record.
3. Jumps the operator past Step 1 so they don't re-pick connection + variant.
4. Generates a **new idempotency key** — retry is a genuinely new creation attempt, not a re-run of the old record.

**Layer:** full-stack vertical slice.
- CORE / listings: persist `request` on `OfferCreationRecord` (ORM column + domain field + DTO field).
- Migration: add `request` jsonb column to `offer_creation_records`.
- Frontend: Retry button in tracker, wizard pre-fill from the persisted request, list-page wiring.

**Explicit non-goals**
- **Not** re-running the same job. The old record's sync job is terminal; retry enqueues a fresh one.
- **Not** linking the new record to the old. If that becomes valuable for audit later, it's a separate issue.
- **Not** partial pre-fill. Full request payload goes back into the form; the operator edits whatever was wrong.
- **Not** the Allegro category picker (#305 separately). If `categoryId` was the failure, operator edits the free-text as today.

## 2. Codebase research

- `libs/core/src/listings/domain/entities/offer-creation-record.entity.ts` — domain entity, readonly shape.
- `libs/core/src/listings/domain/types/offer-creation-record.types.ts` — `OfferCreationStatus`, `CreateOfferCreationRecordInput`, `OfferCreationError`.
- `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts` — TypeORM entity.
- `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts` — private `toDomain` / `buildOrmEntity` mappers.
- `libs/core/src/listings/application/services/offer-creation-enqueue.service.ts` — already passes `internalVariantId`, `connectionId`, `publishImmediately` to the record. Needs to also pass the full request.
- `apps/api/src/listings/http/dto/offer-creation-status-response.dto.ts` — response DTO to extend.
- `apps/api/src/listings/http/dto/create-offer.dto.ts` — the canonical `CreateOfferRequest` shape on the wire.
- `apps/api/src/migrations/1784000000000-add-offer-creation-records-table.ts` — reference migration pattern for this table.
- Frontend: `apps/web/src/features/listings/components/OfferCreationTracker.tsx`, `CreateOfferWizard.tsx`, `create-offer-fields.schema.ts`, `api/listings.types.ts`, `hooks/use-offer-creation-status-query.ts`, `pages/listings/listings-list-page.tsx`.

Existing idempotency behaviour in `CreateOfferWizard.tsx:94,113`: a stable `idempotencyKeyRef` is generated on every wizard open via `crypto.randomUUID()` and reused until close. Because **Retry opens the wizard fresh**, this already satisfies acceptance bullet 4 ("fresh idempotency key") for free — no wizard changes needed on that axis.

## 3. Design

### Backend

**3.1 New domain snapshot type (not the wire type)**
Introduce a **domain-owned** `OfferCreationRequestSnapshot` in `libs/core/src/listings/domain/types/offer-creation-request-snapshot.types.ts`. Structurally identical to the wire `CreateOfferRequest` today, but owned by the listings domain so wire-shape drift (new `class-validator` decorators on the controller DTO, request-shape renames, etc.) stops at the DTO boundary unless the domain explicitly adopts the change.

The domain entity gains `request: OfferCreationRequestSnapshot | null`. The HTTP DTO (`CreateOfferRequestDto`) and the FE transport type stay where they are; the enqueue service builds a `Snapshot` from its existing `EnqueueOfferCreationInput` fields before handing it to the repo.

*Why not move `CreateOfferOverrides` / `CreateOfferPrice` with it?* They already live in `@openlinker/core/integrations` and are used by `MarketplaceOfferCreatePayloadV1` in `@openlinker/core/sync`. Moving them into `listings` would create a reverse dependency (`integrations` → `listings`), which violates layer direction. The snapshot type imports `CreateOfferOverrides` from integrations (one-way, fine) rather than owning it.

*Why a blob, not first-class columns?* Two defensible options: (a) jsonb blob that mirrors the wire aggregate; (b) promote `stock` / `title` / `categoryId` / `description` / `price` / platform-param IDs to first-class columns on `offer_creation_records`. Picking (a) for three reasons — lower migration cost (one column, one additive migration, not seven), wire-shape flexibility (FE wizard / API DTO can evolve without schema churn since it's "debug-only"), no operational query against these fields planned. The downside (no ad-hoc querying on inner fields, no column-level nullability constraints) is acceptable for a retry-prefill payload that's treated as opaque debug state.

**3.2 Schema versioning**
The stored blob includes `schemaVersion: 1` as its first field, matching the precedent set by `MarketplaceOfferCreatePayloadV1` in `@openlinker/core/sync`. Readers (the retry-prefill path) check the version and treat unknown versions as "unknown shape; degrade to minimal pre-fill". Cheap to add now, retroactively hard. The `OfferCreationRequestSnapshot` type declares `schemaVersion: 1 as const` so TS catches bumps at compile time.

**3.3 Persistence**
- Add `request` jsonb nullable column to `offer_creation_records`.
- Migration: additive, no backfill. Existing rows have `request IS NULL`. Retry button degrades gracefully when the record predates this change (still opens the wizard, pre-fills only `connectionId` + `internalVariantId` from the record itself).
- Repository `buildOrmEntity` writes `input.request ?? null`. `toDomain` reads it back. No new queries.

**3.4 Application**
- `OfferCreationEnqueueService.enqueueCreation(input)` — `EnqueueOfferCreationInput` already carries `stock`, `price`, `overrides`, `publishImmediately`, `internalVariantId`. Assemble a `OfferCreationRequestSnapshot` (with `schemaVersion: 1`) from those fields and pass it to `offerCreationRecords.create({ ...existingFields, request })`. No new inputs on the controller side.

**3.5 Interface**
- `OfferCreationStatusResponseDto` gains `request?: OfferCreationRequestPayloadDto | null` — a **new response-shape DTO** colocated with the response DTO, with `@ApiProperty` annotations but **no `class-validator` decorators** (responses don't validate inbound input). Reusing `CreateOfferRequestDto` (the request DTO with `@IsString` / `@IsNotEmpty` etc.) on a response is mildly awkward because those decorators are dead weight on the outbound path. Separate response DTO keeps the two roles tidy. Swagger description: "debug-only; original request payload when available; may be omitted for records predating 2026-04-22".

### Frontend

**3.6 Tracker**
`OfferCreationTracker` takes a new optional `onRetry?: (record: OfferCreationStatusResponse) => void` prop. When `status === 'failed'` **and** `onRetry` is provided, render a "Retry" Button next to "Dismiss". Click → `onRetry(record)`. If `onRetry` is absent, behaviour is unchanged (backward-compatible). The prop is intentionally designed to work on **any tracker consumer** — the listing-detail page's offer-creation surface shipped in #306 is a deliberately-deferred second consumer (covered in §7, not in this PR's scope).

**3.7 Wizard**
`CreateOfferWizard` gains one optional prop: `initialValues?: CreateOfferRequest`. When present, the existing open-reset effect (which already sets `idempotencyKeyRef.current = crypto.randomUUID()` and resets the form) also maps `initialValues` into `CreateOfferFieldsValues` and uses that as the form's reset target instead of `CREATE_OFFER_DEFAULT_VALUES`. Start at `stepIndex = 1` (Step 2 "Offer details") when `initialValues` is provided, with Steps 0 and 1 marked completed — the operator can still click back.

*Step-choice trade-off.* Two defensible landing points:
- **Step 2** (picked): most failures today are field-validation errors on title/category/price, all of which live on Step 2. Operator lands on the fixable surface. Steps 3–4 stay incomplete (operator clicks Next through them).
- **Step 4 Review** (alternative): every field is pre-filled and valid per the schema, so the payload is by definition in "about to resubmit" state. Opening on Review lets the operator inspect and hit Save in one click.

Step 2 wins for the common case — the reason they're here is *something needs to change*, and Review isn't a fixing surface. If real operator data later shows that wasn't the issue (e.g., failures cluster on Step 3 policy mismatches), revisit. Marking Step 3 not-completed is an honest signal that the policy fields haven't been re-confirmed.

Mapping `CreateOfferRequest` → `CreateOfferFieldsValues` lives in a small pure function `createOfferRequestToFormValues(request)` next to the wizard. Unit-tested. Handles price (number → string), `overrides.platformParams.{deliveryPolicyId,returnPolicyId,warrantyId,impliedWarrantyId}`, and nullable description.

**3.8 List page wiring**
`ListingsListPage` owns the retry glue:
- `handleRetry(record)`: set local state `retryInitialValues = record.request`, `retryDefaultConnectionId = record.connectionId`, `setIsWizardOpen(true)`, and `dismissTracker()` (the old failed record is done with — the new tracker will take its place on success).
- Pass those as wizard props.
- On successful submit, the new record pushes a fresh `offerCreationRecordId` into search params via existing `handleOfferSubmitted`.

## 4. Step-by-step plan

### Step 1 — Domain snapshot type (backend)
- **File:** `libs/core/src/listings/domain/types/offer-creation-request-snapshot.types.ts` (new)
- Declare `OfferCreationRequestSnapshot` with a `schemaVersion: 1` literal as its first field and fields mirroring the current `CreateOfferRequest` wire aggregate. Imports `CreateOfferOverrides` from `@openlinker/core/integrations` (stays where it is).
- Re-export from `libs/core/src/listings/index.ts`.
- **Acceptance:** type-check passes; no changes to `@openlinker/core/integrations`.

### Step 2 — Domain entity + input type
- **Files:**
  - `libs/core/src/listings/domain/entities/offer-creation-record.entity.ts`
  - `libs/core/src/listings/domain/types/offer-creation-record.types.ts`
- Add readonly `request: OfferCreationRequestSnapshot | null` to the constructor.
- Add optional `request?: OfferCreationRequestSnapshot | null` to `CreateOfferCreationRecordInput`.
- **Acceptance:** entity constructor accepts the new field; input type accepts it optionally.

### Step 3 — ORM entity + migration
- **Files:**
  - `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts`
  - `apps/api/src/migrations/{timestamp}-add-offer-creation-record-request-payload.ts` (new, generated via `pnpm --filter @openlinker/api migration:generate`)
- Add `@Column({ type: 'jsonb', nullable: true }) request!: CreateOfferRequest | null`.
- Migration: `ALTER TABLE "offer_creation_records" ADD COLUMN "request" jsonb`. No index.
- **Acceptance:** `pnpm --filter @openlinker/api migration:generate` produces the migration; `migration:run` + `migration:revert` round-trip cleanly.

### Step 4 — Repository round-trip
- **Files:**
  - `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts`
  - `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.spec.ts`
- `buildOrmEntity` assigns `entity.request = input.request ?? null`.
- `toDomain` passes `entity.request` through.
- Add a spec case: `create({ ...input, request })` → `findById` returns the same snapshot including `schemaVersion`.
- **Acceptance:** repo spec passes.

### Step 5 — Enqueue service stores the snapshot
- **Files:**
  - `libs/core/src/listings/application/services/offer-creation-enqueue.service.ts`
  - `libs/core/src/listings/application/services/__tests__/offer-creation-enqueue.service.spec.ts`
- Construct `request: OfferCreationRequestSnapshot` (with `schemaVersion: 1`) from the existing `EnqueueOfferCreationInput` fields and pass it to `offerCreationRecords.create({ ...existing, request })`.
- Update spec: assert the repo's `create` receives the full snapshot payload with the correct `schemaVersion`.
- **Acceptance:** spec passes.

### Step 6 — Response DTO + controller mapping
- **Files:**
  - `apps/api/src/listings/http/dto/offer-creation-request-payload-response.dto.ts` (new — response-shape sibling of `CreateOfferRequestDto`, without `class-validator` decorators)
  - `apps/api/src/listings/http/dto/offer-creation-status-response.dto.ts`
  - `apps/api/src/listings/http/listings.controller.ts` (the mapper from domain record → response DTO)
  - `apps/api/src/listings/http/listings.controller.spec.ts`
- Define `OfferCreationRequestPayloadDto` with `@ApiProperty` / `@ApiPropertyOptional` only (no validators — responses don't validate).
- Add optional `request?: OfferCreationRequestPayloadDto | null` to `OfferCreationStatusResponseDto`, Swagger-annotated as "debug-only; original request payload when available; may be omitted for records predating this change".
- Controller mapper passes `record.request` through.
- Controller spec asserts the field round-trips, including `schemaVersion`.
- **Acceptance:** controller spec passes; Swagger renders the new field as nullable.

### Step 7 — Frontend API types
- **File:** `apps/web/src/features/listings/api/listings.types.ts`
- Add `request?: CreateOfferRequest | null` to `OfferCreationStatusResponse`. The FE type keeps its existing `CreateOfferRequest` structural shape (no `schemaVersion` surfaced to the FE — the FE treats unknown-version payloads identically to null, see §3.2).
- **Acceptance:** type-check passes; existing consumers (tracker, detail page, etc.) unaffected.

### Step 8 — Wizard accepts `initialValues` + jumps to Step 2
- **Files:**
  - `apps/web/src/features/listings/components/CreateOfferWizard.tsx`
  - `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx`
  - `apps/web/src/features/listings/components/create-offer-request-to-form-values.ts` (new small pure helper) + `.test.ts`
- Add `initialValues?: CreateOfferRequest` prop.
- In the open-reset effect, when `initialValues` is set:
  - Compute `values = createOfferRequestToFormValues(initialValues)` merged with `connectionId` from `defaultConnectionId`.
  - `form.reset(values)`, `setStepIndex(1)`, `setCompletedSteps(new Set([0, 1]))`.
  - Also pre-select the product panel (`selectedProductId`) from the variant id so Step 1 shows the correct state if the operator steps back.
- **Acceptance:**
  - Helper spec round-trips a minimal request and a fully-populated one.
  - Wizard spec: opening with `initialValues` renders Step 2 with title/price/category/stock populated from the payload and delivery policy selected on Step 3.
  - **Explicit idempotency-key regression test** (per issue acceptance bullet 4): render the wizard, submit once (mutation fires with key-A), close, reopen with `initialValues` and submit again → assert the second submit's `idempotencyKey` differs from key-A. Guards against a future refactor silently reusing the ref across opens.
  - Existing wizard tests still pass.

### Step 9 — Tracker Retry button
- **Files:**
  - `apps/web/src/features/listings/components/OfferCreationTracker.tsx`
  - `apps/web/src/features/listings/components/OfferCreationTracker.test.tsx`
- Add optional `onRetry?: (record: OfferCreationStatusResponse) => void` prop.
- Render a secondary Button labelled "Retry" next to "Dismiss" only when `record.status === 'failed'` **and** `onRetry` is provided.
- Click → `onRetry(record)`.
- **Acceptance:**
  - Spec: failed + `onRetry` set → Retry button present, clicking invokes `onRetry(record)`.
  - Spec: failed + `onRetry` absent → no Retry button (backward compat).
  - Spec: active/pending → no Retry button.

### Step 10 — List page wiring
- **Files:**
  - `apps/web/src/pages/listings/listings-list-page.tsx`
  - `apps/web/src/pages/listings/listings-list-page.test.tsx` (if present; otherwise a minimal test alongside, following the existing pattern in the file)
- Add local state `retryInitialValues` + `retryDefaultConnectionId`.
- `handleRetry(record)`: set the two state fields, `setIsWizardOpen(true)`, `dismissTracker()`.
- Pass `onRetry={handleRetry}` to the tracker and `initialValues={retryInitialValues} defaultConnectionId={retryDefaultConnectionId ?? connectionIdInput}` to the wizard.
- Clear `retryInitialValues` / `retryDefaultConnectionId` on wizard close.
- **Acceptance:** integration-style test: render page → inject a failed record via the mock API → click Retry → wizard opens with Step 2 visible and title pre-filled from the record's request.

### Step 11 — Quality gate + ship
- `pnpm lint` (repo-wide, zero errors)
- `pnpm type-check` (zero errors)
- `pnpm test` (all unit tests)
- `pnpm --filter @openlinker/api migration:show` — confirms only this migration is pending
- Commit (`feat(listings):`), push, PR with `Closes #307`.

## 5. Testing strategy

**Coverage per layer**:
- Domain: entity constructor trivially holds the new field (implicit).
- Application: enqueue service spec asserts the request is forwarded to the repo.
- Infrastructure (repo): round-trip spec persists + reads the request.
- Interface (controller): response includes the request field; Swagger includes it.
- FE helper (`createOfferRequestToFormValues`): pure-function spec.
- FE tracker: renders/omits Retry button per status + prop.
- FE wizard: pre-fills form and lands on Step 2 when `initialValues` is provided.
- FE list page: clicking Retry opens a pre-filled wizard.

Integration tests: **not required**. This is a schema addition with no new query paths; the existing Testcontainer harness covers the table already. If we wanted paranoid confidence we could add an `offer-creation-record.int-spec.ts`, but the unit-level round-trip spec plus the migration's up/down paths cover the risk.

## 6. Validation (architecture + standards)

- **Hexagonal:** new `request` field sits in a domain snapshot type → ORM entity → repo mapping → enqueue service. No port exposes infrastructure error types. No cross-layer shortcuts. `CreateOfferOverrides` stays in `@openlinker/core/integrations` (listings imports from integrations, never the reverse).
- **Naming:** new file `offer-creation-request-snapshot.types.ts` (domain types), new response DTO `offer-creation-request-payload-response.dto.ts`, new FE helper `create-offer-request-to-form-values.ts` (colocated with the wizard; small enough to skip a folder). All match convention.
- **TS strict mode:** `request` is `OfferCreationRequestSnapshot | null` on the domain side; `CreateOfferRequest | null` on the FE. Never `any`. `schemaVersion: 1 as const` enforces version awareness at the type level.
- **No new framework coupling in the domain layer:** the snapshot type is a plain interface; zero NestJS/TypeORM imports.
- **FE dependency direction:** unchanged. Tracker + wizard + list-page all stay within their existing layers.
- **Migration:** additive, nullable, down-safe (drops the column). Follows `docs/migrations.md`.
- **Security:** `CreateOfferRequest` carries offer content (title, description, price, stock) — no credentials or PII. Safe to store in jsonb.

## 7. Risks / trade-offs

- **Pre-existing records have `request = null`.** Retry button still renders and still opens the wizard, but with only `connectionId` and `internalVariantId` pre-filled. Graceful degradation; no code path errors. Once the new column is populated on all fresh records, this fades.
- **Schema-version evolution.** `schemaVersion: 1` gives us a clean migration path for future wire-shape changes: a future `v2` can ship alongside `v1` and the retry-prefill reader picks the right mapper. Readers that see an unknown `schemaVersion` degrade to null-like behaviour (minimal pre-fill) rather than crashing. This is the same contract as `MarketplaceOfferCreatePayloadV1` in `@openlinker/core/sync` — we're following, not inventing.
- **Domain snapshot vs wire type.** We chose a separate `OfferCreationRequestSnapshot` (domain-owned) instead of re-purposing the wire `CreateOfferRequest` directly on the entity. The two are structurally identical today; the separation enforces that a future wire-shape rename (new `class-validator` decorators, field additions) stops at the DTO boundary unless the domain explicitly adopts. Tiny up-front cost (one more type), large future-proofing upside.
- **Jsonb blob vs first-class columns.** Jsonb wins for migration cost + wire-shape flexibility; loses on queryability + column-level constraints. Payload is treated as opaque debug state — no ad-hoc queries planned — so jsonb is the right pick today. Revisit if operational needs emerge.
- **Start step on retry.** Step 2 (Offer details) is the MVP choice because most failures are field-validation errors on that step. Step 4 (Review) is the alternative — defensible if retries are a "nothing to change, resubmit" path, but that contradicts the premise of landing here from a failure. If operator data later shows Step-3 (policy) failures dominate, we'll revisit.
- **Deferred consumer: detail-page tracker.** #306 shipped an offer-creation status surface on the listing detail page. The `onRetry` prop on `OfferCreationTracker` is intentionally designed so it works on **any** consumer — but this PR wires the callback only on the list page to keep the change reviewable. A follow-up PR can pass `onRetry` from the detail page with no component changes. Called out in the PR description so reviewers don't read the gap as an oversight.
