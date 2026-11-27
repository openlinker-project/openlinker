# Implementation plan - /orders handled in OpenLinker, part 2 (#3482)

Follow-up to draft PR #3797 (part 1). Branch `3482-orders-handled-in-openlinker-2`, stacked on `3482-orders-handled-in-openlinker` (#3797), which is stacked on #3014. **Local only: nothing committed, pushed or written to GitHub.** This PR is meant to carry `Closes #3482`.

Part 1 plan: `docs/plans/implementation-plan-orders-handled-in-openlinker.md` (sections 6, 8 and 10 list what this part picks up).

## 1. Scope

The acceptance criteria of #3482 that part 1 left open:

| # | Item | Issue AC / mockup |
|---|---|---|
| A | Health bucket: an order handled in OpenLinker must not stay "Awaiting dispatch" for ever | AC "states which bucket ... and fixes the derivation within the existing buckets if wrong" |
| B | Chip "Waiting in OpenLinker N · oldest <age>" + filter | mockup annotation 5 |
| C | Chip "On pack bench N" + filter (work To pack or Packing) | AC "On pack bench N chip ... list filter only" |
| D | "Packing" while the bench is scanning, before the box is shut | AC stage marker "To pack -> Packing -> Packed" |
| E | "Unassigned" / packer name under "To pack" | AC "To pack (Unassigned or assigned packer)" |
| F | Commit the M4 mockup without annotation 2 | AC "M4 is committed ... without the sixth health bucket note" |

Non-goals: "Retry routing" (#3558); any change to the pack bench itself (epic #3460: "this epic does not change the pack bench itself"); a sixth health bucket (D22).

## 2. Research

- **Health** is a partition `source_deleted | awaiting_mapping | needs_attention | synced | awaiting_dispatch`, defined twice: FE `deriveOrderHealth` (`apps/web/.../order-health.ts`) and SQL in `OrderRecordRepository` (`countByHealth`, `applyHealthFilter`, `HEALTH_ORDINAL`, all built on `HAS_FAILED` / `HAS_SYNCED` over `syncStatus`). `synced` means "the order reached where it is fulfilled" (it ignores shipping); `awaiting_dispatch` is the residual "not provisioned yet". A handled order has no `syncStatus`, so it is always the residual.
- **"Handled" in SQL** has no column on `order_records`. The work lives in `fulfillment_works` (another context). `orderId` is the leading column of `IDX_fulfillment_works_grouping`, so `EXISTS (SELECT 1 FROM fulfillment_works fw WHERE fw."orderId" = rec."internalOrderId" AND ...)` is an index lookup. ADR-036 sanctions a raw-table-name read for a **filter / count** need (precedent: `offer-mapping.repository.ts`, `order-record.repository.ts`), with an in-place comment. The FE equivalent is part 1's `handledInOpenLinker` (present iff a work is not `cancelled` / `incomplete`), so the two can match exactly.
- **Waiting** is already persisted: `order_records.fulfillmentBlockReason` + `fulfillmentBlockedAt` (#3485). The three operator-facing reasons are `routing-refused`, `routing-no-shipping-address`, `routing-failed`; part 1 keys its FE copy on them, with no core constant and no mirror.
- **Packing before the box is shut**: the bench writes one row per verified scan in `fulfillment_work_verifications` (`fulfillmentWorkId`, `verifiedAt`, `voidedAt`). "At least one non-voided verification and `parcelClosedAt IS NULL`" = the box is being packed.
- **Assignment**: `fulfillment_works.assignedToUserId`. The FE already has `usePackersQuery` on the `users` barrel (`GET /users/packers`, admin/operator/viewer), used by `/fulfillment`.
- **Mockups**: `docs/plans/mockups/oms-mvp/` holds m3 / m4b / m5 and a SHARED `ol-kit.css` + `ol-kit.js`; mockups link `../../../../apps/web/src/index.css` instead of a bundled stylesheet. The downloaded M4 bundles `ol.css` (740 KB) and a different `ol-kit.js`.
- **Summary / filters** precedent: part 1's base (#3014) added `destinationRoutingBlocked` the same way: an `OrderRecordFilters` axis, a `COUNT(*) FILTER` in the summary, a DTO query param, an FE descriptor + chip + checkbox.

## 3. Design

### A. Health bucket (decided: "Awaiting dispatch" until shipped, then "Synced")

What #3482 calls wrong is that a handled order stays "Awaiting dispatch" **after it shipped or was delivered** (mockup annotation 2: the card "will count shipped parcels"). A handled order still waiting on the bench IS awaiting dispatch, so it stays there.

Rule, identical in FE `deriveOrderHealth` and SQL (`countByHealth`, `applyHealthFilter`, `HEALTH_ORDINAL`):

- `needs_attention` / mapping / deleted precedence unchanged;
- `synced` = `HAS_SYNCED` **OR** (`IS_HANDLED_IN_OPENLINKER` AND `fulfillmentState IN ('dispatched','delivered')`);
- everything else stays the residual `awaiting_dispatch`.

`IS_HANDLED_IN_OPENLINKER` = `EXISTS` a work for the order that is not `cancelled` / `incomplete` (the same predicate as the FE's `handledInOpenLinker`, which is present iff such a work exists). The handled condition is required: an order with no destination and no work that happens to be shipped (a marketplace-fulfilled order with nothing configured) keeps today's bucket, so non-OMS installs see no change. The KPI cards keep summing to "All orders".

### B. "Waiting in OpenLinker" chip + filter

- Core: `WaitingFulfillmentBlockReasonValues` (the three reasons) in the `fulfillment` block-reason types, exported; a mirror check script keeps the FE copy keys equal (repo practice, e.g. `check-destination-routing-reason-mirror.mjs`).
- Repository: `IS_WAITING_IN_OPENLINKER = rec."fulfillmentBlockReason" IN (...)`; `OrderRecordFilters.waitingInOpenLinker`; summary gains `waitingInOpenLinker` (count) and `waitingInOpenLinkerOldestAt` (`MIN("fulfillmentBlockedAt")`). Parity spec cases.
- API: `?waitingInOpenLinker=true` on list + count, summary fields.
- FE: descriptor (`?waiting=true`), checkbox, quick chip "Waiting in OpenLinker N · oldest <age>" (reuses the existing `oldestAgeSuffix` used by the sales-documents chip), empty state.

### C. "On pack bench" chip + filter

- Repository: `IS_ON_PACK_BENCH = EXISTS (SELECT 1 FROM fulfillment_works fw WHERE fw."orderId" = rec."internalOrderId" AND fw."status" NOT IN ('cancelled','incomplete','closed') AND fw."parcelClosedAt" IS NULL)` - ADR-036 comment in place. Filter `onPackBench`, summary count `onPackBench`. Parity spec cases.
- API + FE as in B (`?packBench=true`, neutral chip "On pack bench N", list filter only, no action).

### D. "Packing" while scanning

- `FulfillmentWorkProgress` gains `hasVerification: boolean`; `findProgressByOrderIds` adds an `EXISTS` on `fulfillment_work_verifications` (`voidedAt IS NULL`) per work. Same context, so joined by ORM entity, not raw SQL.
- Rule: parcel closed -> packed; status `closed` -> packed; `in_progress` OR `hasVerification` -> packing; otherwise to-pack. Spec: the bench's real shape (`open` + one verification) -> packing.
- No change to the bench.

### E. Packer under "To pack" and "Packing" (decided: as in the mockup)

The mockup renders the person under the marker for BOTH early stages: "○ To pack · Unassigned", "◐ Packing · Kasia Wróbel".

- `OrderWorkSummary` gains `assignedToUserId: string | null` and `assignment: 'single' | 'mixed'` (a split order whose works disagree reports `mixed` and no id).
- API DTO gains `assignedToUserId`.
- FE: a muted line under To pack / Packing: the packer's display name from `usePackersQuery` (`users` barrel, `GET /users/packers`, the source `/fulfillment` uses); "Unassigned" when no one is assigned; "Assigned" when the id resolves to no packer (deleted, or the list failed to load) - never a raw id. The query runs only when a row on the page has an assigned work. Mobile card: the same text in the Packing fact. Nothing under Packed (the existing tick says when).

### F. M4 mockup

- `docs/plans/mockups/oms-mvp/m4-orders-list-with-oms-status.html`, linking the repo's `index.css` + shared `ol-kit.css` / `ol-kit.js` like m4b, **without annotation 2** (sixth bucket, D22). The `search` / `noresults` states stay in the file (they belong to #3507, already shipped).
- Risk: the downloaded `ol-kit.js` differs from the shared one. Before committing I diff them; if M4 needs functions the shared kit lacks, they go into the M4 file's own `<script>`, never into the shared kit (m3/m4b/m5 depend on it).

## 4. Tests

- Core: rule spec (packing via verification), health predicates via the existing predicate-parity spec (new filters), repository int-spec for `IS_ON_PACK_BENCH` / handled-health / waiting (CI, Docker) - including the part-1 gap for `findProgressByOrderIds`.
- API: controller specs for the new query params and summary fields.
- FE: `deriveOrderHealth` (handled -> synced; failed still wins), descriptors + hook (`waiting`, `packBench`), chips (count, oldest age, mount rule), stage sub-line (Unassigned / name / unknown), empty states.
- Mirror script self-check for the waiting reasons.
- Gate: `pnpm type-check`, ESLint on changed files, `check:invariants`, targeted suites (your standing rule: no full local test run).

## 5. Architecture check

- The raw `fulfillment_works` subqueries in `OrderRecordRepository` are read-only, parameter-free constants, justified by filter/count, commented per ADR-036. No import of the fulfillment ORM entity into `orders`.
- No migration (no new column).
- No new health bucket; the field and chips are non-partitioning.
- FE uses the `users` barrel for packers (cross-feature via barrel).

## 6. Risks

- **A moves shipped handled orders** from "Awaiting dispatch" to "Synced" on installs with the OMS on. Intentional (it is the defect #3482 names), but visible on the KPI cards.
- The `EXISTS` subqueries run on every list / summary request that uses the new filters or the health partition. Index-backed; to be confirmed in CI timings.
- Stack depth 3 (#3014 -> #3797 -> this). Every merge below means a retarget / rebase here.

## 7. Decisions (user, 2026-10-23)

1. Health: "Awaiting dispatch" until shipped, then "Synced" (section 3.A).
2. Scope: all of A-F in this PR, which carries `Closes #3482`.
3. Packer: as in the mockup - name under To pack and Packing, "Unassigned" when nobody is assigned (section 3.E).
