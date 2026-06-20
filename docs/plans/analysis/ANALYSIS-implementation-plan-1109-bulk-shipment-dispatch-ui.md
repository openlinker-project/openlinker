# Pre-implement analysis — #1109 bulk shipment dispatch UI

**Plan:** `docs/plans/implementation-plan-1109-bulk-shipment-dispatch-ui.md`
**Gate run:** read-only reuse + contract audit against the live tree (FE-only; backend bulk endpoints already merged & wired).

## Verdict: ✅ READY

No Critical findings. The change is FE-only, purely additive at every contract surface, and consumes the already-shipped `POST /shipments/bulk/generate-labels` + `/shipments/bulk/protocol` endpoints as-is. The only two "modify an existing consumer" touch-points are low-risk refactors covered by existing tests.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `shipments.bulkGenerateLabels` API method | **NEW** | `ShipmentsApi` has `list/generateLabel/cancel/notifyDispatched/downloadLabel` only (`features/shipments/api/shipments.api.ts`); grep for `bulkGenerateLabels`/`bulk/generate-labels` across `apps/web/src` → 0 hits |
| `shipments.downloadProtocol` (blob) | **NEW** | same grep → 0 hits; `requestBlob(path, init)` already supports POST+body |
| `BulkGenerateLabelsInput` / `BulkDispatchResult` / `PerOrderDispatchResult` types | **NEW** | not present in `shipments.types.ts` |
| `useBulkGenerateLabelsMutation`, protocol-download hook | **NEW** | shipments barrel exports neither |
| `features/orders/lib/dispatch-input.ts` (`buildDispatchItem`, `classifyDispatchEligibility`, group-by-source / group-by-carrier helpers) | **NEW (extracted)** | `orders/lib` exists (`order-health.ts`); logic currently private in `generate-label-form.tsx` (`buildGenerateLabelInput`, `detectMissingFields`) → extract + reuse |
| `shared/ui/checkbox-cell.tsx` | **PARTIAL → lift** | `CheckboxCell` is page-local in `products-list-page.tsx`; not in `shared/ui/`. Lift down + re-point products import |
| `BulkActionBar` | **ALREADY EXISTS → reuse** | `shared/ui/bulk-action-bar.tsx` (count + hint + actions) |
| `useLabelDownload` blob pattern, `Dialog`/`DialogFooter`, `StatusBadge`, `StructuredErrorList`, `ConfirmDialog`, `parseOrderSnapshot`, `useToast` | **ALREADY EXISTS → reuse** | `shared/ui/*`, `features/orders/api/order-snapshot.schema.ts` |
| `BulkDispatchDialog` + schema | **NEW** | same-feature component; page deep-imports it (no barrel change) |

## Backward-compatibility findings

| Surface | Assessment | Severity |
|---|---|---|
| `ShipmentsApi` interface + `createShipmentsApi` | Two methods **added**; nothing removed/retyped | none (additive) |
| shipments barrel (`features/shipments/index.ts`) | Hooks/types **added** | none (additive) |
| `createMockApiClient` (`apps/web/src/test/test-utils.tsx`) | `shipments` mock **extended** with `bulkGenerateLabels` + `downloadProtocol` | Warning — every existing shipments-mock test must still satisfy the type; deep-partial mock means additive is safe |
| `products-list-page.tsx` | `CheckboxCell` import re-pointed to `shared/ui` (no behavior change) | Warning — products component tests must stay green |
| `generate-label-form.tsx` | Refactored to import extracted `buildDispatchItem`/eligibility helpers (behavior preserved) | Warning — single-form tests must stay green |
| Backend / core / DTOs / Symbol tokens / ORM / migration | **Untouched** | none |
| `check:invariants` (cross-context, service-interface, migration-timestamps) | Backend-only checks; FE change can't trip them | none |
| FE ESLint (feature deep-import ban, design-token drift) | New helpers live in canonical `lib/`; new `shared/ui` primitive is allowed; **no new CSS tokens planned** (reuse existing) — if any added, mirror to `tokens.ts` | none if token rule honored |

## Open questions
None blocking. Design decisions already resolved with the user: orders-list entry; multi-source via per-source fan-out (`Promise.allSettled`); exclude COD/unresolved-paczkomat orders (surface "dispatch individually"); shared parcel default + per-order override; one handover-protocol download per carrier connection. The 25-cap is per source-group, enforced at selection.

## Notes for implementation
- Keep the **group-by-source** (dispatch fan-out) and **group-by-carrier** (protocol) logic as pure, unit-tested helpers in `orders/lib` — they're the main effort and the highest-value test target.
- Extract `buildDispatchItem` so single + bulk produce identical payloads (anti-drift).
- Measure overflow with the DOM, not screenshots (a class collision clipped a badge during mockup review; the typed primitives avoid it in the real build).
