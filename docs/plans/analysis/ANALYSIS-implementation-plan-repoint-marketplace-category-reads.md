# Pre-implement gate — repoint the marketplace category reads (#2074)

- **Gated**: 2026-08-14
- **Subject**: [the plan](../implementation-plan-repoint-marketplace-category-reads.md), issue #2074, [ADR-037](../../architecture/adrs/037-destination-taxonomy-read-model.md)
- **Base**: `07fa1711`

## Verdict: `READY`

No reuse collisions, no Critical break. One finding **reduces** the plan's scope,
one names an easy omission that would leave a future write endpoint ungated.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `findPath` / `path()` | **NEW** | No hit on either name across `libs/`+`apps/` |
| `taxonomy.controller.ts`, `/taxonomy/categories` routes | **NEW** | No hit; `apps/api/src/listings/http/` has 4 controllers, none taxonomy |
| **`loadBreadcrumbs(scope, hitIds[])`** | **EXISTS — reuse, plan overestimated** | `destination-category.repository.ts:286`, **private**, takes an id **array** and returns `Map<hitId, CategoryPathSegment[]>`. `findPath` is a ~3-line public wrapper over it — **no new SQL at all**, where the plan budgeted "~30 lines reusing an existing CTE". Cheaper and lower-risk than costed. |
| `BREADCRUMB_SQL` | **EXISTS** | `:65` — already scope-parameterised and recursive; nothing to change |
| `ShopCategoryBrowseService` | **EXISTS → reimplemented** | 20 lines; interface + route response shape must stay identical |

## Backward-compatibility findings

| Surface | Severity | Finding |
|---|---|---|
| `IDestinationTaxonomyService` + `DestinationCategoryRepositoryPort` — one method each | **Warning (low)** | Additive. One implementation each; the int-spec binds through the structural `TaxonomyRepositoryHandle`, which must gain `findPath` to exercise it (it is narrower than the port, so additions do not otherwise break it). |
| `mapping-options.controller` response DTOs | **None** | Unchanged by design; `AllegroCategoryResponseDto` / `CategoryPathNodeResponseDto` keep their shape. Pin with an int-spec. |
| New `TaxonomyController` → `write-guard-coverage.spec.ts` | **Warning** | That spec carries an explicit `CONTROLLERS` allowlist and its header says to extend it when a controller is added. The new controller is **read-only today**, so it is not strictly required — **but the spec deliberately already covers read-only controllers** (Customers / Cursors / WebhookDelivery) precisely so a *future* write handler added without `@Roles` fails the build. Omitting it silently forfeits that guard for this controller. Add it. |
| Nest module registration | **Warning (low)** | The new controller must be registered in `apps/api/src/listings/listings.module.ts`; an unregistered controller 404s at runtime with everything green at compile time. |
| ORM / migration | **None** | No schema change. |
| `check:invariants` | **None** | No new core service (the additions are methods on existing ones), no cross-context repository-port import, no new workspace dep. |

## Open questions

1. **The plan's stated behaviour change is the thing to watch, not the types.** A
   never-synced connection now returns `[]` where the old cache lazily filled
   from the platform. `browse` has always behaved this way in the new model, so
   this is not new *code* — it is newly *reachable* by an existing operator
   surface. Worth an explicit int-spec asserting empty-not-error, so the FE
   sibling (#2075) can rely on it for its distinct empty state.

2. **`leaf ?? false` deserves the comment the plan promises.** The fallback is
   unreachable on a marketplace scope, and an uncommented `?? false` reads like a
   guess. Say why it cannot fire.

## Suggested ordering

1. Repository `findPath` (wrapper over `loadBreadcrumbs`) + port + service `path()`.
2. `ShopCategoryBrowseService` delegation.
3. New `TaxonomyController` + DTOs + module registration + `write-guard-coverage` entry.
4. Repoint the two `mapping-options` routes.
5. Specs, then the int-spec additions (`findPath`, empty-not-error).
6. Docs.
