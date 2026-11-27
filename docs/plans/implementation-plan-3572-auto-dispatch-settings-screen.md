# Implementation Plan: automatic-labels settings screen (frontend)

- **Issue**: #3572 (epic #3514, pilot G09-03, P1)
- **Branch**: `3572-auto-dispatch-settings-screen`, branched from `2729-auto-dispatch-operator-surface` (the backend, PR #3786, is not merged yet and this screen calls its endpoints). Local only: nothing committed or pushed.
- **Depends on**: #2729 (refusal read, preview, `trigger`; PR #3786), #3571 (default box, merged)
- **Mockup**: M11 "Automatic labels and parcel defaults"

---

## 1. Task summary

An operator can set `Connection.config.autoDispatch` only through raw JSON, and for the OpenLinker OMS (the connection that normally HOLDS the work) there is no edit form at all: its detail page says "Managed from Packing settings" and offers no Edit. This slice gives the settings a real screen, with the refusal list and the "try it on recent orders" preview the backend now serves.

## 2. Starting point (already written locally, unverified)

A first cut exists in `apps/web/src/features/auto-dispatch/`, mounted on the OMS status page (`/settings/packing`) through a new `afterSetup` slot on `PackingStatus`:

- API layer: types, Zod parse (`null` on an unreadable response, unknown reason codes read as `unknown`), client, query keys, registered in `api-client.ts` and `createMockApiClient`.
- `lib/auto-dispatch-config.ts`: read/write of the `autoDispatch` key; `withAutoDispatch` carries unowned keys through and OMITS a cleared knob.
- Hooks: refusals query, preview mutation, save mutation (read-modify-write of `config`).
- Components: form section, refusal list, preview panel; CSS block `Automatic shipping labels (#2729)`.
- Specs for the config lib and the section (written, not run).

**`type-check`, ESLint and `check:invariants` for this frontend have NOT completed** (the run was stopped), so none of it is verified.

## 3. What #3572 asks for vs where it stands

| AC | Status |
|---|---|
| toggle `enabled`, `parcelTemplate`, `defaultWeightGrams` from a real form | cut written |
| default courier dimensions (#3571) | cut written (all three or none) |
| trigger `on-accept` / `on-parcel-closed` saved as `autoDispatch.trigger` (D1) | cut written |
| per-delivery-method table overriding template, weight, dimensions (D18) | **not built; see decision 2** |
| refusal list split "needs your input" / "retrying automatically", with empty state | cut written |
| preview of recent orders, flags an order that would be refused | cut written |
| empty fallback weight is a validation error stating the consequence | **deviates; see decision 3** |
| round-trips 0/empty vs unset (#2610) | handled by omission; see decision 4 |
| M11 states `configured`, `off`, `refusals-empty`, `errors`, `refusals`, `saved` | partly; each needs a test |
| tests, no boundary violations | specs written; gate not run |

## 4. Decisions needed before building further

1. **Where the section lives.** #3572 says "the connection edit form"; #3572 and #2729 also say it belongs to the connection that HOLDS the work. For the OMS those two collide: it has no edit form. Proposal:
   - **OMS**: the OMS status page (`/settings/packing`), as in the cut.
   - **Any other connection that can hold work** (a 3PL with `FulfillmentExecutor`): its connection detail page, as a card with its own Save. Not embedded in `EditConnectionForm`: that form owns one `config` JSON and one Save, and a nested form with its own PATCH would race it.
   This deviates from the issue's literal "edit form" and should be recorded on the issue.
2. **Per-delivery-method table (D18).** `autoDispatch` has no per-method keys. Per-method parcel defaults are the routing rule's `parcelProfile` (#3651), and the UI for them already ships in the **source** connection's Mappings page (`RoutingRulesPanel` + `RoutingParcelDialog`, #3652; cm and kg units). Rebuilding a table that writes the same rows here would duplicate it and could disagree with it. Proposal: do not build the table; show a short explanation under "Parcel defaults" with a link to the Mappings routing rules ("Set a different parcel for a delivery method"). Needs your OK because it drops an AC line.
3. **Empty fallback weight.** The AC wants an error. But an empty fallback is valid when every product carries its own weight, and an error would block saving that setup. The cut shows a note ("an order with a product that has no weight is refused, not guessed") and still saves. Proposal: keep the note and record the deviation. If you want the AC literally, it becomes an error only when the preview shows `no-weight` refusals.
4. **Cleared-knob convention (#2610).** That convention writes an explicit `null`; the backend REFUSES `null` for a weight or box (`must be a number greater than 0`). Because the whole `autoDispatch` object is replaced on save, omitting the key removes it. Kept as omission, with the reason stated in the lib.
5. **"Generate label manually" (M11 modal and refusal actions).** No operator endpoint exists for it in #2729 (the bench route is for the pack bench and needs auto-dispatch OFF). Proposal: out of scope; each refusal links to its order ("Open order") and the list links to Jobs & Logs. Say if you want it as a follow-up issue.

## 5. Remaining work

1. Get the cut to a green `type-check`, ESLint and `pnpm check:invariants` (the UI-vocabulary scan, provider-name boundary and design-token drift checks apply to new copy and CSS).
2. Add the "View all in Jobs & Logs" link, filtered to this connection (`/jobs-logs?connectionId=`), and a "View job" action for a retrying row.
3. Warn when the connection cannot hold work (`holder.holdsWork === false`): the settings do nothing until it is assigned work.
4. Mount the same section on the connection detail page of a non-OMS connection that has `FulfillmentExecutor` enabled (decision 1).
5. The explanatory link to Mappings routing rules (decision 2).
6. Specs for every M11 state, the permission gate (`useWriteAccess('connections:write')`), and the OMS page wiring (`packing-status.test.tsx` already covers the status view; add the slot).
7. Docs: one bullet in `docs/architecture-overview.md` § 28 and a line in `docs/frontend-architecture.md` if the `afterSetup` slot warrants it.

## 6. Risks

- The screen is only as correct as the backend contract in PR #3786; if that PR changes shape, the Zod parse reports it as unreadable rather than rendering garbage.
- `PATCH /connections/:id` replaces `config` whole. The save reads a fresh config first and changes one key; an OMS config carries the packing claims, so a regression here would silently switch routing off. The section spec pins that the other keys survive.
- The unit and component specs are not run locally by agreement; CI is the first real run.

## 7. Non-goals

COD and insurance settings (#3578, #3580), a per-method table (decision 2), an operator "Generate label manually" action (decision 5), any backend change.
