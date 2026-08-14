# Implementation Plan: Persist and surface the auto-issue block reason

**Date**: 2026-08-14
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: [#2100](https://github.com/openlinker-project/openlinker/issues/2100)
**Branch**: `2100-persist-auto-issue-block-reason`, stacked on `2047-lock-order-to-issuing-connection` (PR #2060)

---

## 1. Task Summary

**Objective**: When `AutoIssueTriggerService` decides not to issue a fiscal document for a qualifying
order, persist a named reason on the order and surface it to the operator — instead of writing only a
log line.

**Context**: [ADR-041](../architecture/adrs/041-sales-document-routing-policy.md) decision 11 states the
visibility contract twice (§54, §105): a block is **never log-only**. Today all four non-issuing exits of
`onOrderTransition` `return` after logging. The only operator-facing surface is a client-side
re-derivation in the order-detail invoice panel, which models one of the four exits and can disagree with
what the backend actually did. An install where auto-invoicing silently stopped for *every* order looks
completely normal on `/orders` and `/invoices`.

These exits enqueue no job, so `sync_jobs.outcomeReason` has no row to carry the reason. It has to live on
the **order**, which is why #1689's `source_deleted` / `mappingFailureReason` is the precedent to clone.

**Classification**: CORE (domain value types + application write) + Infrastructure (migration) +
Interface (API read) + Frontend.

---

## 2. Scope & Non-Goals

### In Scope

- New `libs/core/src/sales-documents/` concern holding ADR-041 decision 11's two reason unions.
- `AutoIssueTriggerService.onOrderTransition` returns a block outcome; `OrderIngestionService` persists it.
- Two new nullable columns on `order_records` + migration.
- Level-triggered write (re-evaluated on every transition) and an explicit clear when an invoice is issued
  by hand.
- Orders API: new response field, new list filter, new non-partitioning count on the status summary.
- Web: list badge (desktop + mobile card), filter chip, order-detail invoice panel read, timeline
  narration.
- A `check:invariants` mirror guard for the FE copy of the reason union (lesson: *A hand-copied FE/BE
  literal union needs a `check:invariants` guard*).
- Docs: `architecture-overview.md` § Invoicing, ADR-041 decision-11 status note.

### Out of Scope

- ADR-041's rule engine, `SalesDocumentDecision` router, `SalesDocumentKind` — #1908-era work.
- Writing `unresolved-routing`, `missing-required-tax-id`, `tax-rate-conflict`. Declared only.
- Any change to *which* connection is selected — that is #2047 / PR #2060, which this branch sits on.

### Constraints

- `AutoIssueTriggerService` must gain **no** new DI dependency. Its ONE-WAY EDGE (F3) property is asserted
  by `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts` and was specifically checked in
  PR #2060's review.
- The write must be idempotent / level-triggered — `onOrderTransition` is level-evaluated (D3) and fires
  repeatedly for the same order.
- The persisted reason and every log line stay PII-clean: ids and neutral reason values only.
- Migration prefix must sort above `origin/main`'s max (`1833000000004`).

---

## 3. Architecture Mapping

**Target Layer**: CORE domain (value types), CORE application (evaluation + write), Infrastructure
(column + migration), Interface (DTO + controller), Frontend.

**Capabilities Involved**: none new. The block is decided before any `InvoicingPort` adapter is resolved.

**Existing Services Reused**

| Service | Role |
|---|---|
| `AutoIssueTriggerService` | Already computes every block condition; only its *return* changes. |
| `OrderIngestionService` | Already the sole caller of `onOrderTransition` and already writes `mappingFailureReason` via `IOrderRecordService`. |
| `IOrderRecordService` / `OrderRecordRepositoryPort` | The seam #1689 established for order-level operator facts. |
| `InvoicingController` | Already injects `IOrderRecordService` (`ORDER_RECORD_SERVICE_TOKEN`) — the manual-issue clear needs no new dependency. |

**New Components**

- `libs/core/src/sales-documents/` — `domain/types/sales-document-reason.types.ts` + barrel.
- `OrderRecordRepositoryPort.updateSalesDocumentBlock` + repository implementation.
- `IOrderRecordService.markSalesDocumentBlock`.
- `scripts/check-sales-document-reason-mirror.mjs`.
- Migration `1833000000005-add-order-record-sales-document-block.ts`.

**Core vs Integration Justification**: the block is a policy decision made entirely inside core, before
any adapter is resolved. No integration package is touched.

---

## 4. Research

### The four exits today (`auto-issue-trigger.service.ts`)

| Exit | Line | Condition | Is it a block? |
|---|---|---|---|
| `selection.kind === 'none'` | :155 | no active `Invoicing` connection | **No** — nothing to invoice with. Not a block. |
| `selection.kind === 'ambiguous'` | :158 | several candidates, no unambiguous primary | **Yes** → `ambiguous-connection-no-primary` |
| selected connection vanished | :188 | unreachable defensive branch | **No** — a defect, not an operator-facing state. Stays log-only. |
| `!qualifies(...)` — `manual` | :332 | trigger model is `manual` | **Yes** → `trigger-model-manual` |
| `!qualifies(...)` — `auto-on-*` not met | :312/:317 | order not paid / not shipped yet | **No** — "not yet", level-evaluated. |
| `batched` throws | :334 | `BatchedTriggerNotImplementedError` | **Yes** → `trigger-model-batched` |

Only three of the six produce a persisted reason. The `auto-on-*` not-yet cases are the reason the write
must be level-triggered rather than sticky: an unpaid order is not blocked, it is waiting.

### Precedent: `mappingFailureReason` (#1689)

Write chain: `OrderIngestionService` (`:330-344`) → `IOrderRecordService.markItemResolutionFailure` →
`OrderRecordRepositoryPort.updateItemResolutionFailure` → narrow `repository.update({ internalOrderId },
{ ... })`. Read chain: `toDomain` → `OrderRecord` → `OrdersController.toDto` → response DTO → FE
`orders.types.ts` → `order-health.ts`.

Two persistence sub-patterns exist on `order_records`, and the choice matters:

- `mappingFailureReason` **is** mapped in `toOrm` (`order-record.repository.ts:798`), so every `upsert()`
  resets it. That is how it self-heals.
- `cancelledAt` is deliberately **not** mapped in `toOrm` (`:801-810`), because `upsert()` is a full-object
  save with no lock around it and two ingestion paths legitimately race; a single atomic writer owns the
  column.

This plan follows the **`cancelledAt` pattern**. `persistOrder` runs at `order-ingestion.service.ts:346`,
*before* `onOrderTransition` at `:452`; round-tripping through `toOrm` would null the column and then
immediately re-set it on every ingestion, and would let a racing re-persist stomp a freshly written
reason. One atomic writer, called once per transition with the reason **or `null`**, is both simpler and
race-free — and makes the clear an explicit, testable code path rather than a side effect.

### The health partition is closed

`order-record.types.ts:39-65` declares `OrderHealthValues` the canonical precedence with SQL twins
(`countByHealth`, `applyHealthFilter`) and a FE twin (`deriveOrderHealth`). `deriveOrderHealth` returns
exactly one bucket; `order-health-summary-response.dto.ts:5-8` states `total` equals the sum of the
buckets, and `HEALTH_SEGMENTS[].key` in `orders-list-page.tsx:105` is typed `OrderHealthValue` and drives
the `health` URL param 1:1.

An invoicing block is orthogonal: an order can be `synced` **and** blocked. See § 7 Alternative 1.

---

## 5. Questions & Assumptions

### Open Questions

1. **Bulk-issue exclusion.** The issue's AC says blocked orders are excluded from bulk invoice issuance.
   `POST /invoices/bulk-issue` takes an explicit `connectionId`, so an `ambiguous-connection-no-primary`
   block is *resolved* by the operator naming a connection — and `trigger-model-manual` /
   `trigger-model-batched` describe auto-issue timing, not eligibility. All three mean "auto-issue did not
   happen", never "this order cannot be invoiced". Excluding them would break the primary remediation path
   for the very state this issue exists to surface. **Proposed**: do not exclude; render the reason in the
   bulk surface as context. Recorded as a deliberate AC deviation.

### Assumptions

- `manual` is recorded but rendered quietly (`neutral` tone) — a deliberate setting is not a fault.
- The `warnOnceIfManualPrimaryDisablesInstall` case (a `manual` primary on an install with other
  candidates) stays a connection-level warning; it is an install-level misconfiguration, and stamping an
  identical loud badge on every order for a setting fixed in one place is noise.
- `selection.kind === 'none'` and the unreachable vanished-connection branch stay log-only.

---

## 6. Proposed Implementation Plan

### Phase 1 — The `sales-documents` concern

1. **Reason unions**
   - **File**: `libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts` (new)
   - **Action**: ADR-041 decision 11 verbatim — `SalesDocumentUnresolvedReasonValues` /
     `SalesDocumentUnresolvedReason`, `SalesDocumentGateBlockReasonValues` /
     `SalesDocumentGateBlockReason`, kept as two separate types with `'unresolved-routing'` documented as
     the bridge value. Plus `SalesDocumentBlock { reason; detail?: string }`. A code comment names the
     blocking prerequisite of each declared-but-unwritten value (buyer tax-id contract; #2057; #1908).
   - **Acceptance**: `as const` arrays with derived unions; no imports beyond the file itself (a
     dependency-free leaf, so any context can value-import it without a CJS cycle).
2. **Barrel + package export**
   - **Files**: `libs/core/src/sales-documents/index.ts` (new), `libs/core/package.json`
   - **Action**: `export * from './domain/types/sales-document-reason.types';`; add the
     `./sales-documents` entry to `exports`. `tsconfig.base.json` needs no change — the
     `@openlinker/core/*` wildcard already resolves it.
   - **Acceptance**: `import { SalesDocumentGateBlockReasonValues } from '@openlinker/core/sales-documents'`
     type-checks from `libs/core`, `apps/api` and `apps/worker`.
3. **Unit spec**
   - **File**: `libs/core/src/sales-documents/domain/types/sales-document-reason.types.spec.ts` (new)
   - **Action**: assert both value sets match the ADR exactly and stay disjoint apart from the bridge value.

### Phase 2 — Evaluate the block in invoicing

4. **Return a block outcome**
   - **Files**: `libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts`,
     `.../auto-issue-trigger.service.interface.ts`
   - **Action**: `onOrderTransition` returns `Promise<SalesDocumentBlock | null>`. The `ambiguous` exit
     returns `{ reason: 'ambiguous-connection-no-primary', detail: '<n> connections, none primary' }`;
     `qualifies` grows a discriminated result so `manual` is distinguishable from an unmet `auto-on-*`;
     the existing `BatchedTriggerNotImplementedError` throw is caught and mapped to
     `trigger-model-batched`. Every existing log line is kept — the reason is **additive** (§54). The
     `#2100 DEFERRED` comment block is replaced with the shipped behaviour.
   - **Acceptance**: no new constructor dependency; the F3 comment in the interface stays true.
5. **Spec**
   - **File**: `.../auto-issue-trigger.service.spec.ts`
   - **Action**: extend the existing `single-connection selection (#2047)` and `trigger-model gating`
     describes — each of the three reasons returned, `null` on a successful enqueue, `null` for
     `selection.kind === 'none'` and for an unmet `auto-on-paid`, and detail strings PII-free.

### Phase 3 — Persist on the order

6. **Domain + ORM columns**
   - **Files**: `libs/core/src/orders/domain/entities/order-record.entity.ts`,
     `.../domain/types/order-record.types.ts`,
     `.../infrastructure/persistence/entities/order-record.orm-entity.ts`
   - **Action**: append two tail constructor fields with `= null` defaults —
     `salesDocumentBlockReason: SalesDocumentGateBlockReason | null` and
     `salesDocumentBlockDetail: string | null`. ORM: `@Column({ type: 'varchar', nullable: true })` +
     `@Index()` on the reason (a filter axis), `@Column({ type: 'text', nullable: true })` with no index on
     the detail (free text, never filtered — same call `mappingFailureReason` made).
   - **Acceptance**: existing `new OrderRecord(...)` call sites still compile.
7. **Atomic writer**
   - **Files**: `.../domain/ports/order-record-repository.port.ts`,
     `.../infrastructure/persistence/repositories/order-record.repository.ts`,
     `.../application/interfaces/order-record.service.interface.ts`,
     `.../application/services/order-record.service.ts`
   - **Action**: `updateSalesDocumentBlock(internalOrderId, block: SalesDocumentBlock | null)` — a narrow
     absolute-set on the two columns only, mirroring `updateItemResolutionFailure`. Passing `null` clears
     both. Surfaced as `IOrderRecordService.markSalesDocumentBlock`. Map both columns in `toDomain`;
     deliberately **not** in `toOrm` (see § 4), with the reason recorded in a comment beside the
     `cancelledAt` note.
   - **Acceptance**: repeated calls with the same reason leave one row in one state (no accumulation).
8. **Call the writer**
   - **File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`
   - **Action**: capture `onOrderTransition`'s return inside the existing try/catch and call
     `markSalesDocumentBlock(order.id, block)` — including `null`, which is the level-triggered clear. The
     existing swallow-and-log-PII-safe behaviour is unchanged; a write failure is logged, never thrown.
   - **Acceptance**: a transition that enqueues a job clears any previously persisted reason.
9. **Clear on a manual issue**
   - **File**: `apps/api/src/invoicing/http/invoicing.controller.ts`
   - **Action**: on a successful `issueInvoice` in both the single `POST /invoices` path and
     `issueOneForOrder` (bulk), call `this.orders.markSalesDocumentBlock(orderId, null)`. Best-effort —
     wrapped so a clear failure never fails an issued invoice. Needed because fixing the config and
     issuing by hand fires no order transition.
10. **Migration**
    - **File**: `apps/api/src/migrations/1833000000005-add-order-record-sales-document-block.ts` (new)
    - **Action**: `ADD COLUMN IF NOT EXISTS` for both columns + the index, `DROP COLUMN IF EXISTS` down.
      Prefix chosen above `origin/main`'s max (`1833000000004`) per the migration-timestamp lesson.
    - **Acceptance**: `pnpm --filter @openlinker/api migration:show` reports nothing pending.

### Phase 4 — Read it through the API

11. **Response DTO + controller**
    - **Files**: `apps/api/src/orders/http/dto/order-record-response.dto.ts`,
      `apps/api/src/orders/http/orders.controller.ts`
    - **Action**: two `@ApiPropertyOptional({ nullable: true })` fields mirroring `mappingFailureReason`;
      map them in `toDto`.
12. **List filter**
    - **Files**: `apps/api/src/orders/http/dto/list-orders-query.dto.ts`,
      `libs/core/src/orders/domain/types/order-record.types.ts` (`OrderRecordFilters`),
      `.../repositories/order-record.repository.ts` (`findMany`)
    - **Action**: `salesDocumentBlocked?: boolean` — an independent axis, **not** an `OrderHealth` value.
      SQL: `rec."salesDocumentBlockReason" IS NOT NULL`.
13. **Count on the status summary**
    - **Files**: `apps/api/src/orders/http/dto/order-health-summary-response.dto.ts`,
      `libs/core/src/orders/domain/types/order-record.types.ts` (`OrderHealthSummary`),
      `.../repositories/order-record.repository.ts` (`countByHealth`)
    - **Action**: add `salesDocumentBlocked` as an explicitly **non-partitioning** field, and amend the
      DTO header sentence so "total equals their sum" keeps naming only the five buckets. One extra
      `COUNT(*) FILTER`, no new endpoint, no new round-trip.

### Phase 5 — Surface it in the web app

14. **FE types + mirror guard**
    - **Files**: `apps/web/src/features/orders/api/orders.types.ts`,
      `scripts/check-sales-document-reason-mirror.mjs` (new), root `package.json`
    - **Action**: mirror `SalesDocumentGateBlockReasonValues` with the FE-001 "hand-mirrored" comment, add
      the two optional record fields (`?: ... | null`, matching the graceful-degradation convention), and
      chain a textual-parse mirror guard into `check:invariants` with `--self-check`, cloned from
      `check-permission-mirror.mjs`.
15. **Badge helper**
    - **File**: `apps/web/src/features/orders/lib/order-row.ts` (+ `.test.ts`)
    - **Action**: new sibling export `invoicingBlockedBadge(reason): { label; tone } | null` —
      `ambiguous-connection-no-primary` → `No primary` / `error`, `trigger-model-batched` → `Batched` /
      `warning`, `trigger-model-manual` → `Manual only` / `neutral`, unknown → `null`. Not a branch inside
      `invoiceBadge`, which by contract takes a `ParsedOrderInvoice` a blocked order does not have.
16. **List rendering**
    - **File**: `apps/web/src/pages/orders/orders-list-page.tsx`
    - **Action**: in the `money` column's `hasInvoicingCapability ?` arm, render the blocked badge (with
      a `title` carrying the one-line cause) in place of the `Issue invoice` CTA — except for
      `trigger-model-manual`, where badge and CTA sit together. Mirror the same change in the mobile card
      path. Suppress the badge whenever `parsed.invoice` exists, so a stale reason can never be observed.
      Add an `Invoicing blocked (n)` `Chip` to the existing chip row, toggling the new filter via a
      `toggleBlocked` writer cloned from `toggleBreaching` (including its `p.delete('offset')`). Raw string
      literals, matching this page's convention.
17. **Order-detail panel**
    - **File**: `apps/web/src/features/invoicing/components/order-invoice-panel.tsx` (+ test)
    - **Action**: replace the client-side `requiresConnectionPick` derivation with the persisted reason as
      the source of truth for the message; per-reason copy and action via `t(key, fallback)`, matching this
      file's convention. `ambiguous-connection-no-primary` keeps the existing `Set a primary` link to
      `/connections/:id/edit`. `resolveIssuableConnection` stays for picking the connection to issue on —
      only its use as an *explanation* goes away.
18. **Timeline**
    - **File**: `apps/web/src/features/orders/components/order-activity-timeline.tsx` (+ test)
    - **Action**: its own `events.push({ id: 'invoicing-blocked', ... })` — it is not an ingestion-time
      fact, so it does not belong folded into the `Order received` event the way `source_deleted` is.

### Phase 6 — Docs

19. `docs/architecture-overview.md` § Invoicing — replace the closing "**Every block on the auto-issue
    path is still log-only** … deferred to **#2100**" sentence with the shipped behaviour.
20. `docs/architecture/adrs/041-sales-document-routing-policy.md` — decision-11 status note records that
    its first slice has shipped, naming which values are written and which stay inert.

---

## 7. Alternatives Considered

### Alternative 1 — A sixth `OrderHealth` bucket

Rejected. `OrderHealthValues` is a documented partition with three twins (FE `deriveOrderHealth`, SQL
`countByHealth`, SQL `applyHealthFilter`) and a `total = sum(buckets)` contract the list-page segments rely
on. A blocked order is still in exactly one health bucket, so a sixth value would either double-count or
hide a sync failure behind an invoicing one. Shipping it as an independent badge + filter matches how
ship-by SLA and fulfillment rollup already coexist with health, and preserves the operator outcome the AC
asks for.

### Alternative 2 — A dedicated `sales_document_blocks` table

Keeps fiscal vocabulary out of `orders`, which ADR-041 decision 1 cares about. Rejected for now: every
surface in Phase 4/5 already reads `order_records`, so the table would add a cross-context join or a second
read to the list, the filter, the summary and the detail — for a two-column fact with a 1:1 relation to the
order. The columns are named `salesDocument*` rather than `invoice*` so the vocabulary stays neutral if a
future receipt path reuses them.

### Alternative 3 — `AutoIssueTriggerService` writes the order record itself

Rejected. It would inject `ORDER_RECORD_SERVICE_TOKEN` into a service whose interface documents "MUST NOT
inject any OrdersModule-provided token", closing a runtime DI cycle `OrdersModule → InvoicingModule →
OrdersModule` that the boot gate exists to prevent. Returning the outcome to the caller that already lives
in `orders` costs one changed signature and no new edge.

---

## 8. Validation & Risks

### Architecture compliance

- ✅ Domain layer stays framework-free; `sales-documents` is a dependency-free leaf.
- ✅ Invoicing reaches orders through neither a repository port nor a DI token — only a return value.
- ✅ Cross-context imports are value types only (`@openlinker/core/sales-documents`), on the allowed
  contract surface.
- ✅ Naming: `*.types.ts` for types, `*.orm-entity.ts` for the ORM entity, Symbol tokens unchanged.

### Risks

- **Stale reason after an out-of-band issue** — mitigated three ways: the level-triggered rewrite on the
  next transition, the explicit clear on both manual-issue paths, and the FE suppressing the badge whenever
  an invoice exists.
- **FE/BE union drift** — mitigated by the `check:invariants` mirror guard, not a comment.
- **Migration sort order** — prefix chosen above `origin/main`'s max; `check-migration-timestamps.mjs`
  enforces it.
- **Stacked branch** — the PR is opened as a draft marked *Blocked by #2060* and must not merge first.

### Edge cases

- Order blocked, then the connection is deleted → next transition returns `none`, writer clears. Correct:
  there is nothing to invoice with.
- Two transitions racing → the writer is a narrow absolute-set, so last write wins on these two columns
  only and cannot clobber a concurrent `syncStatus` write.
- Historical rows predating the column → `null`, rendered as no badge.

### Backward compatibility

- ✅ Additive columns, additive DTO fields, additive filter. No existing behaviour changes except that
  `onOrderTransition` now returns a value its single caller previously discarded.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests

- `sales-document-reason.types.spec.ts` — value sets match the ADR.
- `auto-issue-trigger.service.spec.ts` — one case per reason returned, plus `null` on success, on
  `selection.kind === 'none'`, and on an unmet `auto-on-paid`.
- `order-record.service.spec.ts` — `markSalesDocumentBlock` sets and clears; repeated calls do not
  accumulate.
- `order-ingestion.service.spec.ts` — the returned block is persisted; a successful enqueue clears it.
- `order-row.test.ts` — `invoicingBlockedBadge` label/tone per reason, `null` for an unknown value.
- `orders-list-page` / `order-invoice-panel` / `order-activity-timeline` tests — badge, chip, panel read,
  narration. `renderWithProviders` defaults to an anonymous session, so permission-gated assertions pass
  their own session adapter.

### Integration tests

- `apps/api/test/integration/order-health-summary.int-spec.ts` — the new count is orthogonal: an order that
  is both `synced` and blocked appears in `synced` **and** in `salesDocumentBlocked`, and the five buckets
  still sum to `total`.
- `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts` — unchanged, and must stay green:
  it is the F3 gate.

### Acceptance criteria

- [ ] Both reason unions exist as `as const` arrays with derived unions, exported from
      `@openlinker/core/sales-documents`, matching ADR-041 decision 11 verbatim, kept as two types.
- [ ] The `ambiguous`, `manual` and `batched` exits each persist their reason **in addition to** the
      existing log.
- [ ] `missing-required-tax-id` and `tax-rate-conflict` are declared, never written, with a code comment
      naming their prerequisites.
- [ ] Repeated `onOrderTransition` calls do not accumulate duplicate block records.
- [ ] A subsequent successful issuance clears the reason — covered for both the auto path and the manual
      path, with a test each.
- [ ] `AutoIssueTriggerService` injects no OrdersModule token; the DI boot gate stays green.
- [ ] The migration exists and `migration:show` reports nothing pending.
- [ ] Blocked orders carry a list badge on `/orders` (desktop and mobile) and a counted filter chip.
- [ ] `order-invoice-panel.tsx` renders the persisted reason instead of re-deriving ambiguity, and the
      `ambiguous-connection-no-primary` copy links to the connection edit form.
- [ ] The persisted reason and every log line stay PII-clean.
- [ ] `pnpm check:invariants` passes, including the new mirror guard.
- [ ] Docs updated.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE ↔ Integration boundaries
- [x] Reuses existing patterns (#1689 write path, `cancelledAt` single-writer column, `toggleBreaching`
      URL writer, `check-permission-mirror.mjs` guard shape)
- [x] Idempotency considered — level-triggered absolute-set write
- [x] Migration required and planned
- [x] Tests planned for every non-trivial path
- [x] Two AC deviations recorded with reasons (health bucket → filter chip; no bulk-issue exclusion)
