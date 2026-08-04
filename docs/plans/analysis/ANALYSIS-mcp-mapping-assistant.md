# Pre-implement gate: MCP Phase 2 — Mapping assistant tools

**Plan**: `docs/plans/implementation-plan-mcp-mapping-assistant.md`
**Issue**: #1488
**Branch**: `1488-mcp-mapping-assistant-tools` (base `0b8c1303`)
**Date**: 2026-07-31

## Verdict: `NEEDS-REVISION`

No reuse collisions and no Critical contract break. One **Warning** is a genuine gap in the plan's own
step list rather than a design flaw: extending `McpToolDefinition` with two *required* fields is a
compile break across the six shipped Phase-1 tools, and neither §3.6's file layout nor step 1's
acceptance criteria account for updating them. Cheap to fix in the plan; expensive to discover as a
type-check failure mid-implementation.

---

## Reuse findings

Every artifact the plan proposes as new is **confirmed absent**. No collisions.

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `requiredScope` / `requiresAdmin` on `McpToolDefinition` | **NEW** | `apps/api/src/mcp/tools/tool-definition.types.ts` has neither; the only `requiredScopes` in the tree is the route-level gate at `mcp.module.ts:91` |
| `'forbidden'` outcome | **PARTIAL (extend)** | `McpToolOutcomeValues = ['ok','error','rate-limited']`, `tool-definition.types.ts:48` |
| `apps/api/src/mcp/tools/write/` | **NEW** | Directory does not exist |
| 5 tool names | **NEW** | No occurrence of `list_category_mappings` / `resolve_category` / `project_attributes` / `list_attribute_mappings` / `upsert_category_mapping` anywhere in `apps/api/src/` |
| `.claude/commands/configure-mappings.md` | **NEW** | `.claude/commands/` holds 10 commands; no `configure-mappings`, and there is no `.claude/skills/` — the plan's §3.5 assumption is correct |

All four core services the plan binds to exist and are reachable **exactly as the plan assumes**:

| Dependency | Status | Path |
|---|---|---|
| `IMappingConfigService` + `MAPPING_CONFIG_SERVICE_TOKEN` | exists, exported | `libs/core/src/mappings/mappings.tokens.ts:9`; `mappings.module.ts:127-128` exports the token |
| `ICategoryResolutionService` + token | exists | `libs/core/src/listings/listings.tokens.ts:16` |
| `IAttributeProjectionService` + token | exists | `libs/core/src/listings/listings.tokens.ts:7` |
| `ListingsModule` (services subpath) | exists | `libs/core/src/listings/services/index.ts:24`; `libs/core/package.json` exports `./listings/services` |
| `McpTokenScope` union | exists | `libs/core/src/users/domain/types/mcp-token.types.ts:17-19` |
| `olRole` on the principal | exists | `mcp-principal.types.ts:28`, stamped at `ol-mcp-token.verifier.ts:70` — §3.1's "no new plumbing" claim holds |

The plan's method-signature assumptions were verified against
`libs/core/src/mappings/application/interfaces/mapping-config.service.interface.ts`:
`getCategoryMappings(destinationConnectionId)` (:81), `upsertCategoryMapping(...)` (:82),
`getAttributeMappings(destinationConnectionId)` (:109). All match.

---

## Backward-compatibility findings

### Critical

**None.** The plan removes and renames nothing. No barrel export, port signature, DTO field, or Symbol
token is touched. `McpToolDefinition` is internal to `apps/api/src/mcp/` and is not on any published
`@openlinker/core/*` barrel.

### Warning 1 — two required fields break six shipped tool files

`McpToolDefinition` gains `readonly requiredScope` + `readonly requiresAdmin` as **non-optional** (plan
§3.1). Ten files reference the interface; six are Phase-1 tool definitions that construct it as an
object literal and will fail `tsc` until updated:

```
apps/api/src/mcp/tools/read/whoami.tool.ts
apps/api/src/mcp/tools/read/list-connections.tool.ts
apps/api/src/mcp/tools/read/search-catalog.tool.ts
apps/api/src/mcp/tools/read/get-product.tool.ts
apps/api/src/mcp/tools/read/get-availability.tool.ts
apps/api/src/mcp/tools/read/get-order.tool.ts
```
plus `mcp-tool-definitions.provider.ts`, `tool-registry.service.ts`, `tool-registry.service.spec.ts`.

§3.6's file layout lists only `tool-definition.types.ts`, `tool-registry.service.ts` and
`mcp-tool-definitions.provider.ts` as CHANGED, and step 1's acceptance says only "`requiredScope` +
`requiresAdmin` on the definition". The six read tools are missing from both.

**Suggested resolution — keep the fields required and update all six explicitly.** The alternative
(optional with an implicit `'mcp:read'` / `false` default) is worse for a security-relevant field: a
future write tool that forgets to declare `requiresAdmin` would silently default to *unprivileged*,
which is the failure direction that matters. Required fields make every new tool state its posture at
the compiler. The edit is six one-line additions.

### Warning 2 — none of the outcome change reaches persistence

Adding `'forbidden'` to `McpToolOutcomeValues` needs **no migration**. `McpAuditLogger` is log-only —
`apps/api/src/mcp/tools/audit/` contains an interface, an implementation and a spec, and there is no
`*.orm-entity.ts` or table behind it. Recorded here because "new value in an `as const` union" is
normally a migration trigger and a reviewer will reasonably ask.

### `check:invariants`

No expected trip. Specifically checked:

- **Cross-context imports** — `apps/api` importing `MappingsModule` / `ListingsModule` for `imports: []`
  is the sanctioned NestJS-module-class shape; `McpTokenScope` (type alias) and the service interfaces
  (`I*Service`) plus Symbol tokens are all allow-listed symbol shapes. No `*RepositoryPort`, no
  `*OrmEntity`, no `*Adapter`, no `*Dto` crosses.
- **Deep-barrel imports** — `@openlinker/core/listings/services` is an explicitly exported subpath
  (`package.json`), not a deep path.
- **`check-service-interfaces`** — walks `libs/core/src/**/application/services/*.service.ts` only; this
  plan adds no core service.

---

## Open questions

1. **Order-mapping options tools** (§7) — the plan defers `DestinationOptionsReader` /
   `SourceOptionsReader` discovery tools that the issue text lists. Deferral was the standing
   recommendation and is unchallenged, but it means #1488 ships narrower than its own AC list. Worth an
   explicit line in the PR body so the issue isn't read as fully satisfied.
2. **Does `list_attribute_mappings` need a `resolve_attributes` sibling?** The plan pairs
   `project_attributes` (what the destination *would* receive) with the mapping list, which is coherent.
   Flagged only because `getAttributeMappingsByProvenance` (:116) exists and is what the borrowed-taxonomy
   path (#1045) actually reads — an agent debugging an Erli connection would see mappings via the plain
   read that the resolver would not use. Not a blocker; a description-copy concern.

---

## What to change before implementing

Single edit: extend §3.6's file list and step 1's acceptance to name the six Phase-1 tool files as
CHANGED, declaring `requiredScope: 'mcp:read'` / `requiresAdmin: false` on each. Everything else is
`READY`.
