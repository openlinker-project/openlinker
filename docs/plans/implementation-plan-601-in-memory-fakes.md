# Implementation Plan — #601 In-memory fakes for plugin authors

| Layer | Scope | Risk |
|---|---|---|
| DX (testing helpers across two existing workspaces) + docs | 4 fakes published from `@openlinker/core` and `@openlinker/shared` via `./testing` sub-barrels + plugin-author-guide section | Low — pure additive surface; production paths unchanged. |

## 1. Problem framing

Every adapter spec today hand-rolls its own mock of `IdentifierMappingPort`, `CredentialsResolverPort`, `CachePort`, `EventPublisherPort`. The repo has zero `testing/` or `fakes/` directories on the core/shared side; the only in-memory fake anywhere is `libs/integrations/ai/.../fake-ai-completion.adapter.ts` (PS-private fixtures aside). Per #601, this is high friction for OSS plugin authors and the hand-rolled fakes drift from production semantics.

The four targets the issue calls out:

| Port | Location | Why a fake helps |
|---|---|---|
| `IdentifierMappingPort` | `libs/core/src/identifier-mapping/` | Most-mocked port in the codebase (every adapter spec touches it). Replicating the `ol_{prefix}_{uuid}` ID format + conflict semantics by hand is error-prone. |
| `CredentialsResolverPort` | `libs/core/src/integrations/` | Plugin specs need a seedable resolver — current production adapter is env-backed; a Map-backed fake lets specs declare credentials inline. |
| `CachePort` | `libs/shared/src/cache/` | Honor TTL semantics correctly. Lets specs assert on key/value writes without spinning Redis. |
| `EventPublisherPort` | `libs/core/src/events/` | Record published events for assertion; returns synthetic monotonic IDs that look like real Redis Streams IDs. |

## 2. Architecture decisions

**Placement**: Each fake lives in `<port-context>/testing/` — co-located with the port it satisfies. Aligns with the issue's recommendation ("`libs/core/src/identifier-mapping/testing/in-memory-identifier-mapping.ts`") and with the existing `libs/integrations/ai/src/infrastructure/adapters/fake-ai-completion.adapter.ts` precedent (the only in-tree fake today).

**Naming**: align to engineering-standards § Adapters and the existing fake precedent (`libs/integrations/ai/.../fake-ai-completion.adapter.ts` → `FakeAiCompletionAdapter`). The issue body's `in-memory-identifier-mapping.ts` is loose phrasing, not a standards override.
- File: `in-memory-{capability}.adapter.ts`
- Class: `InMemory{Capability}Adapter`
- Spec: `__tests__/in-memory-{capability}.adapter.spec.ts`

**Sub-barrel exports**: New entries in each workspace's `package.json` `exports` field:

```jsonc
// libs/core/package.json — add three subpaths
"./identifier-mapping/testing": { ... → dist/identifier-mapping/testing/index.js ... }
"./integrations/testing":       { ... → dist/integrations/testing/index.js ... }
"./events/testing":             { ... → dist/events/testing/index.js ... }

// libs/shared/package.json — add one subpath
"./cache/testing":              { ... → dist/cache/testing/index.js ... }
```

Plus `tsconfig.base.json` `paths` entries for each so consumers can `import { InMemoryIdentifierMapping } from '@openlinker/core/identifier-mapping/testing';` and have TS resolve at typecheck time.

**Sub-barrel index files**: each `testing/index.ts` re-exports the fake class + its config/seed types. Mirrors the existing two-sub-barrel pattern (`@openlinker/core/listings/services`, `@openlinker/core/<ctx>/orm-entities`) — the runtime-constraint doc (`engineering-standards.md § Import Aliases`) explicitly allows new `./testing` sub-barrels under this same precedent.

**Peer-dependency hygiene**: The issue body's "Mark these as peerDependencies-free" is paraphrased; the fakes still flow through the host package's existing peer-deps (the imported port types pull `@nestjs/common` transitively). What's actually true: **no new peer-deps are added for the fakes specifically**, and the fakes need no runtime dependencies beyond Node built-ins (`crypto.randomUUID()` from `node:crypto`, Node ≥ 18). No additions to `package.json` `dependencies` or `peerDependencies` arrays.

## 3. Fakes

### 3.1 `InMemoryIdentifierMappingAdapter`

`libs/core/src/identifier-mapping/testing/in-memory-identifier-mapping.adapter.ts`

Implements `IdentifierMappingPort` (the combined Query + Command union). Key semantics to replicate from the production service:

- Internal-ID format: `ol_{prefix}_{uuid}` where `prefix` is `ENTITY_TYPE_ID_PREFIX[entityType]` if present else `entityType.toLowerCase()` (matches `identifier-mapping.service.ts:333-343`). UUIDs are `crypto.randomUUID()` with dashes stripped.
- `getOrCreateInternalId`: idempotent — same `(entityType, externalId, connectionId)` returns the same internal ID across calls.
- `getOrCreateExactMapping`: idempotent on match; throws `IdentifierMappingConflictException` when the external ID is mapped to a *different* internal ID.
- `createMapping`: throws `DuplicateIdentifierMappingError` (the domain exception) when a duplicate is inserted.
- `getExternalIds(entityType, internalId)`: returns all `ExternalIdMapping` entries with the given internal ID, across all connections.

**Constructor**: optional `connectionPlatformMap?: Record<string, string>` — lets specs supply `platformType` per connection. When absent, `platformType` defaults to `''` in returned `ExternalIdMapping`s (the field is denormalization for query convenience; plugin specs rarely assert on it).

**Helpers**:
- `clear(): void` — reset state between tests.
- `seed(input: { entityType: string; externalId: string; connectionId: string; internalId: string }): void` — pre-populate without going through `getOrCreateInternalId`.

Spec: round-trip happy path, idempotent re-call, conflict on `getOrCreateExactMapping`, ID-format check, `clear()` + `seed()` semantics. ~10 tests.

### 3.2 `InMemoryCredentialsResolverAdapter`

`libs/core/src/integrations/testing/in-memory-credentials-resolver.adapter.ts`

Implements `CredentialsResolverPort`. Backed by a `Map<string, unknown>`. Constructor accepts `Record<string, unknown>` for inline seeding.

**Helpers**:
- `clear(): void`
- `seed(ref: string, credentials: unknown): void`

Spec: get-by-ref happy path, throws on missing ref (matches the production contract `@throws Error if credentials cannot be resolved`), type-parameter narrowing (`get<MyShape>(ref)`). ~5 tests.

### 3.3 `InMemoryCacheAdapter`

`libs/shared/src/cache/testing/in-memory-cache.adapter.ts`

Implements `CachePort`. Backed by `Map<string, { value: unknown; expiresAt: number }>`. TTL honored by storing `Date.now() + ttlSec * 1000` and checking against `Date.now()` on each `get` — expired entries return `null` AND are deleted lazily (cleans up over time).

**Helpers**:
- `clear(): void`
- `size(): number` — for assertion (e.g., asserting an LRU-style eviction in higher-level code).
- `seed<T>(key: string, value: T, ttlSec: number): void` — pre-populate without going through `set`. Same TTL semantics as `set`.

No fake timer dependency — TTL works against the real clock; specs that need to test TTL expiry can use `jest.useFakeTimers()` themselves (documented in the plugin-author guide).

Spec: get/set/delete, miss returns null, TTL respected (with `jest.useFakeTimers()` in one test), `clear()` + `seed()` semantics. ~7 tests.

### 3.4 `InMemoryEventPublisherAdapter`

`libs/core/src/events/testing/in-memory-event-publisher.adapter.ts`

Implements `EventPublisherPort`. Stores published events in a `Map<streamName, EventEnvelope[]>`. Returns synthetic message IDs in the Redis Streams `<ms>-<seq>` shape — e.g. `'1715690400000-0'` — so consumers that assert on ID format don't break.

**Helpers**:
- `clear(): void`
- `getPublishedEvents(streamName: string): EventEnvelope[]` — events published to a single stream.
- `published(): Array<{ streamName: string; event: EventEnvelope; id: string }>` — flat list across all streams, in publish order.

Spec: publish + assert, multi-stream isolation, monotonic ID format, `clear()` semantics. ~5 tests.

## 4. Files

```
libs/core/src/identifier-mapping/testing/
├── in-memory-identifier-mapping.adapter.ts
├── index.ts                                                # re-export
└── __tests__/
    └── in-memory-identifier-mapping.adapter.spec.ts

libs/core/src/integrations/testing/
├── in-memory-credentials-resolver.adapter.ts
├── index.ts
└── __tests__/
    └── in-memory-credentials-resolver.adapter.spec.ts

libs/core/src/events/testing/
├── in-memory-event-publisher.adapter.ts
├── index.ts
└── __tests__/
    └── in-memory-event-publisher.adapter.spec.ts

libs/shared/src/cache/testing/
├── in-memory-cache.adapter.ts
├── index.ts
└── __tests__/
    └── in-memory-cache.adapter.spec.ts

# Subpath wiring
libs/core/package.json        — +3 exports entries
libs/shared/package.json      — +1 exports entry
tsconfig.base.json            — +4 paths entries

# Docs
docs/engineering-standards.md  — § Sub-barrels — add a third bullet documenting the `./testing` pattern
docs/plugin-author-guide.md    — § Step 10 — Tests — new sub-section for in-memory fakes
```

## 5. Architecture compliance check

- **Hexagonal layering**: each fake implements a *port interface* — that's the canonical adapter shape (engineering-standards § Adapters). Lives at `<context>/testing/` rather than `<context>/infrastructure/adapters/` because these are **test-time-only** adapters, never wired into production module graphs. Every fake's file header carries a one-line rationale on this placement choice so the next reader doesn't "fix" it back into `infrastructure/adapters/`. The split from the AI precedent (`fake-ai-completion.adapter.ts` lives in `infrastructure/adapters/` because it IS wired into production when `OL_AI_PROVIDER=fake`) is intentional.
- **Domain-layer purity**: the fakes don't live in `domain/`; they sit in their own `testing/` directories. No framework deps — pure TS + Node `crypto`.
- **Naming**: `InMemory{Capability}` class, `in-memory-{capability}.ts` file, `__tests__/*.spec.ts` for unit tests. ✓
- **File headers**: every new file gets the standard `@module` JSDoc header per § File Headers.
- **No `any`**: type-parameterize `CachePort.get<T>` correctly; use `unknown` for `CredentialsResolverPort` get-return until the caller specifies the type.
- **Logger**: fakes do NOT log — they're test infrastructure, callers don't need log noise. (Same rationale as test-kit's `console.warn`-only decision — keep dep graph tight.)
- **Imports**: each fake imports only from same-package sources (`../domain/ports/...port`, `../domain/types/...types`) via short relative paths (≤ `../..`). Each `testing/index.ts` does `export * from './in-memory-{capability}';`.

## 6. Step-by-step implementation

1. **Scaffold sub-barrels** — create the four `testing/` directories with placeholder `index.ts` and the fake class skeletons. Add file headers per the project standard.
2. **Implement `InMemoryIdentifierMapping`** (most complex — replicates ID format + conflict semantics). Write spec first to drive contract.
3. **Implement `InMemoryCredentialsResolver`** + spec.
4. **Implement `InMemoryCache`** + spec (TTL test uses `jest.useFakeTimers()`).
5. **Implement `InMemoryEventPublisher`** + spec.
6. **Wire `exports` field** in `libs/core/package.json` (+3) and `libs/shared/package.json` (+1). Add the four `tsconfig.base.json` `paths` entries.
7. **Update `docs/plugin-author-guide.md`** § Step 10 — Tests with a "Testing without containers — in-memory fakes" sub-section. Show one copy-pasteable spec example using `InMemoryIdentifierMapping`.
8. **Run quality gate**: `pnpm lint && pnpm type-check && pnpm test`. Verify the new sub-barrels typecheck across consumer surfaces (apps/api, libs/integrations/*).
9. **Commit + self-review + PR**. Body: `Closes #601`; note follow-up surface (the issue also mentions `CustomerIdentityResolverPort` as a candidate — deferred unless trivial, since it's plugin-only and not in the four-item list at the bottom of the issue).

## 7. Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

Optional sanity check after subpath wiring: `pnpm --filter @openlinker/core build && pnpm --filter @openlinker/shared build` to verify the `tsc -b` output produces the `dist/<context>/testing/index.{js,d.ts}` files that the `exports` field references.

## 8. Validation checklist

- [ ] Four fakes live under `<context>/testing/` with `__tests__/*.spec.ts` siblings.
- [ ] Each fake's spec exercises happy-path, idempotency where applicable, conflict/error semantics, and helper methods (`clear`, `seed`).
- [ ] `libs/core/package.json` carries 3 new `./*/testing` subpath exports; `libs/shared/package.json` carries 1.
- [ ] `tsconfig.base.json` `paths` has 4 new entries for the testing sub-barrels.
- [ ] `pnpm lint && pnpm type-check && pnpm test` green.
- [ ] `docs/plugin-author-guide.md` § Step 10 has a "Testing without containers" sub-section with a working code example.
- [ ] PR body carries `Closes #601` and explicitly notes which ports were in-scope (4) vs deferred.
