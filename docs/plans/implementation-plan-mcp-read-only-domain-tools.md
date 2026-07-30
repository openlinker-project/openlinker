# Implementation Plan: MCP Phase 1 — Read-only domain tools

**Issue**: #1487 (Phase 1 of EPIC #1350; unblocked by #1486 / PR #1912)
**Date**: 2026-07-29
**Status**: Ready for Review
**Branch**: `1487-mcp-read-only-domain-tools`

> Rationale: [ADR-033](../architecture/adrs/033-openlinker-as-mcp-server.md) /
> [ADR-034](../architecture/adrs/034-mcp-authorization-user-issued-pats.md).
> Phased breakdown: [implementation-plan-mcp-server.md § Phase 1](./implementation-plan-mcp-server.md).

---

## 0. What Phase 0 already gives us

Verified on `main` (`46fea4af`) — this plan builds on it and changes none of it:

| Landed | Consequence for Phase 1 |
|---|---|
| `OlMcpTokenVerifier implements OAuthTokenVerifier` + `requireBearerAuth` on `/mcp` | Auth is done. Tools need no auth code of their own |
| Principal arrives as **`ctx.authInfo`** (NOT `ctx.http.authInfo`) with OL identity in `AuthInfo.extra` | Tools read `extra` via the existing `isMcpAuthInfoExtra` guard |
| 🔴 `AuthInfo` carries the **raw bearer token** | The audit log MUST log the redacted `extra` projection, never `AuthInfo` |
| `createMcpHandler(factory)` builds a **fresh `McpServer` per request** (stateless) | `tools/list` is per-principal and the *server* is always fresh — see §3.1 for the client-cache caveat |
| `mcp-server.factory.ts` with one `whoami` tool | Phase 1 replaces the hard-coded tool with a registry-driven registration |
| Transport fails **closed** when `req.auth` is absent | Tools can assume a principal is present; still narrow defensively |

---

## 1. Task Summary

**Objective**: expose OL's highest-utility, lowest-blast-radius reads as MCP tools — catalog search + product read, availability, order read — behind a **dynamic, capability-declared `tools/list`**, plus `list_connections` for discovery, a per-call audit log, and a per-token abuse cap.

**Classification**: **Interface** layer only (`apps/api/src/mcp/`). No new capability port, no domain entity, no migration, and — unlike Phase 0 — **no CORE slice**: every read already has a published core service interface, and the principal already arrives resolved.

---

## 2. Scope & Non-Goals

### In scope
1. `ToolRegistryService` — dynamic, per-principal, capability-declared tool list.
2. Four read tools: `search_catalog`, `get_product`, `get_availability`, `get_order`.
3. `list_connections` — tells the agent which `connectionId` backs which tool.
4. Per-call audit log (redacted principal + connection + tool + outcome).
5. Per-token rate + concurrency cap (net-new Redis limiter).
6. Register the `*.tool.ts` file-suffix convention in `engineering-standards.md`.

### Non-goals
- **Any write/mutating tool** — Phase 2/3 (#1488/#1489).
- **Per-token connection scoping** — #1489. Reads run at the principal's existing global scope (OL is single-tenant, ADR-034).
- **A Phase-1-local PII policy** — *resolved, not deferred*: reads come from OL's own store, which already applies the operator's `OL_STORE_PII` decision. See §3.4.
- **New capability ports** — Phase 1 introduces no port and calls no adapter on the read path. See §3.3.
- **Live platform round-trips on the read path** — deliberately excluded; §3.3.
- **`notifications/tools/list_changed`** — see §3.1; not implementable under the stateless model. The cost (a connected client's cached list going stale) is accepted, not absent.

---

## 3. Design

### 3.1 🔴 `tools/list_changed` — the issue's AC does not survive contact with Phase 0

The issue asks that "adding/removing a connection republishes via `notifications/tools/list_changed`". **That is not implementable under the transport ADR-033 chose** — and the cost of dropping it is real, so it is accepted rather than dismissed.

`createMcpHandler` constructs a **fresh `McpServer` per HTTP request** (Phase 0, endorsed by ADR-033 for multi-replica safety — no sessions, no sticky routing). `sendToolListChanged()` exists on the server, but a push notification needs a long-lived session to push *over*; there is none. The SDK confirms the client half only activates when the server advertises `tools.listChanged: true`.

**`tools/list` is recomputed from live capability state on every call**, so the *server* is always fresh. That does NOT make the notification pointless, though — a **client's cached** list can still go stale, which is exactly what the notification is for. See ADR-033 § Phase 1 amendments for the corrected reasoning and the accepted cost.

**Decision**: do not advertise `tools.listChanged`, do not call `sendToolListChanged()`. Record the reasoning in the ADR + the issue. The alternative — moving to sessionful serving — would reverse ADR-033 and Phase 0's multi-replica-safety property to gain one convenience on a surface whose demand is unproven. The cost (a connected client not seeing a newly enabled tool until it reconnects) is accepted, not absent.

### 3.2 Tool registry — capability-declared, never a static catalog

```ts
interface McpToolDefinition {
  readonly name: string;                 // stable: `search_catalog`, never `search_catalog__allegro-main`
  readonly requiredCapability: string;   // 'ProductMaster' | 'InventoryMaster' | 'OrderSource'
  readonly description: string;
  readonly inputSchema: StandardSchemaWithJSON;
  readonly handler: McpToolHandler;
}
```

`ToolRegistryService implements IToolRegistryService` resolves, per request:

```
for each distinct requiredCapability among the definitions:
  listCapabilityAdapters({ capability, lazy: true })   ← lazy: no adapter construction just to list
  → capability is "available" iff ≥ 1 entry
register every definition whose capability is available
```

`listCapabilityAdapters` already intersects `metadata.supportedCapabilities` with the connection's `enabledCapabilities` (per `ConnectionInfraHealthService`'s note), so both halves of the gate come free. `lazy: true` is the same choice that service makes.

`connectionId` is a **validated tool argument**, never baked into the name — otherwise the surface explodes to N connections × M capabilities.

**Tool errors are agent-facing copy.** An LLM reads the error and decides what to do next, so messages are mapped deliberately rather than leaking internal exception text — an unknown/unsupported `connectionId` yields *"connection {id} does not support {capability}; call `list_connections` to see which do"*. One small mapping step at the tool boundary; asserted in the per-tool specs.

### 3.3 🔴 Data source: OL's own store, not a live platform round-trip

The issue names capabilities (`ProductMaster` / `InventoryMaster` / `OrderSource`), and the first draft of this plan read that as a mandate to call those **ports**. That is the wrong reading, and the deep review caught it. OL already owns a canonical, internal-id-keyed, PII-policy-aware store for all four reads.

**Decision: hybrid.** Capability-declared *registration* is retained exactly as designed (§3.2) — it is what makes `tools/list` dynamic per ADR-033. The *data* comes from core service interfaces, and `connectionId` becomes a **narrowing filter**, not an adapter selector.

Why the port path was wrong on all four counts:

1. **It turns `OL_STORE_PII` compliance into a duplicated policy with an unsafe default.** `OL_STORE_PII` governs *persistence*, so a port-path tool that projected PII away would not literally violate it — the precise costs are that (a) "honour `OL_STORE_PII` as a floor" is **incoherent** there (no stored floor to honour; you would reimplement `persistOrder`'s nulling rule, leaving one privacy policy in two places), and (b) the **default** forwards to an LLM vendor exactly what the operator opted out of storing. Reading `OrderRecord` inherits the decision for free instead.
2. **It spends the operator's marketplace API quota on the agent's behalf.** One tool call = one live Allegro/PrestaShop request. The §3.6 limiter caps *OL* calls; it cannot cap downstream cost, which is the scarcer resource.
3. **It breaks identifier consistency.** `OrderSourcePort` is documented as an *ingestion* port — "identifier mapping happens in core services" — so it returns external-id-keyed data, which the agent cannot join against internal-id-keyed product reads.
4. **It bypasses the variant-keyed availability model.** `InventoryMasterPort.getAvailableQuantity` is product-level; `IInventoryQueryService.getAvailabilityByVariantIds` is the variant-keyed read the rest of OL uses per ADR-010 / #822 / #823.

| Tool | Registration gate | Data source (verified) | Notes |
|---|---|---|---|
| `search_catalog` | `ProductMaster` | `IProductsService.listProducts(filters, pagination, sort?)` | `ProductListFilters.search` is case-insensitive name/SKU; `sourceConnectionId` narrows by connection — an exact fit |
| `get_product` | `ProductMaster` | `IProductsService.getProduct(id)` + `getVariantsByProductId(id)` | returns `null` cleanly for unknown ids |
| `get_availability` | `InventoryMaster` | `IInventoryQueryService.getProductStockAggregates(productIds)` — or `getAvailabilityByVariantIds(variantIds)` when the caller passes variant ids | see §3.3.2 |
| `get_order` | `OrderSource` | `IOrderRecordService.getOrderRecord(id)` / `findMany(filters, pagination)` | PII posture inherited from `OL_STORE_PII` |
| `list_connections` | *(none)* | `ConnectionService.list(filters?)` — §3.3.1 | always registered; the discovery entry point |

Tokens: `PRODUCTS_SERVICE_TOKEN`, `INVENTORY_QUERY_SERVICE_TOKEN`, `ORDER_RECORD_SERVICE_TOKEN` — all published `I*Service` + Symbol pairs, so this is a compliant cross-context surface per `architecture-overview.md § Cross-context dependencies in core`.

This materially **shrinks** the work: no adapter construction on the read path, no external failure modes to map, and `lazy: true` matters only for registration.

#### 3.3.0 🔴 The gate and the data source are independent facts

Registration is capability-gated (§3.2); the data comes from OL's own store. After the §3.3 correction these are **no longer the same fact**, and the plan must not read as though the gate proves data availability:

- A `ProductMaster` connection that was since **disabled** removes `search_catalog` from `tools/list` even though OL still holds its fully-synced catalog.
- A **freshly added** `ProductMaster` connection publishes the tool immediately, before any sync has run — the agent gets an empty catalog.

This is the intended semantics: the gate answers *"is this deployment in the products business?"*, not *"is there data?"*. Because an agent cannot distinguish "no data" from "not configured" from an empty array, **every tool's `description` must say which it is** — the description is the only channel the agent reads before deciding what to do next. Asserted in the per-tool specs.

#### 3.3.1 `list_connections` — source and projection

`IIntegrationsService` exposes only four methods (`getAdapter`, `getCapabilityAdapter`, `resolveAdapterMetadata`, `listCapabilityAdapters`) — **none enumerates connections**. The source is `IConnectionService.list(filters?)`, injected via `CONNECTION_SERVICE_TOKEN` (`apps/api/src/integrations/application/interfaces/connection.service.interface.ts:23`) — an interface + Symbol pair, so this stays compliant with the "code against an interface" rule rather than injecting the concrete `ConnectionService`.

The tool **projects** — `id`, `name`, `platformType`, `status`, `enabledCapabilities` — and never returns a `Connection` wholesale: the entity carries `credentialsRef` (a credential pointer) and a free-form operator `config` JSONB. Same discipline as §3.5.

#### 3.3.2 `connectionId` is not uniformly meaningful

The hybrid model changed what `connectionId` does per tool, and two of the four cases are **not** "scope the read to that connection":

| Tool | What `connectionId` actually does |
|---|---|
| `search_catalog` | Filters by **provenance** — `ProductListFilters.sourceConnectionId` matches products that have a Product identifier mapping for that connection (`product.types.ts:158`). It is *not* "products currently listed there"; the description must say so, or an agent will read it as a listing filter |
| `get_product` | Not accepted — `getProduct(id)` is a direct internal-id read |
| `get_availability` | **Not accepted.** Neither `getProductStockAggregates` nor `getAvailabilityByVariantIds` takes a connection; both are global reads. Rather than accept-and-ignore the argument (worse than either alternative — an agent would infer it scoped the read), the tool omits it from its input schema entirely |
| `get_order` | Filters by `OrderRecordFilters.sourceConnectionId` — genuinely scoping |

Accepting an argument that silently does nothing is the failure mode being avoided here; where the underlying read has no connection axis, the schema says so by omission.

### 3.3.3 🔴 One choke point for both cross-cutting concerns

The audit log (§3.4) and the rate limiter (§3.6) are per-call and tool-agnostic. If each tool handler invoked them itself, five files would each have to remember to start a timer, acquire a slot, **release it on both success and throw**, and emit the audit line on both paths — six chances to miss one, and a missed release leaks a concurrency slot permanently (the precise failure the ZSET rework exists to prevent).

**Both run in a single wrapper applied at registration time inside `ToolRegistryService`.** The registry already visits every definition exactly once, so wrapping `definition.handler` there makes enforcement *structural* rather than a convention each tool file must honour. `list_connections` and `whoami` go through the same wrapper — no tool is exempt.

Ordering is fixed:

```
acquire limiter slot         → over limit ⇒ tool error, no handler call, audit outcome 'rate-limited'
  try    { await handler() } → outcome 'ok'
  catch  { … }               → outcome 'error'
  finally{ release slot }    → release is idempotent (ZREM), so double-release is harmless
emit audit line              → always, on every path
```

Individual tool files therefore contain **only** their read + projection. They never import the logger or the limiter.

### 3.4 Audit log

One structured line per call via the shared `Logger`:

```ts
{ tool, connectionId, outcome: 'ok' | 'error', durationMs,
  ...redactPrincipal(authInfo)   // { mcpTokenId, olUserId, olRole } from extra — NEVER the AuthInfo
}
```

Reuses `McpAuthInfoExtra` / `isMcpAuthInfoExtra` from Phase 0. A dedicated `redactPrincipal` helper makes the invariant a function rather than a convention, and is unit-asserted to omit `token`. Emitted from the §3.3.3 wrapper — which is also where the redaction invariant is asserted at the registry boundary, since that is the single point where every tool's principal is handled.

### 3.5 Result-size discipline (not in the issue, but load-bearing)

Tool results are fed to an LLM. Every tool caps and projects:
- `search_catalog` takes `limit` (default 20, max 100), passed through as `ProductPagination`, and returns a **narrow projection** (id, name, sku, price), not raw `Product` entities.
- `get_order` returns a projection of `OrderRecord`, not the raw snapshot graph.
- `list_connections` projects per §3.3.1.

Projection is a security control here, not only a context-budget one: it is what keeps `credentialsRef`, operator `config`, and unreviewed snapshot fields out of an LLM provider's hands.

### 3.6 Per-token rate + concurrency cap

Net-new — the issue is right that no reusable primitive exists (no `@nestjs/throttler`; `CachePort` is KV-only with no atomic increment). Built on the raw `'REDIS_CLIENT'` (`@Global` from `RedisConfigModule`), following `RedisPickupPointQueryStatsAdapter`'s precedent for reaching past `CachePort` — including its "if a second consumer appears, promote a port" note.

- **Rate**: ZSET rolling window keyed `mcp:ratelimit:{mcpTokenId}` — `ZREMRANGEBYSCORE` to evict, `ZCARD` to count, `ZADD` + `EXPIRE`.
- **Concurrency**: the **same ZSET primitive**, keyed `mcp:inflight:{mcpTokenId}`, holding in-flight request ids scored by start time. Acquire = `ZADD`; release = `ZREM`; a crashed request ages out via `ZREMRANGEBYSCORE` against a max-request-lifetime floor before each `ZCARD`.
  > An earlier draft used `INCR`/`DECR` with a TTL. That leaks: a TTL expires the *shared* counter (dropping live requests' slots), and a `DECR` arriving after expiry drives the key negative, silently raising the effective cap. One primitive, one failure model, and `ZREM` is idempotent so double-release is harmless.
- **Redis outage → fail open**, logged at `warn`. Rationale: the limiter is abuse mitigation, not an authorization control — auth is already enforced upstream by `requireBearerAuth` (Phase 0). Failing closed would let a Redis blip take down the entire authenticated MCP surface, trading a real availability loss for a speculative abuse window. Asserted by a spec case.
- Over limit → a tool error (the MCP-level equivalent of 429), not a transport 429 — the call is already authenticated and inside the protocol.
- Env-tunable, clamped, defaults documented in `.env.example`.

**This is the separable slice** — see §7.

### 3.7 Module layout

```
apps/api/src/mcp/
  tools/
    tool-registry.service.ts            # implements IToolRegistryService; owns the §3.3.3 wrapper
    tool-registry.service.interface.ts
    tool-definition.types.ts
    read/whoami.tool.ts                 # MOVED from mcp-server.factory.ts (§3.7 note)
    audit/mcp-audit.logger.ts           # redactPrincipal + one-line-per-call
    ratelimit/mcp-rate-limiter.ts       # + .interface.ts (§3.6)
    read/search-catalog.tool.ts
    read/get-product.tool.ts
    read/get-availability.tool.ts
    read/get-order.tool.ts
    read/list-connections.tool.ts
  transport/mcp-server.factory.ts       # CHANGED: registry-driven registration
  mcp.module.ts                         # CHANGED: providers + FOUR imports (below)
```

`mcp.module.ts` imports **four** modules:

- the **host** `IntegrationsModule` (`apps/api/src/integrations/`) — it exports both `CONNECTION_SERVICE_TOKEN` *and* re-exports `CoreIntegrationsModule`, so this one import covers capability gating **and** `list_connections`. Note both modules are literally named `IntegrationsModule`; alias the import to avoid a shadowing bug.
- `ProductsModule`, `InventoryModule`, `OrdersModule` — the three core read services.

`RedisConfigModule` is `@Global`, so `'REDIS_CLIENT'` needs no import.

`whoami` **moves out of the factory into `read/whoami.tool.ts`**. This is not optional tidying: the factory's own header states it lives inline only because #1487 owns registering the `*.tool.ts` convention, and that pre-empting it "would fork the decision." This PR registers the convention, so it also discharges that standing note — and moving it is what puts `whoami` behind the §3.3.3 wrapper like every other tool. It stays always-registered (never capability-gated).

---

## 4. Implementation Steps

| # | Step | Acceptance |
|---|---|---|
| 1 | `tool-definition.types.ts` | `as const` capability list; no `any` |
| 2 | `redactPrincipal` + audit logger | Unit test asserts the raw token never appears in output |
| 3 | `list_connections.tool.ts` | Projects id/name/platformType/status/enabledCapabilities from `ConnectionService.list()`; never returns `Connection` wholesale; always registered |
| 4 | Four read tools + `whoami` move | Each reads via its core `I*Service` (§3.3), projects + caps its result. `connectionId` accepted only where meaningful (§3.3.2). Description states the gate-vs-data semantics (§3.3.0). No tool imports the logger or limiter (§3.3.3) |
| 5 | `ToolRegistryService` + interface | Registers a tool iff ≥1 connection supports+enables its capability; `lazy: true`; **owns the §3.3.3 wrapper** (limiter + audit + error mapping) applied to every definition |
| 6 | Rate limiter + interface | Two ZSETs (window + in-flight); crash ages out; fails open on Redis outage |
| 7 | Factory + module wiring | Registry-driven; `whoami` no longer inline; four modules imported (§3.7); API boots |
| 8 | Docs | `.tool.ts` convention in `engineering-standards.md`; `list_changed` + data-source decisions in ADR-033 + issue; `.env.example` |
| 9 | Tests | §5 |

---

## 5. Testing Strategy

**Unit**
- `tool-registry.service.spec.ts` — a capability with no supporting connection has **all** its tools absent; a base port (`ProductMaster`) backs **two** tools; `list_connections` + `whoami` always present; `lazy: true` asserted. **Wrapper cases (§3.3.3), the ones hand-written per-tool code gets wrong**: a handler that *throws* still releases its in-flight slot AND still emits an audit line; an over-limit call never invokes the handler; the emitted line never contains the raw token (the redaction invariant, asserted at the boundary where every principal is handled).
- One spec per tool — happy path, capability-gate rejection yields the mapped agent-facing message, result cap enforced, projection omits non-projected fields (`list_connections` asserts `credentialsRef` / `config` absent). `get_availability` asserts it takes no `connectionId` (§3.3.2).
- `mcp-audit.logger.spec.ts` — **the raw token never reaches the log** (the Phase-0 invariant, re-asserted at its new consumer).
- `mcp-rate-limiter.spec.ts` — window eviction, over-limit, in-flight release on both success and throw, stale in-flight entry ages out, **Redis outage fails open with a `warn`**.

**Integration** (`mcp-tools.int-spec.ts`): authenticated principal → `tools/list` → capable read tool → audit assertion; plus a connection lacking the capability yielding a tool error.

> `loginAsAdmin` at most **once** per test (`reference_int_spec_login_once_per_test`).

---

## 6. Documentation Impact

- `engineering-standards.md` — register the `*.tool.ts` suffix (the issue explicitly assigns this here).
- **ADR-033** — record two decisions: the `list_changed` drop (§3.1), and the **read-path data source** (§3.3) — tools are capability-*gated* but OL-store-*backed*, which is the posture every later phase inherits.
- `implementation-plan-mcp-server.md` — mark Phase 1 shipped; carry the `list_changed` correction.
- `.env.example` — rate-limit knobs.
- `docs/lessons.md` — only if something empirical emerges; no speculative entry.

---

## 7. Risks

Both decisions flagged in the previous draft **dissolved** under the §3.3 data-source correction rather than being answered:

- **PII in `get_order`** — no longer a Phase-1 decision. Reading `OrderRecord` inherits the operator's existing `OL_STORE_PII` posture, so OL's own deliberate policy governs. The previously-offered option "ship it full and honour `OL_STORE_PII` as a floor" was in fact *not implementable* on the port path, which is what exposed the underlying problem.
- **Rate-limiter scope** — keep it in this PR. It is an issue AC, and an unthrottled tool surface is exactly what a looping agent abuses. It also got simpler under review (one primitive, not two).

| Risk | Severity | Note |
|---|---|---|
| Reads are OL-store, so they are only as fresh as the last sync | Low–Medium | Correct trade for Phase 1: bounded, cheap, PII-correct, internal-id-consistent. A future explicit `refresh_*` tool can go to the platform deliberately, rather than every read doing so implicitly |
| `list_changed` AC dropped | Low | §3.1 — grounded in the SDK + ADR-033; documented, not silently skipped |
| SDK v2 is days old | Medium | Same mitigation as Phase 0: thin surface, verify against installed `.d.cts` not docs |
| Result size → context blowup | Low | §3.5 caps + projections |
| Limiter fails open on Redis outage | Low | Deliberate (§3.6); auth is enforced upstream and unaffected |

---

## 8. Validation Checklist

- [ ] No `*RepositoryPort` imported into `apps/api` (`check-cross-context-imports`) — reads go through `I*Service` + Symbol token only
- [ ] Capability *gating* uses `listCapabilityAdapters`; no concrete adapter is ever named
- [ ] Every tool result is a projection — no `Connection`, `Product`, or `OrderRecord` returned wholesale
- [ ] `AuthInfo` never logged/serialized wholesale; `redactPrincipal` is the only path
- [ ] `as const` unions; types in `*.types.ts`; file header on every new file
- [ ] Services implement an `I*Service` (note: `check-service-interfaces` scans `libs/core` only — not machine-enforced here)
- [ ] No `any`, no `console.log`, no hardcoded secrets
- [ ] `pnpm lint` / `type-check` / `test` green; `test:integration` for the tool slice
