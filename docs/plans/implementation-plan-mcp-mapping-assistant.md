# Implementation Plan: MCP Phase 2 — Mapping assistant tools

**Issue**: #1488 (Phase 2 of EPIC #1350)
**Date**: 2026-07-30
**Status**: Ready for Review
**Branch**: `1488-mcp-mapping-assistant-tools`
**Base**: `f2283251`

> Rationale: [ADR-033](../architecture/adrs/033-openlinker-as-mcp-server.md) (incl. **§ Phase 1 amendments**) /
> [ADR-034](../architecture/adrs/034-mcp-authorization-user-issued-pats.md).
> Phased breakdown: [implementation-plan-mcp-server.md § Phase 2](./implementation-plan-mcp-server.md).

---

## 0. What Phases 0 + 1 give us

`#1488`'s body says "Blocked by Phase 0 (#1486)". **That dependency is satisfied** — #1486 merged 2026-07-29, #1487 merged 2026-07-30.

| Landed | Consequence for Phase 2 |
|---|---|
| `OlMcpTokenVerifier` + `requireBearerAuth` on `/mcp`, gated on `mcp:read` | Auth is done. But the route gate is **`mcp:read` for everything** — per-tool `mcp:write` enforcement does not exist and is this phase's one net-new mechanism (§3.1) |
| `McpToolRegistryService` + its **per-call wrapper** (limiter + audit + error mapping) | Scope/role enforcement belongs in that same wrapper. A tool file still carries only its read/write + projection |
| `McpToolDefinition` (`name`, `requiredCapability`, `description`, `inputSchema`, `handler`) | Extended with `requiredScope` + `requiresAdmin` (§3.1) |
| Principal on the **request-scoped** `McpRequestContext` (`extra.olRole`, `authInfo.scopes`) | Role and scope are already in hand at the choke point — no new plumbing |
| Explicit-allowlist projections; `*.tool.ts` convention registered | Applies unchanged to the new tools |
| Capability gate is a proxy for "is this deployment in this business", **not** a data guarantee (ADR-033 § Phase 1 amendments) | Discovery tools must not read the gate as proof data exists |

---

## 1. Task Summary

**Objective**: expose OL's category/attribute mapping surface as MCP tools so an agent can run the
discover → suggest → confirm → write loop, plus the first **write** tool behind per-tool scope + role
enforcement, plus a `configure-mappings` Skill encoding the loop.

**Classification**: **Interface** layer (`apps/api/src/mcp/`) + one small extension to the Phase-1
registry contract. No new capability port, no domain entity, **no migration**.

---

## 2. Scope & Non-Goals

### In scope
1. **Per-tool scope + role enforcement** — `requiredScope` / `requiresAdmin` on `McpToolDefinition`, enforced at both registration and call time (§3.1).
2. **Four discovery/suggestion tools** (read): `list_category_mappings`, `suggest_category`, `project_attributes`, `list_attribute_mappings`.
3. **One write tool**: `upsert_category_mapping` — `mcp:write` + admin, neutral `CategoryMappingInput`.
4. **`configure-mappings` Skill** at `.claude/commands/configure-mappings.md`.
5. Docs: ADR-033 Phase-2 note, `engineering-standards.md` write-tool rules, `architecture-overview.md`.

### Non-goals
- **Order-mapping options tools** (`status` / `carrier` / `payment` via `DestinationOptionsReader` / `SourceOptionsReader`) — **deliberately deferred, see §7 for the decision I want.** The issue lists them; I argue they are the weakest part of its scope.
- **Server-enforced two-phase confirmation** — ADR-034 puts v1 HITL on the MCP client's tool-approval UX. Phase 3 (#1489) owns the deferred hardening.
- **`deleteCategoryMapping` / attribute-mapping writes** — one write tool is enough to establish the mechanism; deleting a mapping is higher blast radius with no agent-shaped upside.
- **Per-token connection scoping** — #1489.
- **New mapping capabilities or ports** — Phase 2 consumes `IMappingConfigService` / `ICategoryResolutionService` / `IAttributeProjectionService` as published.

---

## 3. Design

### 3.1 🔴 Per-tool scope + role enforcement — the net-new mechanism

Today `requireBearerAuth({ requiredScopes: ['mcp:read'] })` gates the whole `/mcp` route. Because
`McpTokenService.expandScopes` stores **both** scopes on a write token (`mcp:write` ⇒
`['mcp:read','mcp:write']`), a read-only token passes the route gate and would reach a write tool.
The issue's AC — *"a read-only token is refused"* — therefore needs a new enforcement point.

`McpToolDefinition` grows two fields:

```ts
readonly requiredScope: McpTokenScope;   // 'mcp:read' default; 'mcp:write' for writes
readonly requiresAdmin: boolean;         // true for writes — ADR-034 "admin-scoped"
```

Enforced in **two places, deliberately**:

1. **Registration** (`registerTools`) — a principal lacking the scope/role never sees the tool in
   `tools/list`. Better agent UX (it won't plan around a tool it can't call) and a smaller surface.
2. **Call time** (the per-call wrapper) — because registration filtering is a *listing* concern, not a
   guard. An MCP client may call any name it likes; nothing stops it invoking an unlisted tool. Only
   the call-time check actually refuses.

Enforcement lives in the Phase-1 wrapper, before the rate-limiter acquire, so a refused call consumes
no budget. Both refusals are agent-facing copy naming what is missing (`mcp:write` scope / admin role),
and both emit an audit line with a new `outcome: 'forbidden'`.

**Role source**: `extra.olRole` (already on the redacted principal). The token *inherits its owner's*
RBAC role (#1486), so `requiresAdmin` is checked against the owner — a non-admin cannot mint a
privileged token.

### 3.2 Discovery tools (read, `mcp:read`)

| Tool | Source | Notes |
|---|---|---|
| `list_category_mappings` | `IMappingConfigService.getCategoryMappings(destinationConnectionId)` | The "what's already mapped" read the loop starts from |
| `suggest_category` | `ICategoryResolutionService.resolveCategory(input)` | The LLM-shaped one. `barcode` drives the `EanCategoryMatcher` step internally, so **no separate EAN tool is needed**; `sourceCategoryIds` drives the mapping step |
| `project_attributes` | `IAttributeProjectionService.project(input)` | Shows what the destination would receive for a given category + attribute set — the "did my mapping work?" read |
| `list_attribute_mappings` | `IMappingConfigService.getAttributeMappings(destinationConnectionId)` | Companion to the above |

All four are gated on `requiredCapability: null` (always registered). **Deliberate**: mapping config is
OL-owned data, not adapter-served — gating it on a marketplace capability would repeat the Phase-1
confusion where a gate implies nothing about the data. `suggest_category` *does* reach an adapter
internally, and surfaces that as an agent-facing error when the connection can't browse categories.

### 3.3 The write tool (`mcp:write` + admin)

`upsert_category_mapping` → `IMappingConfigService.upsertCategoryMapping(destinationConnectionId, input)`
with the neutral `CategoryMappingInput` (`sourceCategoryId`, `destinationCategoryId`,
`destinationCategoryName`, optional `destinationCategoryPath` / `sourceConnectionId`).

⚠️ **Do not re-import the legacy `allegro*` / `prestashop*` HTTP DTOs** from
`apps/api/src/mappings/http/dto/*` (the issue's own warning). The tool builds `CategoryMappingInput`
directly from its Zod schema.

**Why writes are safe here without server-side two-phase confirm** (ADR-034): a category mapping is
correctable, carries no secrets, and is scoped to one destination connection. v1 HITL is the client's
tool-approval UX plus the coarse consent implied by an operator minting and installing an
admin-scoped, write-scoped token. Recorded so Phase 3 doesn't have to re-derive it.

### 3.4 No-secret invariant

The issue requires "no secrets in any tool arg or return". Mapping data carries none, but the
invariant needs a test rather than an assumption — `list_category_mappings` returns a projection, and a
spec asserts the projected keys are exactly the expected set, so a field added to `CategoryMapping`
later cannot silently start flowing. Same pattern as Phase 1's `list_connections`.

### 3.5 The Skill

`.claude/commands/configure-mappings.md` (skills in this repo are commands — there is no
`.claude/skills/`). Encodes: `list_category_mappings` → `suggest_category` → present to operator →
`upsert_category_mapping` → re-read to confirm. States that the write needs a write-scoped admin token
and that the agent must show the suggestion before writing.

### 3.6 Module layout

```
apps/api/src/mcp/tools/
  tool-definition.types.ts          # CHANGED: + requiredScope, requiresAdmin, 'forbidden' outcome
  tool-registry.service.ts          # CHANGED: registration filter + call-time refusal
  mcp-tool-definitions.provider.ts  # CHANGED: + 5 tools, + IMappingConfigService & friends
  read/list-category-mappings.tool.ts
  read/list-attribute-mappings.tool.ts
  read/suggest-category.tool.ts
  read/project-attributes.tool.ts
  write/upsert-category-mapping.tool.ts    # NEW directory — the write half
  mcp.module.ts                     # CHANGED: + MappingsModule, ListingsModule(services)
```

---

## 4. Implementation Steps

| # | Step | Acceptance |
|---|---|---|
| 1 | `tool-definition.types.ts` | `requiredScope` + `requiresAdmin` on the definition; `'forbidden'` added to the outcome union |
| 2 | Registry enforcement | Registration omits tools the principal can't call; call time refuses with agent-facing copy **before** the limiter; audit `outcome: 'forbidden'` |
| 3 | 4 discovery tools | Each reads its core `I*Service`, projects, maps errors; `requiredScope: 'mcp:read'` |
| 4 | `upsert_category_mapping` | `mcp:write` + `requiresAdmin`; neutral `CategoryMappingInput`; no legacy DTO import |
| 5 | Module wiring | `MappingsModule` + listings services imported; API boots |
| 6 | `configure-mappings` Skill | discover→suggest→confirm→write loop; names the token requirement |
| 7 | Docs | ADR-033 Phase-2 note; write-tool rules in `engineering-standards.md`; `architecture-overview.md` |
| 8 | Tests | §5 |

---

## 5. Testing Strategy

**Unit**
- `tool-registry.service.spec.ts` (extend) — **the scope/role matrix is the point of this phase**: a read-only principal doesn't see the write tool in `tools/list` AND is refused when calling it by name anyway; a non-admin write-scoped principal is refused; an admin write-scoped principal succeeds; a refused call **does not consume a rate-limit slot** and emits `outcome: 'forbidden'`.
- One spec per tool — happy path, projection asserts non-projected fields absent, error mapping.
- `upsert_category_mapping` spec — passes a neutral `CategoryMappingInput` through; rejects unknown keys.

**Integration** (`mcp-mapping-tools.int-spec.ts`) — mint a **read-only** token and a **write** token against a real DB; assert the read-only token's `tools/list` omits the write tool and its `tools/call` is refused, and that the write token's call actually persists a mapping (re-read via `list_category_mappings`).

> `loginAsAdmin` at most **once** per test. Run one int-spec via
> `--testRegex="<file>\.int-spec\.ts$"` (a CLI `--testPathPattern` is silently ignored — the config sets `testRegex`).

---

## 6. Documentation Impact

- **ADR-033** — Phase-2 note: where scope/role enforcement lives and why both registration + call time.
- `engineering-standards.md § MCP tools` — write-tool rules (declare `requiredScope`; never enforce scope in a tool file).
- `architecture-overview.md` — Phase 2 surface.
- `implementation-plan-mcp-server.md` — mark Phase 2 shipped; carry the options-tools deferral.
- `.env.example` — nothing new.

---

## 7. Risks & the decision I want

| Risk | Severity | Note |
|---|---|---|
| **Scope: drop the order-mapping options tools?** | **Decision** | The issue lists `DestinationOptionsReader` / `SourceOptionsReader` discovery tools for status/carrier/payment. **I recommend deferring them.** Three reasons: (a) the issue's own warning says status/carrier/payment are "only partially neutralized per ADR-023/#1036", so tools would bind to a surface mid-refactor; (b) they are enum-pairing, not the semantic matching the issue calls "exactly LLM-shaped" — the ROI argument doesn't cover them; (c) they'd roughly double the tool count and the review surface for the phase whose real purpose is establishing the **write mechanism**. Including them is defensible if you want the phase to match its issue text exactly. |
| Registration filtering could be read as the security boundary | Medium | Mitigated by design (§3.1: call-time refusal is the guard) and by a spec that calls an unlisted tool by name |
| First write tool on the MCP surface | Medium | Correctable, no secrets, single-connection scope; admin + write-scope + audit. ADR-034's v1 HITL posture recorded in §3.3 |
| Capability gate misread as a data guarantee | Low | §3.2 — mapping tools are ungated precisely to avoid it |

---

## 8. Validation Checklist

- [ ] No `*RepositoryPort` in `apps/api` — reads go through `I*Service` + Symbol token only
- [ ] No legacy `allegro*`/`prestashop*` HTTP DTO imported by any tool
- [ ] No tool file imports the limiter, the audit logger, or performs its own scope check
- [ ] Every tool result is an explicit-allowlist projection
- [ ] A read-only token is refused at call time, not merely hidden from `tools/list`
- [ ] `as const` unions; types in `*.types.ts`; file header on every new file
- [ ] No `any`, no `console.log`, no hardcoded secrets
- [ ] `pnpm lint` / `type-check` / `test` green; `test:integration` for the tool slice
