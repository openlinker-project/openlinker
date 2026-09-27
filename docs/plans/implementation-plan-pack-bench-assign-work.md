# Implementation Plan: Pack Bench Redesign + Assign Packing Work

Epic: #3335. ADR: #3331 / PR #3333 (ADR-074). Mockups: PR #3330.

## 1. Understand the task

Two deliverables, one stack:

- **Pack bench redesign** (#3339 + #3341): UX/copy fixes to the real `/bench` route, ported from
  the committed mockup (`docs/plans/mockups/pack-bench-redesign.html`), plus rendering the new
  per-parcel assignment state (mine / unassigned / assignment-only).
- **Assign Packing Work** (#3340): a new operator screen, backed by the new
  `assignedToUserId` / `selfServeEligible` columns ADR-074 decided, from
  `docs/plans/mockups/assign-packing-work.html`.

Non-goals (explicitly out of scope per ADR-074): no exclusive-assignment default, no automatic
reap/expiry timer for a stale assignment, no change to `FulfillmentWork.assignedConnectionId`
(the holder-connection axis, ADR-054) or to the executor handshake (#2399/#2712).

## 2. Research already done

- `FulfillmentWork` today carries `packedByUserId` (post-hoc, stamped by whoever claims and
  finishes) and no pre-assignment field.
- `FulfillmentWorkRepositoryPort` has no full-row `save` — every mutation is a single narrow
  conditional `UPDATE` (see `docs/architecture-overview.md` § 26 Fulfillment, "There is no
  `save(work)`"). The new writers must follow that discipline.
- `FulfillmentHandshakeService` is the real claim/handshake flow — server-side enforcement of
  `selfServeEligible: false` belongs there, not only in the frontend.
- Both mockups are committed and Playwright-verified for their *current* states; #3338 must add
  `data-state` coverage before #3339/#3340 build against them, per
  `docs/frontend-architecture.md § UX Mockups`.

## 3. Design — the stack

One linear branch chain, each based on the previous branch's tip, merged bottom-up:

```
main
 └─ 3329-pack-bench-assign-work-mockups        (#3330 — mockups, OPEN)
     └─ 3331-fulfillment-work-pre-assignment-adr (#3333 — ADR-074, OPEN)
         └─ 3336-... (schema + repository writers)
             └─ 3337-... (HTTP endpoint + worklist read)
                 └─ 3338-... (mockup data-state coverage)
                     └─ 3339-... (pack bench FE redesign)
                         └─ 3340-... (Assign Packing Work screen)
                             └─ 3341-... (bench rail 3-state rendering)  ← tip
```

Each `/work` on an issue below must: `EnterWorktree` on the PREVIOUS branch's tip (not `main`),
branch off it, and on push set the PR's base to that previous branch via
`gh api repos/openlinker-project/openlinker/pulls/<n> -X PATCH -f base=<prev-branch>`
(`gh pr edit --base` fails on this repo — Projects Classic deprecation error, see
`docs/plans/mockups/` session precedent). When a lower PR in the chain merges, GitHub
auto-retargets the next PR's base to `main`; re-verify the base after each merge before
continuing to work on the next one.

## 4. Step-by-step

### Step 1 — #3336: CORE schema + repository writers
- Branch from `3331-fulfillment-work-pre-assignment-adr`.
- Migration: `assignedToUserId` (nullable `text`), `selfServeEligible` (`boolean not null default
  true`) on `fulfillment_works`.
- `FulfillmentWorkRepositoryPort` gains `assignToPacker(workId, userId)`,
  `clearAssignment(workId)`, `setSelfServeEligible(workId, boolean)` — one conditional `UPDATE`
  each, `false`-on-no-op per the port's existing convention (never throw for "0 rows affected"
  unless the caller needs to distinguish two different zero-row causes).
- AC: `pnpm --filter @openlinker/api migration:show` shows it applied; each writer is one
  statement; tests for all three.

### Step 2 — #3337: HTTP endpoint + worklist projection + server-side gate
- Branch from #3336's branch.
- `PATCH /fulfillment-work/:id/assignment` (admin/operator-gated), calling #3336's writers.
- `IFulfillmentWorklistService` / the worklist read projects `assignedToUserId` +
  `selfServeEligible` per row.
- **Server-side enforcement**: `FulfillmentHandshakeService`'s claim path refuses a claim on a
  `selfServeEligible: false` work object assigned to a different packer. This is the actual
  guarantee — #3341's frontend guard is UX only, never a substitute.
- AC: route-authorization coverage test passes; worklist read returns the two fields; an
  integration test proves the server-side refusal against the real claim path (not a mock).

### Step 3 — #3338: mockup `data-state` coverage
- Branch from #3337's branch.
- `pack-bench-redesign.html`: give `empty` / `locked` their own `data-state` attribute alongside
  the existing `#emptyBody` / `#lockOverlay[data-open]` mechanisms (one lookup path for specs).
- `assign-packing-work.html`: add `data-state` + an in-page switcher for its distinct UI states
  (hold-reason form open/closed, drag-over highlight, unassigned-pickable toggle).
- AC: every state in both mockups reachable via a stable `data-state` + switcher button; no
  regression in existing mockup interactivity (re-verify via Playwright).

### Step 4 — #3339: pack bench FE redesign
- Branch from #3338's branch.
- Port the mockup's UX fixes into `apps/web/src/features/bench/`: over-scan guard,
  connectivity-disables-scan-input, identity-chip clear on lock, stale-badge auto-hide,
  "Confirm this item" audible+visible parity, bin-location column + group-by-location toggle
  (**flagged speculative — no real `inventory_locations` bin granularity exists**, ship either
  omitted or explicitly cosmetic-only), carrier/ship-by/weight/dimensions fields, keyboard
  shortcuts (C/U/N/Esc), two audio tones, "Line"→"Item" rename, click-to-reorder scan target.
- Product photography: `Product.images[0]` at product level (verified — no per-variant image
  field exists) or an explicit placeholder; never invent a new field here.
- AC: every UX fix manually verified via `pnpm start:dev:web`; existing bench test suite
  (`apps/web/src/features/bench/**/*.test.tsx`) passes unchanged; new tests for non-trivial logic.

### Step 5 — #3340: Assign Packing Work screen
- Branch from #3339's branch.
- New operator screen from `docs/plans/mockups/assign-packing-work.html`: swimlane board,
  drag-and-drop, hold-reason form, self-serve-eligible checkbox, wired to #3337's endpoint.
- AC: TBD by that issue's own body at implementation time — read it fresh before starting, since
  it wasn't in scope for this pass.

### Step 6 — #3341: bench rail 3-state rendering
- Branch from #3340's branch (tip of the stack).
- Bench rail rows read `assignedToUserId` / `selfServeEligible` from #3337's projection and
  render three distinct states: mine / unassigned (self-serve) / assignment-only-not-mine
  (visible-but-muted, per ADR-074's advisory-by-default choice).
- AC: each state renders a distinct, test-queryable marker (e.g. `data-assignment-state` with
  values `mine` / `unassigned` / `assigned-other`), not merely a colour difference; a packer
  cannot claim a `selfServeEligible: false` parcel assigned to someone else — this is a UX
  affordance on top of #3337's server-side refusal, not the guarantee itself; tests for the new
  rendering logic.

## 5. Validate (per step, before opening each PR)

- `pnpm lint && pnpm type-check` (full, not package-scoped — catches stale-dist `.d.ts` drift)
- `pnpm test` for touched packages; `pnpm test:integration` for #3336/#3337 (backend/DB changes)
- Architecture check: no CORE↔Integration boundary violations; `fulfillment` context stays a
  zero-sibling-edge leaf (no new `@openlinker/core/<sibling>` import) — #3336/#3337 touch this
  context directly, so re-check `barrel-purity.spec.ts` passes
- Re-verify the PR's base branch after every lower-stack merge before continuing

## 6. Open questions / risks

- #3340's exact AC wasn't reviewed in this pass — read it fresh at Step 5.
- The bin-location UI in #3339 needs an explicit backend-follow-up issue if the operator wants
  real bin granularity later; #3339 must not silently imply that data exists.
- Server-side enforcement (#3337) and frontend rendering (#3341) are on opposite ends of the
  stack — if #3341 lands before #3337 is confirmed working end-to-end, the UI could show a
  restriction the backend doesn't actually enforce yet. Keep the order as planned (backend
  guarantee before frontend affordance).
