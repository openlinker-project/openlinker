# Implementation Plan — Service-interface coverage to 100% + lint enforcement (#712)

> Status: DRAFT (awaiting scope sign-off). Branch: `712-service-interface-coverage`.

## 1. Understand the task

**Goal.** Close the gap on the documented mandatory rule — *"Services must always implement an interface"* (`docs/engineering-standards.md § Service Interface Implementation`, echoed in `.claude/rules/backend.md`) — for every application service in `libs/core`, and add a lint invariant so it can never regress.

**Layer.** Backend / DX (no new runtime feature; tech-debt + tooling). Touches CORE application layer wiring + a repo-level invariant script.

**Explicit non-goals.**
- No behavior change to any service. Pure structural + DI-wiring change.
- Not relocating the 24 interface files that live in `application/interfaces/` vs the 22 in `application/services/` — both conventions stay valid (standardizing on one location is a separate refactor, out of scope).
- No full static enforcement of *token-binding* across all 50 services (criterion 3 of the issue) — see "Deferred" below. We fix the one unbound service and enforce the *interface* invariant.
- Out of scope: services outside `libs/core` (apps, integrations) — the issue scopes this to `libs/core/src/**/application/services/*.service.ts`.

## 2. Research — current state (audited 2026-05-26 against `origin/main` @ a6256ff)

The issue's premise ("~34 interface files for ~38 services, 89%") is **stale** — coverage has improved through intervening merges. Current reality:

- **50** application services under `libs/core/src/**/application/services/*.service.ts`.
- **46** `*.service.interface.ts` files (24 in `application/interfaces/`, 22 colocated in `application/services/`).
- **46/50** services declare an `implements I…Service` (or a `*Port`) clause.

**Exactly 4 services lack a same-named `I*Service` interface file:**

| Service | Implements today | Bound in module | Verdict |
|---|---|---|---|
| `IntegrationsContentPublisher` (content) | `ContentPublisherPort` | `useExisting` under port token | **Compliant in spirit** — port-adapter |
| `RedisSyncLockService` (sync) | `SyncLockPort` | `useExisting` under port token | **Compliant in spirit** — port-adapter |
| `SyncJobQueueService` (sync) | `SyncJobQueuePort` | `useExisting` under port token | **Compliant in spirit** — port-adapter |
| `OrderItemRefResolverService` (orders) | **nothing** | bare provider (concrete-class inject) | **TRUE GAP** |

So 3 of the 4 already satisfy the rule's *intent*: they implement a capability **Port** (an interface) and are injected via a Symbol token. Forcing a redundant parallel `I{Name}Service` onto a port-adapter would make the class implement two overlapping interfaces — architecturally worse, not better.

The genuinely non-compliant service is **`OrderItemRefResolverService`**:
- No interface file, no `implements` clause.
- Injected as a **concrete class** into `order-ingestion.service.ts` (constructor L66, used L212) — violating "code against interfaces, inject via token."
- Sole consumer: `order-ingestion.service.ts`. Registered as a bare provider in `orders.module.ts` (L49).
- Public surface: `tryResolve(connectionId, productRef): Promise<ItemResolutionResult>` and `resolve(connectionId, productRef): Promise<ResolvedOrderItemProduct>` (types re-exported from `./order-item-ref-resolver.types`).

**#665 (OfferLinkingService drift, referenced by #712) is already resolved** — `offer-linking.service.ts` has its interface in `listings/application/interfaces/` and declares `implements`. No action needed.

**Invariant-script wiring.** `pnpm lint` → `pnpm -r lint && pnpm check:invariants`; `check:invariants` chains plain Node ESM `scripts/check-*.mjs`. New check slots into that chain.

## 3. Design

**Decision (recommended — "Option B / intent-honoring"):** treat *implementing a capability `*Port`* as satisfying the service-interface rule for port-adapters, and fix only the one true gap. Then enforce the rule with a lint invariant whose acceptance condition matches the architecture.

### 3a. Fix `OrderItemRefResolverService` (orders context)
- New interface `IOrderItemRefResolverService` in `orders/application/interfaces/order-item-ref-resolver.service.interface.ts` (matches the orders-context convention — `order-record`, `order-sync`, etc. all live in `application/interfaces/`). Re-uses the existing `ItemResolutionResult` / `ResolvedOrderItemProduct` types.
- `OrderItemRefResolverService implements IOrderItemRefResolverService`.
- New token `ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN = Symbol('IOrderItemRefResolverService')` in `orders/orders.tokens.ts`.
- `orders.module.ts`: keep concrete provider, add `{ provide: ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN, useExisting: OrderItemRefResolverService }` (mirrors the other order services).
- `order-ingestion.service.ts`: inject `@Inject(ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN) private readonly orderItemRefResolver: IOrderItemRefResolverService` instead of the concrete class.
- Token reaches consumers via the orders barrel (`export * from './orders.tokens'` already in place).

### 3b. Lint invariant `scripts/check-service-interfaces.mjs`
For every `libs/core/src/**/application/services/*.service.ts` (excluding `*.spec.ts`, `*.service.interface.ts`):
- It MUST declare an `implements <X>` clause where `<X>` is **either**
  - an `I*Service` interface that has a sibling `*.service.interface.ts` file in the same context (in `application/interfaces/` **or** `application/services/`), **or**
  - a `*Port` capability port.
- Fails with a `file:line` + the rule that fired (style consistent with `check-cross-context-imports.mjs`).
- Wired into the `check:invariants` chain in root `package.json`.

### 3c. Docs
`docs/engineering-standards.md § Service Interface Implementation`:
- Reference `scripts/check-service-interfaces.mjs` as the enforcement.
- Clarify (a) implementing a capability **Port** satisfies the rule for port-adapters, and (b) interface files may live in `application/interfaces/` or colocated in `application/services/`.

## 4. Step-by-step

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `orders/application/interfaces/order-item-ref-resolver.service.interface.ts` | New `IOrderItemRefResolverService` (2 methods, JSDoc header) | type-check passes; methods match impl |
| 2 | `orders/application/services/order-item-ref-resolver.service.ts` | `implements IOrderItemRefResolverService` + import | declares implements |
| 3 | `orders/orders.tokens.ts` | Add `ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN` | Symbol-only export |
| 4 | `orders/orders.module.ts` | Add `useExisting` token binding | DI resolves; worker+api boot |
| 5 | `orders/application/services/order-ingestion.service.ts` | Inject via token + interface type | no concrete-class injection |
| 6 | `scripts/check-service-interfaces.mjs` | New invariant script | fails on a planted violation, passes clean |
| 7 | root `package.json` | Add script to `check:invariants` chain | `pnpm lint` runs it |
| 8 | `docs/engineering-standards.md` | Reference script + clarify Port/location nuance | doc matches reality |
| 9 | `order-item-ref-resolver.service.spec.ts` (if present) / `order-ingestion` spec | Update DI provider wiring to token | `pnpm test` green |

## 5. Validate (quality gate)
- `pnpm lint` (incl. the new invariant) — zero errors.
- `pnpm type-check` — zero errors.
- `pnpm test` — all unit tests pass; update any spec that constructs `OrderIngestionService`/resolver via concrete class to use the token.
- Sanity: the new invariant flags a deliberately-broken service, then passes on the clean tree.
- No ORM/schema change → no migration.

## Deferred (explicitly out of scope, note in PR)
- Static enforcement of token-binding for *all* services (issue criterion 3) — requires parsing module provider graphs; only `OrderItemRefResolverService` was unbound and is fixed here.
- Standardizing interface-file location to a single directory across all contexts.
