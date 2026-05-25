# Implementation Plan — #836 Shipment-routing config (API + FE)

**Issue:** [#836](https://github.com/openlinker-project/openlinker/issues/836) (Part of #732)
**Branch:** `836-shipment-routing-config`
**Spec:** `docs/specs/product-spec-732-allegro-delivery-shipment.md` §5 US-1 / AC-1
**Builds on:** #832/#842 (core `FulfillmentRoutingService` + `fulfillment_routing_rules` table, ADR-012) — **merged**

---

## 1. Understand the task

Expose the #832 fulfillment-routing model to operators as a **"default vs divert"** config: each Allegro **source delivery method** defaults to **PrestaShop (OMP-fulfilled)** — today's behaviour, the no-rule state — and the operator can **divert** specific methods to an `ol_managed_carrier` (InPost) or `source_brokered` (Allegro Delivery) processor. #832 shipped core-only (service + table + ADR-012), so this slice adds the **HTTP API** (none exists yet) + the **FE config UI**.

**Layer:** Interface (API) + Frontend, plus one additive core method (`getCandidateProcessors`, see §3). The service contract `IFulfillmentRoutingService` already exists.

**Ship independently (grill-me decision):** the routing model is **inert until a consumer wires `resolve()`** (#835 for InPost, #837/#838 for Allegro Delivery). #836 is the *config plane*; consumers are the *execution plane*; `IFulfillmentRoutingService` is the seam. Per the hexagonal contract-as-seam principle — and mirroring #832 itself (model shipped with no consumer, validated by an int-spec) — **#836 ships against the contract independently, NOT coupled to #835's merge.** The UI degrades honestly: divert options are capability-derived, so when no divert-capable connection exists the only option rendered is "PrestaShop (default)" (a no-op by definition).

**Non-goals:** method-granular eligibility (OQ-B1, deferred to #833); the resolve-path wiring (#835/#837/#838); branch-1 read-back (#834); the Allegro Delivery / InPost shipment surfaces (#839); explicit `omp_fulfilled`-pinned-to-a-specific-OMP rules (a **multi-OMP future** need — v1 leaves PS as the rule-absence default). This is *only* the routing-rule config screen + its API.

## 2. Research — established patterns to mirror

- **API:** `apps/api/src/mappings/http/mappings.controller.ts` — `@Controller('connections/:connectionId/mappings')`, `@Roles('admin')`, GET/PUT per mapping type delegating to `IMappingConfigService`, DTO `*.fromDomain()` mappers. Mirror for routing rules.
- **Core service (reuse as-is):** `IFulfillmentRoutingService` (`@openlinker/core/mappings`, token `FULFILLMENT_ROUTING_SERVICE_TOKEN`) — `getRules(connId)` / `replaceRules(connId, items)` / `resolve(query)`. `replaceRules` already validates compatibility, throwing `IncompatibleProcessorException` / `DuplicateRoutingRuleException`.
- **Compatibility rules** (from `assertCompatible`): `omp_fulfilled` → processor connection declares `OrderProcessorManager`; `ol_managed_carrier` → declares `ShippingProviderManager` AND ≠ source; `source_brokered` → declares `ShippingProviderManager` AND == source.
- **Source delivery methods:** reuse the same source the carrier-mapping UI keys against (`mapping-options` / `useMappingOptions` → Allegro `/sale/delivery-methods`).
- **FE:** `features/mappings/` — `MappingPanel.tsx`, `hooks/use-carrier-mappings.ts`, `api/mappings.{api,types,query-keys}.ts`, rendered by `pages/connections/connection-mappings-page.tsx`. Mirror for a routing-rules panel.

## 3. Design

**API** — new `FulfillmentRoutingController` at `connections/:connectionId/routing-rules` (kept separate from `MappingsController` to avoid mixing service tokens):
- `GET /routing-rules` → `getRules` → `RoutingRuleResponseDto[]`
- `PUT /routing-rules` → `replaceRules` → `RoutingRuleResponseDto[]` (body `UpsertRoutingRulesDto { items: RoutingRuleInputDto[] }`)
- **Exception mapping — must cover the FULL set `replaceRules` raises**, not just the two validation ones. `replaceRules` calls `integrations.getAdapter(...)` for the source *and* every processor connection, which can throw `ConnectionNotFoundException` / `ConnectionDisabledException` in addition to `IncompatibleProcessorException` / `DuplicateRoutingRuleException`. Map: `IncompatibleProcessor` / `DuplicateRoutingRule` / `ConnectionDisabled` → **400**; `ConnectionNotFound` → **404**. Anything unmapped must not fall through to a 500 on ordinary bad input.

**Compatibility-filtered dropdown (AC-1) — DECIDED: option B (backend candidates endpoint).** The FE must offer *only compatible* processors per method. Option A (derive client-side from connections + `supportedCapabilities`) was **rejected**: it would duplicate the backend's `assertCompatible` capability/topology rules in the FE — exactly the anti-pattern frontend-architecture.md § App Boundary forbids ("do not duplicate backend validation or authorization rules as a source of truth"), and it would drift from `assertCompatible` the moment either side changes.

**B (candidates endpoint) — read-side projection of the SAME compatibility predicate, not a parallel impl.** Add `getCandidateProcessors(sourceConnectionId)` to `IFulfillmentRoutingService` returning **`{ processorKind, processorConnectionId }[]`** (IDs + enum only — **no `connectionName`/`label`**, see review note), exposed via `GET /routing-rules/candidates`. **Extract the per-kind capability/topology predicate currently inlined in `assertCompatible`** into a shared helper that *both* `assertCompatible` (write-path validation) and `getCandidateProcessors` (read-path offer-set) call — so the dropdown can never offer something the PUT then 400s on, nor hide something it would accept. Compatibility stays authoritative in core (the service already injects `IIntegrationsService`). **Enumerate candidates from capability *metadata* (`supportedCapabilities`), not by instantiating every adapter** — avoid N adapter resolutions just to list. The FE renders each candidate's connection via `ConnectionEntityLabel` (name-first, cached `useConnectionsQuery`) and maps `processorKind → label` client-side (i18n-able, FE presentation) — so core takes **no** dependency on `Connection.name`.

**Capability-driven degradation (no explicit suppression).** Divert options are *uniformly* "a connection that declares the capability this kind requires" — `ol_managed_carrier` → InPost connections declaring `ShippingProviderManager`; `source_brokered` → the Allegro connection *iff* it declares `ShippingProviderManager` (it won't until #833). So **#836 special-cases nothing**: Allegro Delivery appears automatically when #833 lands, with zero #836 change. Gate on capability (which the registry models), not consumer-liveness (which it doesn't).

**FE — "default vs divert" semantics:**
- "**Default**" = **rule absence** (the schema *forces* this: `processor_connection_id` is NOT NULL, so a "default/PS" row can't be stored; `resolve()` returns `source:'default'` only as a computed fallback). The panel **fabricates** a "PrestaShop (default)" row per live method for *display*; on save only **diverted** methods go into the replace-all `items[]`. Switching a method back to default = drop it from `items[]` (the replace-all delete removes the row). Never persist an explicit `omp_fulfilled` row in v1 — doing so would re-pin to the partner and erase the `source:'default'` signal #837 may branch on.
- **Lead with processor *kind*; auto-resolve the connection.** Primary control is the kind (`PrestaShop (default)` / `InPost` / `Allegro Delivery`). The processor **connection** auto-selects when the candidates list has exactly one (`omp_fulfilled`→partner, `source_brokered`→self, `ol_managed_carrier`→the lone InPost conn); a connection picker appears only when >1 candidate exists. This is honest to today's single-partner topology *and* future-proofs multi-OMP with no code change.
- Files: `api/mappings.{types,api,query-keys}.ts` (`RoutingRule`, `RoutingRuleInput`, `CandidateProcessor` types + `getRoutingRules`/`replaceRoutingRules`/`getRoutingCandidates` + `routingRules(connId)` keys); `hooks/use-routing-rules.ts` (`useRoutingRulesQuery` / `useRoutingCandidatesQuery` / `useReplaceRoutingRules`); `components/routing-rules-panel.tsx` (+ `.test.tsx`) — **kebab-case filename** (named export `RoutingRulesPanel`; neighbouring `MappingPanel.tsx` is pre-rule legacy).

**Placement — 4th tab, placed FIRST, labelled "Fulfillment", on `connection-mappings-page.tsx`.** Routing is the *parent* decision (who fulfils?) so it leads, before Carriers (which-PS-carrier, only for the PS-fulfilled subset). Tab order: **Fulfillment → Carriers → Statuses → Payments**. Reusing the page inherits source↔partner resolution, capability gating, the desktop-only-edit banner, breadcrumb + tab a11y. Gate the tab on `connection.supportedCapabilities.includes('OrderSource')`, NOT `platformType === 'allegro'` (literal platformType dispatch banned outside `plugins/<platformType>/`). *(The page's "Allegro → PrestaShop mappings" title should eventually generalize to "connection fulfillment configuration" — a relabel, deferred, NOT #836.)*

**Carrier-tab false-warn — fix in #836 (routing-scoped coverage).** Once a method is diverted, `deriveCarrierFallbackBanner` would wrongly count it as an "unmapped" PS carrier. The "needs a PS carrier" set is **defined by routing** — only methods resolving to `omp_fulfilled` need a PS carrier. Make the banner routing-aware: subtract diverted methods from `unmappedCount` (the page already loads per-connection data; add the routing-rules query). Leaving a known-false "sync will fail" warning behind the very feature that breaks it violates the trustworthy-diagnostics principle. *(Hoisting carrier-coverage to a backend derivation — the banner already duplicates the #516 chain client-side — is the longer-term direction, deferred.)*

## 4. Steps

| # | File | Acceptance |
|---|---|---|
| 1 | `libs/core/src/mappings/.../fulfillment-routing.service.interface.ts` + `.service.ts` (+ spec) — **extract `assertCompatible`'s per-kind predicate into a shared helper**, then add `getCandidateProcessors` using it (enumerate from capability **metadata**, no adapter instantiation) | Candidates + `replaceRules` validation share ONE predicate (no drift); returns **`{processorKind, processorConnectionId}[]`**; unit test asserts a candidate is never rejected by `replaceRules` and vice-versa. File headers. |
| 2 | `apps/api/src/mappings/http/dto/routing-rule-input.dto.ts`, `upsert-routing-rules.dto.ts`, `routing-rule-response.dto.ts`, `candidate-processor-response.dto.ts` (`{processorKind, processorConnectionId}` only) | class-validator on `processorKind` (∈ `FulfillmentProcessorKindValues`), `sourceDeliveryMethodId`, `processorConnectionId`; `fromDomain` mapper; file headers |
| 3 | `apps/api/src/mappings/http/fulfillment-routing.controller.ts` (+ spec) | GET/PUT/candidates under `connections/:connectionId/routing-rules` (`:connectionId` = **source** connection), `@Roles('admin')`; **full** exception map (Incompatible/Duplicate/ConnectionDisabled → 400, ConnectionNotFound → 404) |
| 4 | `apps/api/src/mappings/mappings.module.ts` (or wherever `MappingsController` is registered) | controller registered; boots |
| 5 | `apps/web/src/features/mappings/api/*` | routing + candidate types + api fns + query keys |
| 6 | `apps/web/src/features/mappings/hooks/use-routing-rules.ts` | query + candidates + mutation hooks; invalidate on success |
| 7 | `apps/web/src/features/mappings/components/routing-rules-panel.tsx` (+ `.test.tsx`) — **kebab-case** | **default-vs-divert**: all live methods listed, defaulting to "PrestaShop (default)"; **lead with kind**, connection auto-selects on singleton candidate, picker only when >1; only diverted rows submitted to the replace-all PUT; all 4 states; mobile/tablet |
| 8 | `apps/web/src/pages/connections/connection-mappings-page.tsx` | **"Fulfillment" tab added FIRST** (order: Fulfillment → Carriers → Statuses → Payments); gated by `supportedCapabilities.includes('OrderSource')` (not platformType) |
| 9 | `apps/api/test/integration/.../routing-rules.int-spec.ts` | GET/PUT round-trip + 400-on-incompatible vertical slice (mirrors #832 `fulfillment-routing.int-spec.ts`) |
| 10 | `apps/web/src/pages/connections/connection-mappings-page.tsx` (`deriveCarrierFallbackBanner`) | **routing-aware carrier-coverage**: subtract diverted methods from `unmappedCount` so the Carrier banner doesn't false-warn for methods routed away from PS. **Compute the banner only after BOTH carrier-mappings and routing-rules queries have loaded** (no false-warn flicker before routing rules resolve). Component test covers the diverted-method exclusion. |

## 5. Validate

- **Architecture:** API delegates to the core service via token; no business logic in the controller; FE uses `useApiClient` + feature hooks; no boundary violations. The (B) core addition keeps compatibility authoritative in core.
- **Naming:** `*.controller.ts` / `*-response.dto.ts` / `use-*.ts` / `*.types.ts` per standards.
- **Testing:** controller spec (happy + 400 mapping), service spec for `getCandidateProcessors`, FE component test (happy/loading/error/empty + incompatible filtered out).
- **Security:** `@Roles('admin')` + `@UseGuards` inherited; input validated via DTO; no secrets.
- **Migration:** none (table exists from #832).
- **Sequencing:** ship independently against `IFulfillmentRoutingService` (grill-me decision (a)); do **not** couple the #836 merge to #835. The config is inert until a consumer wires `resolve()`, but the UI degrades honestly (capability-derived options) so it never offers a meaningless action.
- **Predicate consistency:** candidates and `replaceRules` validation must call the **same** extracted predicate (step 1) — the safety property that makes capability-degradation correct.
- **Parallel-safety vs #835:** FE files are `apps/web/src/features/mappings/**` + the page (disjoint from #835's `libs/core/src/{shipping}` + `inpost`). The one shared backend file is `fulfillment-routing.service.ts` (additive `getCandidateProcessors` + predicate extraction) — coordinate the touch with the in-flight #835.

## 6. Risks / open questions

- **Declared-but-not-consumed window** — if #833 ships the Allegro Delivery adapter (declares `ShippingProviderManager`) before #837 wires its `resolve()` dispatch, the `source_brokered` divert appears but is inert. Accepted: same contract-as-seam decoupling as the overall sequencing; gate on capability, not consumer-liveness. Closed by the consumer issue.
- **#835 overlap** — `fulfillment-routing.service.ts` (additive method + predicate extraction). Low risk; coordinate.
- **Page-title generalization** (deferred) — "Allegro → PrestaShop mappings" → "connection fulfillment configuration" once non-PS processors are first-class. Relabel, not restructure; not #836.
- **Backend carrier-coverage derivation** (deferred) — `deriveCarrierFallbackBanner` duplicates the #516 chain client-side; long-term it should be a backend coverage read. #836's routing-aware subtraction (step 10) is a step toward it, not away.

> **Review applied (tech-review, 2026-05-25):** option B locked (A duplicates backend rules — FE anti-pattern); full exception mapping (`ConnectionNotFound`→404 / `ConnectionDisabled`→400); kebab-case component filename; capability-based gating; int-spec (step 9); candidates returns `connectionName`/`label`; file headers.

> **Tech-review #2 applied (2026-05-25, post-grill):** candidates contract trimmed to `{processorKind, processorConnectionId}` — dropped `connectionName`/`label` (FE resolves names via `ConnectionEntityLabel`, maps kind→label client-side; core takes no `Connection.name` dep); `getCandidateProcessors` enumerates from capability **metadata** (no adapter instantiation); carrier banner computed only after both queries load (no false-warn flicker); "Fulfillment"-first default-tab change is intentional.

> **Grill-me applied (2026-05-25):** ship independently against the contract (a); "default = rule-absence" (schema-forced, preserves `source:'default'`); lead-with-kind + singleton auto-select for the processor connection; explicit `omp_fulfilled` rules deferred to multi-OMP; `getCandidateProcessors` = read-side projection of the **shared** `assertCompatible` predicate (step 1); pure capability-degradation (no suppression — Allegro Delivery lights up via #833); 4th tab "Fulfillment" placed **first**; Carrier-banner made routing-aware (step 10). Full design tree resolved — ready to implement.
