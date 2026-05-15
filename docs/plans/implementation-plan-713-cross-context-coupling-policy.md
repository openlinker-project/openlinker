# Implementation Plan — #713 Cross-context coupling policy in core

## 1. Understand the task

**Goal.** Make the cross-context coupling pattern that already exists in `libs/core/src/**` a documented, enforced architectural policy, not tribal knowledge. New contributors and AI assistants should be able to answer "is this cross-context import allowed?" without reading 60-line audit comments.

**Layer classification.** DX / Docs / CI. Two artefacts:
1. **Docs** — a new section in `docs/architecture-overview.md` that names the rule, the allow/deny set, the dependency map, and the rationale.
2. **Lint-time invariant** — a `scripts/check-cross-context-imports.mjs` chained into `pnpm check:invariants`, matching the existing pattern (`check-repo-urls.mjs`, `check-create-adapter.mjs`, etc.).

**Explicit non-goals.**
- Refactoring sibling cross-context coupling to events. The policy is a *clarification* of the existing dependency-inversion seam — not a re-architecture.
- Adding the policy to FE (`apps/web`). Out of scope; the issue is specifically about `libs/core/src/<ctx>`.
- Touching ESLint config beyond what's already there (the issue suggests either ESLint *or* an invariant script; I'm picking the script — it's cheaper, matches the existing pattern, and the error messages are richer).
- Building runtime telemetry on imports. Static analysis only.

## 2. Research findings

### 2a. Actual cross-context dependency map (audited 2026-05-15)

```
ai           → integrations
content      → ai, integrations, listings, products
customers    → identifier-mapping, integrations, orders
integrations → identifier-mapping
inventory    → identifier-mapping, integrations, listings, products, sync
listings     → identifier-mapping, integrations, mappings, products, sync
orders       → customers, identifier-mapping, integrations, mappings, products, sync
products     → identifier-mapping, integrations, listings
sync         → events, listings, orders
```

`identifier-mapping`, `integrations`, and `events` are the most-depended-upon contexts (each used by 5+ siblings) — they form the "infrastructure spine" of the core. `users`, `webhooks`, `mappings` have minimal outbound coupling.

### 2b. Symbols that legitimately cross context boundaries today

Confirmed in `grep -rE "from '@openlinker/core/[a-z-]+'" libs/core/src/`:

- **Service interfaces**: `IIdentifierMappingService`, `IIntegrationsService`, `IMappingConfigService`, `IPromptTemplateService`, `IInventorySyncService`, `IListingsService` (and more — anything named `I*Service`).
- **Symbol DI tokens**: `IDENTIFIER_MAPPING_SERVICE_TOKEN`, `CONNECTION_PORT_TOKEN`, `EVENT_PUBLISHER_TOKEN`, `INTEGRATIONS_SERVICE_TOKEN`, etc. — uniformly suffixed `_TOKEN`.
- **Domain entities used as read-only types**: `Connection`, `Product`, `ProductVariant`, `IdentifierMapping`, `Order`, etc. Always `import type` (or treated as DTO-like shapes).
- **Capability types and type-guards**: `OfferManagerPort`, `OrderSourcePort`, `ProductMasterPort` (the capability *contracts*, not adapter classes), plus their co-located `isOfferCreator` / `isCategoryBarcodeMatcher` / `isSellerPoliciesReader` predicates.
- **`as const` value types and enums**: `CoreEntityType`, `JobOutcome`, `JobType`, `PromptTemplateChannel`, `OFFER_CREATION_STATUS`, `CORE_ENTITY_TYPE`.
- **Domain exceptions**: `ConnectionNotFoundException`, `ConnectionDisabledException`, `DuplicateIdentifierMappingError`, `CredentialNotFoundException`, etc.
- **NestJS module classes** (cross-module wiring at the module-graph level, not inside services): `CustomersModule`, `EventsModule`, etc.

### 2c. Current violations to be flagged

Three production-code files import a **repository port** from a sibling context — exactly the pattern the proposed policy disallows:

| File | Cross-context port imported | Should go through |
|---|---|---|
| `inventory/application/services/inventory-query.service.ts` | `ProductRepositoryPort` from `products` | `IProductsService` |
| `orders/application/services/order-item-ref-resolver.service.ts` | `ProductVariantRepositoryPort` from `products` | `IProductsService` (a `findVariantById` method) |
| `content/application/services/content-state-reader.service.ts` | `OfferMappingRepositoryPort` from `listings` | `IListingsService` (or a narrower `IOfferMappingQueryService`) |

Multiple test files (`*.spec.ts`) also import these cross-context repository ports — they're constructing mock instances of the same ports the production code imports. They'll be caught by the same rule once the policy lands; fix follows the production fix.

### 2d. Existing invariant-script pattern

Scripts in `scripts/check-*.mjs` follow a uniform shape:
- Pure-Node, no external deps.
- Use `fs/promises` `readdir` (recursive) to walk the tree.
- SKIP_DIRS deny-list (`node_modules`, `dist`, `coverage`, `.git`, etc.).
- File-extension allow-list (`.ts`, sometimes `.tsx`).
- Print clear "✗ Violation:" lines with file path and column when a match hits.
- Exit code 1 on any violation, 0 otherwise.
- Chained into `pnpm check:invariants` via `&&` in package.json.

`scripts/check-repo-urls.mjs` (added in PR #690) is the closest precedent: pattern-grep for banned substrings, deny-list skip dirs, sub-200-line implementation.

## 3. Design

### 3a. The policy text

To live in `docs/architecture-overview.md` as a new top-level **`## Cross-context dependencies in core`** section, placed right after `### Repository Ports Pattern` (line ~1077) and before `## Module Organization` — that's the natural sequence (intra-context layering → intra-context repository contract → cross-context contract → module composition).

Content outline:

1. **The rule.** Cross-context calls in `libs/core/src/<ctx>` go through the **service interface + Symbol token + top-level barrel** of the target context. No other shape is allowed.
2. **Allowed cross-context exposures** (table):
   - `I{Service}Service` interfaces
   - `*_TOKEN` Symbols (DI tokens)
   - Domain entities, value objects, exceptions
   - `as const` value types / enums
   - Capability port *interfaces* and `is{Capability}` guards (these are part of the published port contract, not adapter internals)
   - NestJS Module classes (for module-graph composition only — `@Module imports: [...]`, not for service injection)
3. **Forbidden cross-context exposures** (table):
   - Repository ports (`*RepositoryPort`)
   - ORM entities (`*OrmEntity`)
   - Infrastructure adapter classes (`*Adapter`)
   - Application DTOs (`*Dto`)
   - Internal types from `domain/types/` not re-exported by the barrel (caught at runtime by package `exports` anyway, but stated explicitly)
4. **Dependency map** (from 2a above).
5. **Rationale.** Three bullets:
   - **Dependency inversion via the service-interface seam** keeps each context independently testable — swap any sibling's `IXService` impl with a stub.
   - **Logical dependencies should be explicit, not hidden in events.** Calling `IProductsService.getVariant(id)` is clearer than emitting a request event and awaiting a response.
   - **Refactor safety.** When a sibling context restructures its internals (entities split, adapters rename), the contract — interface, entity types, exceptions, Symbol tokens — is the only surface that has to stay stable.
6. **Pointer** to the lint-time invariant script.

### 3b. The invariant script

`scripts/check-cross-context-imports.mjs`. Walks `libs/core/src/<ctx>/**/*.ts`; for every cross-context import (`from '@openlinker/core/<other-ctx>'`), inspects the imported symbol names.

**Allow rules** (any of these makes the import legal):
- Named import matches `/^I[A-Z][A-Za-z]*Service$/` (e.g., `IIntegrationsService`).
- Named import matches `/^[A-Z_]+_TOKEN$/` (e.g., `IDENTIFIER_MAPPING_SERVICE_TOKEN`).
- Named import matches `/^is[A-Z][A-Za-z]+$/` (capability type-guard).
- Named import matches `/Module$/` for module-graph composition (e.g., `CustomersModule`).
- Named import ends `Exception` or `Error` (domain exceptions).
- Named import ends `Port` AND the import is `import type` only AND the port name does **not** end `RepositoryPort` (capability ports like `OfferManagerPort` are fine; repository ports are blocked).
- Anything in a curated `ALLOWED_VALUE_TYPES` list (capability constants: `CORE_ENTITY_TYPE`, `OFFER_CREATION_STATUS`, etc. — small, growable when something new gets surfaced).
- Bare `import type {Entity, ValueObject, …}` is allowed by default — domain entities/value objects are part of the published surface. Specifically, anything `import type` that doesn't match a deny pattern.

**Deny rules** (any of these is a violation):
- Named import ends `RepositoryPort`.
- Named import ends `OrmEntity`.
- Named import ends `Adapter`.
- Named import ends `Dto`.
- Default import (`import X from '@openlinker/core/...'`) — barrels don't have defaults; if it parses, it's a misuse.
- Wildcard import (`import * as foo from '@openlinker/core/...'`) — exception: explicitly allowed in `**/__tests__/barrel-purity.spec.ts` files via a file-path allow-list (barrel-purity tests legitimately introspect the entire namespace).

**Output shape.** On violation:
```
✗ Cross-context coupling violation: libs/core/src/orders/application/services/order-item-ref-resolver.service.ts:11
    import: { ProductVariantRepositoryPort } from '@openlinker/core/products'
    rule: repository ports must not cross context boundaries
    fix: go through IProductsService instead
    docs: docs/architecture-overview.md#cross-context-dependencies-in-core
```

Exit 1 on any hit; exit 0 with `✓ N cross-context imports checked across M files. All conform.` otherwise.

**Edge cases.**
- Multi-line imports: parse-friendly — script reads each `.ts` file and pulls every `import ... from '@openlinker/core/<x>'` statement via regex with `s`-flag.
- Same-context imports (e.g., `libs/core/src/listings/x.ts` importing `@openlinker/core/listings`): skip — the rule only applies *across* contexts.
- `import` *types* — both `import type {…}` and `import {type Foo}` modifiers parsed.

### 3c. Handling the three existing violations

The proposed policy turns them red the moment the invariant script lands. Two options per the issue:
- **Fix in this PR** — adds 3 service-interface methods (`findVariantById`, `getProductById`, `findOfferMappingsForVariant`) and rewires the call sites. Net diff probably ~150 lines.
- **Fix in a follow-up** — land the docs + invariant with the three production violations explicitly allow-listed by file path, plus a follow-up issue tracking the rewire.

**My recommendation:** fix in a follow-up. Reasoning:
- The three violations each need careful service-interface design (what's the right method shape?) and ripple into test setup.
- Mixing "policy + invariant script + 3 service-interface refactors" in one PR fattens it past the issue's own effort estimate ("small for docs, medium with lint enforcement").
- Allow-listing is honest — the file path + the rule it violates is visible; future readers can see exactly what's outstanding.

I'll file a follow-up issue and reference it in both the docs section and the script's allow-list comment.

## 4. Step-by-step plan

1. **`docs/architecture-overview.md`** — add `## Cross-context dependencies in core` section between `### Repository Ports Pattern` and `## Module Organization` (≈100 lines: rule + 2 tables + dependency map + rationale + link to invariant script). Update Table of Contents.
2. **`scripts/check-cross-context-imports.mjs`** — implement per 3b. Pure-Node, follows `check-repo-urls.mjs` pattern. ~200 LOC.
3. **`package.json`** — append `&& node scripts/check-cross-context-imports.mjs` to the `check:invariants` script.
4. **File the follow-up issue** for the three production-code violations. Reference the issue number in both `architecture-overview.md` and the script's allow-list comment.
5. **Run the quality gate** — `pnpm lint && pnpm type-check && pnpm test`. The new invariant must pass after the allow-list captures the three known violations.

## 5. Validation

- **Architecture compliance**: docs-only + lint-time script. No runtime code touched. No new ports, services, or modules.
- **Naming**: script follows existing `check-*.mjs` convention. New doc section title is plain English.
- **Testing**: invariant script is its own test — running it on the audited tree must produce 3 known violations (the allow-listed ones) and 0 unexpected ones. No unit tests needed for a one-shot CI script; precedent: `check-repo-urls.mjs` doesn't have its own tests either.
- **Security**: none of the changes touch auth, secrets, or input handling.
- **Quality gate**: must pass after the changes land.

## Open questions

- **Capability ports vs. repository ports** — both end in `Port`. The deny rule keys on `RepositoryPort` suffix; capability ports like `OfferManagerPort` stay allowed. Is the suffix convention firm enough? Audit says yes — all repository ports today end in `RepositoryPort`, all capability ports in single `Port`. New repository ports added later that diverge from the convention will fail invisibly. **Mitigation:** the script comment will spell out the convention so anyone adding a `*RepositoryPort` in the future understands the rule.
- **Capability constants** — `CORE_ENTITY_TYPE`, `OFFER_CREATION_STATUS` etc. are pattern-matched as `[A-Z_]+`. That overlaps the `*_TOKEN` rule but doesn't conflict. The script's matcher orders the rules so `_TOKEN` matches first, then the bare ALL_CAPS allow.

## Risks

- **False positives.** The pattern-matching script may reject a legitimate cross-context import I haven't yet seen. The follow-up: any contributor can add to the allow-list with a one-line rationale in the script's comments.
- **Follow-up debt.** Filing the three violations as a separate issue means they may linger if not prioritised. **Mitigation:** the script's allow-list lists them by name; every time someone touches it the violations are right there.
