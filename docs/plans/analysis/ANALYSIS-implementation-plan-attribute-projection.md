# Pre-Implement Gate — Attribute projection (#1038)

**Plan**: `docs/plans/implementation-plan-attribute-projection.md`
**Date**: 2026-06-14
**Verdict**: ✅ **READY**

## Reuse audit (does it already exist?)

| Plan artifact | Status | Evidence |
|---|---|---|
| `AttributeMapping` / `AttributeValueMapping` entities | **NEW** | no `class AttributeMapping` in `libs/core/src` |
| `AttributeMappingOrmEntity` / `AttributeValueMappingOrmEntity` | **NEW** | no `attribute_mappings` / `attribute_value_mappings` table in any `*.orm-entity.ts` or migration |
| `AttributeMappingRepositoryPort` + impl | **NEW** | no existing port/repo |
| `ATTRIBUTE_MAPPING_REPOSITORY_TOKEN` | **NEW** | not in `mappings.tokens.ts` |
| `AttributeMappingInput` | **NEW** | not in `mapping.types.ts` |
| `getAttributeMappings`/`upsertAttributeMapping`/`deleteAttributeMapping` on `IMappingConfigService` | **PARTIAL (extend)** | interface exists with category methods; mirror them |
| `AttributeProjectionService` + `IAttributeProjectionService` | **NEW** | no match in `libs/core/src` |
| `ATTRIBUTE_PROJECTION_SERVICE_TOKEN` | **NEW** | not in `listings.tokens.ts` |
| `ResolvedParameter` / `AttributeProjectionInput` / `AttributeProjectionResult` | **NEW** | not in listings types |

A repo-wide grep for `AttributeProjectionService|ATTRIBUTE_*_TOKEN|attribute_mappings|class AttributeMapping|ResolvedParameter|AttributeMappingInput` across `libs/core/src` + `apps/api/src` returned **zero hits**. Greenfield confirmed.

**Reuse to honour** (don't reinvent): `CategoryMapping` stack (entity/orm/repo/upsert pattern), `MappingConfigService`, `CategoryResolutionService` (sibling), `CategoryParametersReader` + `isCategoryParametersReader`, `CategoryParameter`/`CategoryParameterSection`, `IIntegrationsService.getCapabilityAdapter`.

## Backward-compatibility checklist

| Surface | Finding | Severity |
|---|---|---|
| Top-level barrels | Only **additive** exports (`AttributeMapping`, `AttributeValueMapping`, `AttributeMappingInput` on mappings; `IAttributeProjectionService` + types on listings). No removals/renames. | OK |
| Port/interface signatures | `IMappingConfigService` gains 3 methods — sole in-repo implementor is `MappingConfigService` (updated in plan). Test mocks use partial `jest.Mocked`, unaffected. | Warning (handled) |
| Symbol tokens | Two new tokens added via `export *` from `*.tokens.ts`; none removed. | OK |
| ORM schema | Two new tables ⇒ migration required → `1805000000000` (origin/main tail is `1804000000000`; strictly-greater ordering #1013 satisfied). Partial unique indexes declared on the ORM entity for synchronize↔migration parity (the #1036 lesson). | Warning (handled) |
| `check:invariants` | `listings → mappings` + `listings → integrations` cross-context edges already exist (no new edge). `AttributeProjectionService implements IAttributeProjectionService` satisfies `check-service-interfaces`. Migration-ordering guard satisfied. Keep `AttributeProjectionService` off `listings/index.ts` (only `/services`) — `barrel-purity.spec.ts` present and will catch a slip. | OK |

## Open questions

- **`AttributeProjectionInput` carries `sourceConnectionId`** — the plan adds it (refinement over the issue's earlier sketch) so source-scoped (B′) mappings resolve correctly. Confirmed as the right call; not a blocker.

## Summary

The plan is **READY** to implement. Every proposed artifact is confirmed net-new (zero collisions), the only contract changes are additive (new tables, tokens, service, and three interface methods on the single-implementor `IMappingConfigService`), the migration timestamp `1805000000000` clears the ordering invariant, and the listings barrel-purity guard is in place to keep the new service off the pure contract barrel. Mirror the category-mapping stack verbatim for storage and the `CategoryResolutionService` shape for projection. No revision needed before coding.
