# Readiness gate: implementation-plan-preset-change-confirmation-diff (#2355)

**Date**: 2026-08-27
**Verdict**: **READY**

Frontend-only plan. The port / DI-token / ORM-entity / capability audit classes are **N/A** — the
plan proposes no `libs/core` symbol, no NestJS provider, no table and no column. The reuse audit
therefore runs against the frontend's own contract surfaces: the feature barrel, the API-client
namespace, the shared-UI catalog and the three `check:invariants` scripts that touch this folder.

---

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `POST …/presets/preview` endpoint | **ALREADY EXISTS — reuse, do not add** | `apps/api/src/fulfillment-authority/http/fulfillment-authority.controller.ts` (`@Post('presets/preview')`, roles `admin\|operator\|viewer`) |
| Preview diff computation | **ALREADY EXISTS** | `AuthorityStatusService.previewPreset` — mutates an in-memory copy, re-resolves, diffs. **Writes nothing**; `connectionService.update` is reached only from `applyPreset`. The plan's "a dry run must not mutate" constraint is satisfied server-side by construction, and the plan correctly adds only a frontend-side test of the same property. |
| `AuthorityPresetPreview` / `AuthorityPresetChange` FE types | **NEW** | no match for `PresetPreview` / `preset-diff` anywhere under `apps/web/src` |
| `previewPreset` on the API client | **NEW** | `who-decides.api.ts` deliberately omits it ("#2355 owns the generated-diff confirm dialog and adds the call with it") |
| Answer rendering | **ALREADY EXISTS — reuse** | `resolveAnswer` (`lib/who-decides-view.ts`) takes an `AuthorityAnswerRow`, which is exactly the `before`/`after` shape. Building a second renderer would be a genuine reuse collision; the plan avoids it. |
| §4.2 "what would stop working" body copy | **ALREADY EXISTS — reuse** | `ATTENTION_REASON_COPY` / `ATTENTION_UNKNOWN_COPY` + `isAuthorityAttentionReason` (#2357) |
| Connection-name resolution with id fallback | **ALREADY EXISTS — reuse** | `nameFor` in `who-decides-panel.tsx` (falls back to the id, never a placeholder) |
| `ConfirmDialog.confirmDisabled` | **PARTIAL — extend existing** | `shared/ui/confirm-dialog.tsx` has `isConfirming` only; no `confirmDisabled` anywhere in the tree |
| `who-decides__*` CSS | **PARTIAL — extend existing** | `apps/web/src/index.css` ~19455+ already carries the block; new classes append there |

---

## Backward-compatibility findings

**Critical: none.**

| Surface | Assessment |
|---|---|
| Feature barrel `features/fulfillment-authority/index.ts` | Additive only — new exports, none removed or renamed. |
| `FulfillmentAuthorityApi` interface | Additive method. `createApiClient` composes it at `app/api/api-client.ts:411`; the mock in `who-decides-panel.test.tsx` supplies the namespace as a typed `Partial<ApiClient>`, so **adding a required method to the interface makes that fixture a compile error until it is updated** — intended, and the reason no `as never` is permitted. Warning-level, mechanical. |
| `shared/ui/confirm-dialog.tsx` | `confirmDisabled?: boolean` is **optional**; all 20 existing `<ConfirmDialog` call sites are source-compatible. No behaviour change when omitted. |
| API DTOs / ORM / migrations | Untouched. No migration. |

### `check:invariants` exposure (Warnings, all avoidable by construction)

1. **`check-ui-vocabulary`** — `features/fulfillment-authority` is a **live** scan root (`pending: false`).
   Every string literal in `lib/who-decides.copy.ts` is scanned *including import paths*, and JSX text
   plus allow-listed attributes in the new `.tsx`. The nine banned terms are
   `authority`, `posture`, `FulfillmentWork`, `AvailabilityAuthority`, `atpEffect`/`ATP`, `phase`,
   `Orchestrator`, `Gateway`, `holder`. Two concrete traps for this diff:
   - the wire union member is spelled `holders` — the new copy must say **"systems"**, and the
     builder must not interpolate the wire kind into any rendered string;
   - a new module named `preset-authority-*` or imported from an `authority`-containing path inside
     `*.copy.ts` fails Rule B. The plan's `preset-diff.ts` / `who-decides-preset-confirm.tsx` naming
     avoids both. `EXEMPTIONS` is empty and must stay empty.
2. **`who-decides-styles.test.ts`** — asserts a CSS rule exists for every `who-decides*` class the
   feature renders, matching both `className="…"` and single-quoted `'who-decides…'` literals in
   `.tsx`. Every new class needs an `index.css` rule in the same commit. Step 11 covers it.
3. **`check-authority-kind-mirror`** — unaffected: it targets `lib/authority-kind.ts`, which this
   plan does not touch.
4. **`check-cross-context-imports` / workspace-dep declarations** — `apps/web` imports no
   `@openlinker/*` package; out of scope.
5. **Feature-barrel ESLint** — no cross-feature deep import is proposed; `useConnectionsQuery` is
   already consumed through the `connections` barrel.

---

## Open questions

- **None blocking.** The one design question the plan raised (whether a blocked dialog should also
  list the refused changes) is answered inside the plan with a reason, not deferred.
- Worth restating for the implementer: the preview response's `resultingAmbiguities` and the 422
  refusal body's `ambiguities` carry the **same item shape**, ids one level down on `connectionIds`.
  Build both fixtures from that shape; do not reintroduce a top-level `candidateConnectionIds`.

---

## Summary

READY. The plan reuses every existing seam it should (the preview endpoint, `resolveAnswer`, #2357's
§4.2 copy, the panel's id-fallback naming) and invents nothing that already exists. It breaks no
contract: the only shared-surface edit is an optional prop on `ConfirmDialog`, and the only
compile-forcing change is the additive API-client method, which is intentional. The live risks are
the three frontend invariant scripts, all avoidable within the plan as written.
