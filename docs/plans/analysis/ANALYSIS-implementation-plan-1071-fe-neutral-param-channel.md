# Pre-implement analysis: #1071 — FE neutral-param channel migration

**Gated**: `docs/plans/implementation-plan-1071-fe-neutral-param-channel.md` · #1071
**Date**: 2026-06-15
**Verdict**: ✅ **READY**

Read-only gate against the live worktree (post tech-review revision incl. the B1 bulk-scope expansion). No Critical findings; no contract break; no migration. The plan's surfaces match reality.

---

## Reuse findings (Phase B)

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `OfferParameter.rangeValue?` | **PARTIAL (extend)** | `offer-parameter.types.ts:21-34` — no `rangeValue` today; additive optional. Barrel-exported (`index.ts:171`). Consumers: builder, allegro adapter, `ResolvedParameter` alias — all tolerate an optional add. |
| `AllegroOfferParameter.rangeValue?` | **PARTIAL (extend) — closes a known gap** | `allegro-api.types.ts:254-263` *documents* the gap: "Allegro's POST API also accepts `rangeValue`… the shape validator filters it out — pre-existing gap, tracked separately." `isAllegroOfferParameterShape` ignores unknown keys, so adding it is safe. |
| `CreateOfferOverrides.parameters?` | **NEW field, additive** | `offer-create.types.ts:24-59` — no `parameters` today. Rides 6 struct-wrapping contexts (execution/enqueue/bulk-submit/snapshot/job-payload/DTO) — all safe for an optional add. Barrel-exported (`index.ts:166`). |
| `OfferParameterDto` (api) | **NEW** | `create-offer.dto.ts` — mirror the established `CreateOfferPriceDto` + `@ValidateNested()/@Type()` pattern (already used for `price`/`overrides`, and reused by `bulk-offer-create.dto.ts`). |
| `category-parameters-to-offer-parameters.ts` (FE serializer) | **NEW** (replaces `serializeAllegroParameters`) | confirmed importers to migrate: `AllegroCreateOfferWizard.tsx:70-71,739`, **`bulk/bulk-edit-modal.tsx:42-43,177`**, **`bulk/bulk-policy.ts:204-221`** (reads `platformParams.productParameters`), + spec. |
| FE `OfferParameter` mirror | **NEW** | no FE `OfferParameter` exists; `CategoryParameterSection`/`CategoryParameter.section` do (`listings.types.ts:256,318`). |
| builder merge / Gate-2 | **CHANGE (localized)** | `offer-builder.service.ts` — `cleanedOverrides` picks only title/desc/cat/img/platformParams (NOT `parameters`), `command.parameters` is separate (line 162); removing `readOperatorOfferParamIds` (257-273) + reading `overrides.parameters` is contained. |
| adapter legacy read | **CHANGE (localized)** | `allegro-offer-manager.adapter.ts:1587-1591,1666-1670` — the only `platformParams['parameters']`/`['productParameters']` reads; `mergeSectionParameters` legacy branch removable. |

## Backward-compat findings (Phase C)

| Surface | Result | Severity |
|---|---|---|
| Barrels (`@openlinker/core/listings`) | additive optional fields only — no symbol removed/renamed | ✅ none |
| Port signatures | none changed | ✅ none |
| DTO shapes | `CreateOfferOverridesDto.parameters?` additive optional; `platformParams` retained for knobs | ✅ none |
| Symbol tokens | none touched | ✅ none |
| ORM schema | none — `overrides` is JSONB-carried → **no migration** | ✅ none |
| `check:invariants` | additive type fields don't trip cross-context / barrel-purity (service-class-only) / deep-barrel guards | ✅ none |
| Persisted snapshots (`OfferCreationRequestSnapshot`) | old records carry `overrides.platformParams.{parameters,productParameters}` → handled by the D3/I3 read-fallback (correctness: prevents a new retry `business_failure`) | ✅ handled in plan |

## Open questions (non-blocking)
1. **Bulk `mergeOverrides` for `parameters` = replace** (I2) — decided in-plan; covered by a bulk-submit test. (Confirmed `bulk-offer-create.dto.ts` reuses `CreateOfferOverridesDto`, so one DTO edit covers single + bulk BE.)
2. **D3 read-fallback lifetime** — transitional; removable once pre-#1071 failed records age out. Not blocking.

## Notes
- The whole change is **additive at every contract surface**; the only *removals* are internal (`serializeAllegroParameters`, the adapter legacy branch, `readOperatorOfferParamIds`), none of which are exported.
- No edits to the enqueue/execute/snapshot/retry **signatures** the parallel #1042 session is refactoring (operator params ride existing `overrides` threading) — conflict risk minimized to the shared `offer-create.types.ts` / barrel (rebase-resolvable).
