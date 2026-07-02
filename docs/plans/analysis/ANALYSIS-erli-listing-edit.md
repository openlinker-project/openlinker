# Pre-Implementation Analysis: Erli Plugin — Enable Edit Offer (`supportsListingEdit`)

**Plan**: `docs/plans/implementation-plan-erli-listing-edit.md`
**Issue**: #1215
**Analyzed**: 2026-06-30
**Gate**: read-only readiness check (reuse audit + backward-compat)

---

## Verdict: **READY**

No Critical findings, no Warnings. This is a clean single-flag opt-in onto an existing, documented `PlatformContribution` slot. Every assumption in the plan was confirmed against the live tree.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `supportsListingEdit` slot | **ALREADY EXISTS → reuse** | `apps/web/src/shared/plugins/plugin.types.ts:435` — `supportsListingEdit?: boolean;` on the platform-contribution type, with the doc comment `/** Listing-detail: gate the "Edit offer" button on ListingDetailPage. */` |
| `platform.supportsListingEdit` precedent | **ALREADY EXISTS → reuse** | Allegro sets it at `apps/web/src/plugins/allegro/index.ts:63`; smoke-tested at `allegro.test.ts:66`. Other plugins (inpost/dpd/ksef) assert it `toBeUndefined()`. |
| Gate consumption | **ALREADY EXISTS → reuse** | `apps/web/src/pages/listings/listing-detail-page.tsx:124` — `mappingPlugin?.supportsListingEdit ? (<Button …>Edit offer</Button>) : undefined` (optional-chained, safe when absent). |
| `EditOfferDrawer` | **ALREADY EXISTS → reuse** | `apps/web/src/features/listings/components/EditOfferDrawer.tsx` (+ `.test.tsx`, `OfferDescriptionEditor.tsx`, `edit-offer-fields.schema.ts`). |
| `useUpdateOfferFields` hook | **ALREADY EXISTS → reuse** | `apps/web/src/features/listings/hooks/use-update-offer-fields.ts`. |
| Erli BE `updateOfferFields` | **ALREADY EXISTS → reuse** | `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts:247`; adapter `implements OfferManagerPort & OfferCreator & OfferFieldUpdater` (factory interface line 25). Frozen-field silent-drop logic present as described. |
| Erli plugin flag | **NEW (confirmed absent)** | Erli's `platform` block in `apps/web/src/plugins/erli/index.ts` does **not** currently declare `supportsListingEdit`. The one-line addition is the only net-new declaration. |
| Erli smoke-test assertion | **NEW (confirmed absent)** | `apps/web/src/plugins/erli/erli.test.ts` has a `describe('platform contributions')` block ending with the `bulkOfferConfigSection` test — the documented anchor for the new `it(...)`. No `supportsListingEdit` assertion exists yet. |

**No reinvention.** The plan adds zero new ports, services, DI tokens, ORM entities, DTOs, capabilities, or components. It opts into existing machinery.

---

## Backward-compatibility findings

| Surface | Status |
|---|---|
| Top-level barrels (`@openlinker/core/<ctx>`) | No change. |
| Port method signatures | No change. (`OfferFieldUpdater.updateOfferFields` already implemented BE-side; FE dispatches through existing API.) |
| DTO shapes | No change. |
| Symbol tokens | No change. |
| ORM schema / migrations | No change — no entity touched, no migration required. |
| `check:invariants` (cross-context / service-interface / deep-barrel / repo-URL) | Not triggered — change is confined to `apps/web/**`, which is outside the cross-context import walker's scope. |

The flag is an additive optional boolean: setting it on Erli changes **only** Erli's rendering. All other plugins (which leave it `undefined`) are unaffected. Existing `erli.test.ts` assertions remain green.

---

## Open questions

None blocking.

### Minor notes (non-blocking, for the implementer)

1. **Doc citation drift.** The plan cites `docs/frontend-architecture.md:504` as the slot's definition. The authoritative TypeScript declaration is `apps/web/src/shared/plugins/plugin.types.ts:435`. The slot is genuinely documented inline there; the markdown line number is incidental and worth a quick re-check when editing docs, but doesn't affect implementation.

2. **Line-number references are approximate.** The plan references "line 70" for `offerValidation` and "line 124" for the gate. The gate is exactly at `listing-detail-page.tsx:124`; the Erli `platform` block line numbers are close but should be located by symbol, not line, at edit time. Cosmetic.

3. **Setup-guide § 8 target confirmed.** `docs/integrations/erli/setup-guide.md:273` (`## 8. Update an offer …`) and the `> **UI button is coming.** … #1215` callout at lines 292–294 exist exactly as the plan describes — the Phase 3 edit has a real target.

4. **Optional `EditOfferDrawer.test.tsx` coverage** (plan §9) is genuinely optional; the drawer is already platform-agnostic and the smoke assertion in `erli.test.ts` is sufficient. Skip unless a reviewer requests Erli-specific drawer coverage.
