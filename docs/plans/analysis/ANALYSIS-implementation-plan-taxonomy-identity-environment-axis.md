# Pre-implement gate — taxonomy identity / environment axis (#2063)

- **Gated**: 2026-08-13
- **Subject**: [the plan](../implementation-plan-taxonomy-identity-environment-axis.md), issue #2063, [ADR-037](../../architecture/adrs/037-destination-taxonomy-read-model.md)
- **Base**: `59fe748d` (Wave 1, #2062, merged hours ago)

## Verdict: `READY`

No reuse collisions and no Critical contract break. Two Warnings, both understood and both cheap because the surface being changed shipped in the immediately preceding PR and has no external adopters yet.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `TaxonomyIdentityProvider` / `isTaxonomyIdentityProvider` | **NEW** | No hit for the interface, the guard, `getTaxonomyIdentity`, or `taxonomy-identity` anywhere in `libs/`/`apps/` |
| `taxonomy-identity.capability.ts` | **NEW** | — |
| `'allegro:sandbox'` value | **NEW** | No occurrence in the tree |
| `TaxonomyBorrower` | **EXISTS — deliberately untouched** | `taxonomy-borrower.capability.ts`; second consumer at `offer-builder.service.ts:141` is exactly why the plan forks a new capability instead |
| `resolveTaxonomyOwner` | **EXISTS → signature change** | `resolve-taxonomy-owner.ts:33`; see Warning 1 |
| `TaxonomyOwnerValues` | **EXISTS → widened** | `taxonomy-owner.types.ts:36`; see Warning 2 |
| Allegro `environment` config | **EXISTS → reuse** | `AllegroEnvironmentValues = ['sandbox','production']` (`allegro-config.types.ts:16`), already resolved by `AllegroAdapterFactory` — the plan passes it, it does not re-derive it |

## Backward-compatibility findings

No **Critical** items: nothing is removed or renamed on a `@openlinker/core/<ctx>` barrel, no `*Port` method signature changes, no ORM/DTO change.

| Surface | Severity | Finding |
|---|---|---|
| `resolveTaxonomyOwner` — exported from the `listings` barrel (`index.ts:61`) | **Warning** | Dropping the `platformType` parameter changes the shape of a **published** symbol. Mitigated by scope: exactly **two** consumers exist, both in-repo (`destination-taxonomy.service.ts:216`, `scheduler.service.ts:597`), both updated by this plan. The symbol was first published in #2062 (merged the same day), so no plugin or downstream consumer can have adopted it. Arity reduction is also compile-safe for any stray caller — an extra argument is ignored, not an error — so the failure mode would be silent rather than loud; the two call sites must therefore be edited deliberately, not left to the compiler. |
| `TaxonomyOwnerValues` — widened to 2 values | **Warning (low)** | Additive to a closed union; nothing narrows. The only runtime consumer is `DestinationCategoryRepository.toTaxonomyOwner` (`:242`), a membership *narrowing* that accepts more values safely. No DTO validates against it, and no FE mirror exists (`apps/web` has zero references). |
| Mapping provenance vocabulary | **Warning (low)** | `destinationTaxonomyProvenance` is a plain `string` column defaulting to `'allegro'`, matched by equality in `findByProvenance`. It shares the `TaxonomyOwner` vocabulary but not the code path — `OfferBuilderService` reads `isTaxonomyBorrower`, never `resolveTaxonomyOwner`. The plan's § 4 records the resulting asymmetry rather than silently unifying it. **Correct call**, but it is the one place a future reader will be tempted to "fix". |
| ORM schema | **None** | `taxonomyOwner` is plain `text` with no enum type or check constraint, so a new value needs no migration. Verified in `1833000000000-add-destination-categories-table.ts`. |
| Manifest / `CoreCapabilityValues` | **None** | `TaxonomyBorrower` appears in **no** plugin manifest's `supportedCapabilities`, confirming the advertised-without-dispatch precedent the plan follows for the new capability. |
| `check-service-interfaces` / `check-cross-context-imports` | **None** | No new service; the new capability is a domain file with only same-context imports. |
| Allegro adapter constructor | **Warning (low)** | Two construction sites: `allegro-adapter.factory.ts` (updated) and `__tests__/allegro-offer-manager.adapter.spec.ts`. A trailing **optional** param with a `'production'` default keeps the spec compiling untouched — but the spec should still gain explicit sandbox/production cases, or the new branch ships untested. |

## Open questions

1. **Deleting the `platformType` fallback is a behaviour change, not just a refactor.** Today an adapter that browses but declares nothing resolves to an owner; after this it resolves to `null` and its taxonomy silently stops syncing. That is the fail-safe direction and only Allegro is affected (it will declare) — but it must be asserted by a spec, and the `TaxonomySourceUnavailableException` message must name the real cause ("declares no taxonomy identity"), not the stale "not a known taxonomy owner" wording, or the next operator debugs the wrong thing.

2. **Erli + sandbox remains unfixed and should be stated on the issue, not just the plan.** An Erli connection borrowing a *sandbox* Allegro catalogue (ADR-031, its own credentials) still resolves to `'allegro'` and would write sandbox rows into the production owner scope. Narrower than the case being fixed, but the same class — record it so #2063 does not read as fully closed.

## Suggested ordering

1. Capability + union value + `resolveTaxonomyOwner` rewrite (pure domain, no dependents yet).
2. Update the two call sites, removing the now-dead `getAdapter` reads.
3. Allegro adapter + factory.
4. Specs, including the two new adapter cases and the "declares nothing ⇒ null" case.
5. ADR-037 amendment + `architecture-overview.md` correction (Wave 1 asserted "owner = validated platformType", which this reverses).
