# Implementation Plan — #1066: Erli honor frozen `stock` on the quantity-sync hot path

**Date**: 2026-06-15 · **Status**: Planned · **Effort**: S–M · **Branch**: `1066-erli-frozen-stock` (off the #989 tip) · **ADR**: ADR-025 §4b. Plugin-only change — **no CORE change, no schema migration, no factory-signature churn**.

## Goal

Stop OL overwriting a seller-frozen Erli `stock` on every inventory tick, **without** adding a per-tick GET to the hot `updateOfferQuantity` path. Today (`#988`/#1061): frozen-field exclusion (`dropFrozenFields`) only runs on `updateOfferFields`, which GETs the live product first; `updateOfferQuantity` deliberately blind-PATCHes `stock` for per-tick performance, so a frozen stock is clobbered.

The reconciliation task `erli-offer-status-sync` (#989) **already GETs each mapped offer** (`getOfferStatus` → `fetchErliProduct`) and already sees `frozenFields`. We piggyback on that GET: when reconciliation observes a frozen `stock`, cache a per-offer flag; `updateOfferQuantity` reads that cached flag and skips the stock PATCH when set. Zero added GET on the hot path.

## Decisions (code-verified)

### D1 — Persistence: plugin-local `CachePort`, NOT a new table. **No TypeORM migration.**

The frozen-stock flag is persisted via the **host-provided `CachePort`** (`HostServices.cache`, `@openlinker/shared` → Redis-backed in apps), keyed per `(connectionId, externalOfferId)`. Rationale, evaluated against the alternatives:

| Option | Verdict | Why |
|---|---|---|
| **`CachePort` (chosen)** | ✅ | Already on `HostServices`; already wired into Erli's module via `createNestAdapterModule` (the same DI path Allegro uses — `host.cache`). Plugin-owned, no core surface change, no migration. The flag is *derived, refreshable state* (re-asserted every reconciliation tick), not a system of record — exactly the cache's contract (hard TTL, tolerate miss). |
| Reuse `offer_status_snapshots` (add a `stockFrozen` column) | ❌ | (1) Requires a **core schema migration** on a `libs/core` ORM entity + widening `OfferStatusSnapshotRepositoryPort` / `UpsertOfferStatusSnapshotCommand` / the neutral `OfferStatusReadResult` — a cross-cutting core change to serve one plugin's quirk. (2) The snapshot is written by the **core** `OfferStatusSyncService`, which only ever sees the neutral `OfferStatusReadResult` (`publicationStatus` + `validationErrors`) — it has no channel to carry an Erli-specific `frozenFields` signal without polluting the neutral contract. (3) `updateOfferQuantity` lives in the **plugin** and must not reach into a core repository port (cross-context `*RepositoryPort` import is ESLint-forbidden from `libs/integrations/**`). Decisively rejected. |
| New Erli-owned ORM entity + repository | ❌ | Erli is wired via `createNestAdapterModule` precisely *because it has no plugin-specific NestJS providers* (`erli-integration.module.ts` docblock). A TypeORM entity would force flipping Erli to a custom `@Module` with `TypeOrmModule.forFeature`, a migration, and a repository — heavyweight for a refreshable boolean. YAGNI. |
| In-process memory map | ❌ | Lost on restart and not shared across api/worker processes; the writer (reconciliation, runs in worker) and reader (`updateOfferQuantity`, runs wherever inventory sync runs) are different processes. Must be distributed. |

**Cache miss = fail OPEN (push stock).** This preserves today's behaviour exactly when the flag is unknown (first run, TTL expiry, cache down, `host.cache` undefined in unit-test hosts). The only behaviour change is the *positive* case: flag present and `true` ⇒ skip. A frozen stock is at worst overwritten once between reconciliation ticks — the same eventual-consistency posture ADR-025 §1 already takes for stock drift, and reconciliation re-asserts the flag on its next pass.

**Key identity (the linchpin — see Risks).** The write path (`getOfferStatus` / `updateOfferFields`) and the read path (`updateOfferQuantity`) MUST produce the **same** cache key for the same offer, or the feature silently no-ops (every read misses → fail-open → AC unmet, zero test signal). Today both sides key on the OL `ol_variant_*` id — the write side via `mapping.externalId` (the value `OfferStatusSyncService` passes to `getOfferStatus`), the read side via `cmd.offerId` — and they coincide. But that's an emergent property of two independent call paths, not an invariant the adapter enforces. To make it enforced rather than asserted:

- The key string is built by a **single private method** `frozenStockCacheKey(externalOfferId)` used by **both** writer and reader, so they cannot drift.
- That builder MUST interpolate **`this.connectionId`** (the constructor-injected trusted field — never a value off `cmd`) and take only `externalOfferId` as a parameter, so two connections sharing a variant id read/write disjoint flags (cross-connection isolation; covered by the #992 cache-key note in Risks).
- A test exercises the write→read round-trip on one key (write via `getOfferStatus(VALID_ID)` with frozen stock, read via `updateOfferQuantity({ offerId: VALID_ID })` against the **same** mocked cache, assert PATCH skipped).

**Key + TTL:**
- Key: `erli:frozen-stock:{connectionId}:{externalOfferId}` (mirrors the colon-namespaced convention; `externalOfferId` is the validated `ol_variant_*` seller key — see "id hygiene in the key builder" below).
- TTL: a small multiple of the **actual** reconciliation cadence so a stale flag self-heals if reconciliation stops. The cron defaults hourly (`ERLI_OFFER_STATUS_SYNC_CRON = '0 0 * * * *'`). The TTL is sized for the **worst case** — an operator who loosens the cron to a daily scan — so it must exceed 24 h: propose **TTL = 26 h**. Note the eventual-consistency window is bounded by the *cron cadence* (re-asserted every tick while reconciliation runs), not by the TTL; the TTL only matters once reconciliation stops. Colocate the TTL constant adjacent to the cron constant's documented cadence with a comment linking the two, so a future cron change re-prompts the TTL.
- Value stored: `boolean` (`true` = stock frozen). **Write-on-frozen-only:** on a reconciliation pass that sees stock **frozen**, `set(key, true, TTL)`; on a pass that sees stock **not** frozen, `delete(key)` (transition frozen→not-frozen). Rationale: "known not-frozen" and "unknown" both read as fail-open (push), so storing `false` buys nothing operationally while adding a Redis write on every tick for every not-frozen offer (the overwhelming majority — write amplification). `delete` is idempotent and cheap when the key is already absent. This also avoids the bodyless-GET clobber (see D3 / step 3).

### D2 — The frozen-stock signal is read where the GET already happens (`getOfferStatus`).

`fetchErliProduct` already returns `ErliProductResource.frozenFields`. `getOfferStatus` is the **only** steady-state path that GETs every mapped offer. So the cache **write** happens inside `getOfferStatus` (or a small helper it calls) — no new GET, no new scheduler task, no core change. `updateOfferFields` also GETs and could opportunistically refresh the flag too (cheap, same `current.frozenFields` already in hand) — include it as a secondary writer (it only fires on content edits, but keeps the flag fresher). The reconciliation task is the *primary* writer because it sweeps all offers on a cadence.

### D3 — `stock` re-enters `PATCH_KEY_TO_ERLI_FROZEN_NAME`? **No.**

That map drives `dropFrozenFields` on the *field-update* path, which reads live `frozenFields` per call. The quantity path doesn't read live frozen state — it reads the *cache*. Keep `stock` out of that map (the #1061 comment is correct for `updateOfferFields`); the quantity-path check is a separate cache lookup. Add the frozen-stock Erli wire-name as its own provisional constant (`ERLI_FROZEN_STOCK_FIELD = 'stock'`) used by the cache-write detection and documented as #992-provisional.

**Colocation + single #992 change point.** Place `ERLI_FROZEN_STOCK_FIELD` immediately adjacent to `PATCH_KEY_TO_ERLI_FROZEN_NAME` (the existing block already carries a thorough comment explaining `stock`'s deliberate absence and the #1066 deferral, adapter lines ~103–113). Update that comment from "#1066 deferred / dead code" to "#1066: honored via the cache flag, see `ERLI_FROZEN_STOCK_FIELD`", so the single #992 reconciliation point stays visibly singular and the two constants encoding the same provisional wire vocabulary sit together. Both constants stay **module-local** in `erli-offer-manager.adapter.ts` (matching the existing `ERLI_PRODUCT_ID_PATTERN` / `PATCH_KEY_TO_ERLI_FROZEN_NAME` precedent in that same file — this is deliberate precedent-following under the project's colocate-constants allowance, **not** a `*.types.ts` omission; no new constants module).

## Implementation

All changes in `libs/integrations/erli/`.

### 1. Thread `CachePort` to the adapter (factory + plugin)

- **Import**: `import type { CachePort } from '@openlinker/shared';` (top-level barrel — `libs/shared/src/index.ts` does `export * from './cache'`; matches Allegro's `allegro-adapter.factory.ts`). Use `import type` so the import is erasable and adds no runtime coupling (consistent with the adapter's existing type-only imports). Do **not** use the `@openlinker/shared/cache` subpath, and do **not** copy the local `@openlinker/shared/logging` subpath pattern for this type.
- `erli-plugin.ts` `createCapabilityAdapter`: pass `host.cache` into `factory.createAdapters(...)`. The factory signature already carries `identifierMapping` it doesn't use "so #985/#986/#988 extend behaviour without churning this signature" — add `cache?: CachePort` as a trailing optional arg to `createAdapters`. (Threading note: Allegro threads `host.cache` via the `AllegroAdapterFactory` **constructor** and keeps `createAdapters` at 3 args; Erli's factory is constructed argument-less inside `createCapabilityAdapter` (`new ErliAdapterFactory()`), so we pass `host.cache` into `createAdapters` instead — an Erli-local choice, **not** a 1:1 copy of Allegro. Both stay plugin-local with no boundary impact; the cache still arrives from `host.cache` either way.)
- `erli-adapter.factory.ts`: accept `cache?: CachePort` as a trailing optional arg on `createAdapters`, pass to `new ErliOfferManagerAdapter(connection.id, ERLI_ADAPTER_KEY, httpClient, cache)`.
- `ErliOfferManagerAdapter` constructor: add `private readonly cache?: CachePort`. Tolerate `undefined` (unit-test hosts, `CacheModule`-less bootstraps) — fail-open everywhere it's consulted.
- **No factory-return-type change**: `ErliAdapters.offerManager` stays typed `OfferManagerPort & OfferCreator & OfferFieldUpdater`. The concrete class also implements `OfferStatusReader` and the cache-write happens inside `getOfferStatus`, but that method is reached via core `OfferStatusReader` capability dispatch (`OfferStatusSyncService`), not through the `ErliAdapters` bag — so the union union stays unchanged and no Symbol token / Nest provider is introduced (the adapter is a plain factory-constructed class).

### 2. Frozen-stock cache helpers (private adapter methods + module constants)

- `ERLI_FROZEN_STOCK_FIELD = 'stock'` — provisional Erli wire-name (#992), the value looked for in `frozenFields`. Module-local, colocated with `PATCH_KEY_TO_ERLI_FROZEN_NAME` (see D3).
- `ERLI_FROZEN_STOCK_CACHE_TTL_SEC` (26 h, module-local, colocated with the cron-cadence note) and a `private frozenStockCacheKey(externalOfferId): string | null` builder returning `erli:frozen-stock:{connectionId}:{encodeURIComponent(externalOfferId)}`. **Id hygiene (fail-open, mirrors `productPath`):** validate `externalOfferId` against the same `ERLI_PRODUCT_ID_PATTERN` and **return `null`** on a non-match (don't build a key from an unvalidated string); also `encodeURIComponent` the id as the backstop so a stray `:` can't cause namespace-separator confusion across connections. This keeps the read path's fail-open posture while ensuring the cache key derives from the **same** validated id the wire path uses — so the #992 seller-key change can't silently widen the cache surface. The builder uses `this.connectionId` (trusted, constructor-injected), never a value off `cmd`.
- `private async writeFrozenStockFlag(externalOfferId, frozenFields: string[] | undefined): Promise<void>` — guard `if (!this.cache) return;`; compute `key = frozenStockCacheKey(externalOfferId)` and bail if `null`. **Only act when `frozenFields` is a defined array** (the GET actually carried frozen info); treat `undefined` (bodyless 2xx) as "no info — leave the cache untouched" (no `set`, no `delete`). When defined: if `(frozenFields).includes(ERLI_FROZEN_STOCK_FIELD)` → `set(key, true, TTL)`; else → `delete(key)` (write-on-frozen-only / delete-on-unfreeze, per D1). Swallow cache errors with a `logger.debug` (a cache write must never break reconciliation).
- `private async isStockFrozenCached(externalOfferId): Promise<boolean>` — compute `key = frozenStockCacheKey(externalOfferId)`; return `false` (fail-open) if `null` (invalid/hostile id), if `!this.cache`, or on `undefined`/`null`/miss/cache-error from `this.cache.get<boolean>(key)`.

### 3. Write the flag where the GET already happens

- In `getOfferStatus`, after `fetchErliProduct` succeeds, call `await this.writeFrozenStockFlag(externalOfferId, product.frozenFields)` **before** mapping/returning. Place it so a 404 (→ `OfferNotFoundOnMarketplaceException`) does NOT write (offer not on Erli). A 204 / bodyless 2xx leaves `product.frozenFields` `undefined` — the helper's defined-array guard (step 2) means this writes **nothing** (it does not clobber a previously-cached `true` with a stale `false`/`delete`), which is the correct "GET carried no frozen info" semantics.
- In `updateOfferFields`, after `current` is resolved, opportunistically `await this.writeFrozenStockFlag(cmd.externalOfferId, current.frozenFields)` (secondary writer; cheap, frozenFields already in hand). On the 404 fail-open branch `current` is `{}` so `frozenFields` is `undefined` — the helper no-ops, no special-casing needed.

### 4. Read the flag on the hot path (`updateOfferQuantity`)

```
async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
  // #1066 / ADR-025 §4b: honor a seller-frozen stock WITHOUT a per-tick GET.
  // The flag is cached during erli-offer-status-sync reconciliation (which
  // already GETs each offer); cache miss fails OPEN (push), preserving the
  // pre-#1066 behaviour when the flag is unknown.
  if (await this.isStockFrozenCached(cmd.offerId)) {
    this.logger.debug(`Skipping stock push for frozen Erli offer [connectionId=${this.connectionId}]`);
    return;
  }
  const body: ErliProductPatchBody = { stock: cmd.quantity };
  await this.httpClient.patch(this.productPath(cmd.offerId), body);
}
```
Note: `cmd.offerId` reaches `isStockFrozenCached` **before** `productPath` validates it on the push branch. The cache-key builder (step 2) applies the **same** `ERLI_PRODUCT_ID_PATTERN` validate-or-`null` + `encodeURIComponent` hygiene as `productPath`, so a hostile/malformed id never reaches the Redis keyspace: it yields a `null` key → `isStockFrozenCached` returns `false` (fail-open) → push branch runs → `productPath` throws as today. Behaviour unchanged for hostile ids, and no unvalidated string is interpolated into a cache key.

### 5. Docblock + comment updates

- **Adapter file-header docblock** (the load-bearing stale claim, `erli-offer-manager.adapter.ts` lines ~26–33, the "Frozen-field ownership (#988, ADR-025 §4b)" paragraph): this is the block whose "The hot `updateOfferQuantity` inventory path deliberately does NOT pre-fetch … stock drift is guarded by reconciliation (#989), not a per-PATCH GET" sentence now contradicts the new behaviour and **must** be revised — frozen-`stock` is honored on the quantity path via the reconciliation-cached flag (#1066), without a per-tick GET. (Not just the class-level wording — the file header carries the stale claim.)
- `updateOfferQuantity` inline comment: replace the "#1066 deferred" note with the cached-flag explanation (cache miss = fail-open = pre-#1066 behaviour).
- `PATCH_KEY_TO_ERLI_FROZEN_NAME` comment: keep `stock` out, but update the trailing note — frozen-stock is now honored via the cache flag (not this map), and cross-reference `ERLI_FROZEN_STOCK_FIELD` so the single #992/#1066 reconciliation point stays singular (see D3).

### 6. ADR-025 — sweep all #1066-deferral references

Amend §4b to record that frozen-`stock` is now honored on the quantity path via a reconciliation-populated cache flag (no per-tick GET); cite #1066. **Then sweep the rest of the ADR for #1066-as-deferred wording so nothing contradicts §4b** — at minimum: §Context ("Frozen stock on the quantity-sync path is a v1 follow-up (#1066)"), §Decision 4a, and §Consequences/Cons ("Frozen stock on the quantity path … are v1 follow-ups (#1066, #993)"). Leave #993 framed as deferred; only the #1066 frozen-stock items flip to "honored". Note the bounded-window caveat explicitly: frozen-stock is honored **from the first reconciliation pass onward**; the sub-cadence window (a freeze landing between ticks) is accepted per ADR-025 §1's reconciliation-first / eventual-consistency posture. (Doc-only; same wave.)

## Tests (`erli-offer-manager.adapter.spec.ts`)

Add a new `describe` block whose adapter is constructed with a `jest.Mocked<CachePort>` (4th constructor arg). **Existing quantity-path tests stay as-is** — the default spec builds the adapter without a cache (`new ErliOfferManagerAdapter('conn-1', ERLI_ADAPTER_KEY, httpClient)`), and because `isStockFrozenCached` fail-opens when `this.cache` is `undefined`, those tests (including the existing `expect(httpClient.get).not.toHaveBeenCalled()` no-GET assertion) remain green unchanged and serve as the "no cache wired → fail-open + no GET" coverage. **Do not retrofit them with a cache mock** (unnecessary churn that contradicts the fail-open design).

New cache-wired cases:

- **write→read round-trip on one key (the linchpin)**: write via `getOfferStatus(VALID_ID)` with `frozenFields: ['stock']`, then read via `updateOfferQuantity({ offerId: VALID_ID })` against the **same** mocked cache, assert the PATCH is skipped. Exercises that writer and reader build the identical key (none of the per-path cases below do).
- **frozen → stock push skipped**: `cache.get` resolves `true` ⇒ `updateOfferQuantity` issues **no** `httpClient.patch`.
- **not-frozen → stock pushed**: `cache.get` resolves `null` (key absent — write-on-frozen-only means not-frozen is `delete`d, not stored `false`) ⇒ one PATCH `{ stock }` (asserts AC + normal path unchanged).
- **cache miss → stock pushed (fail-open)**: `cache.get` resolves `null` ⇒ PATCH issued.
- **cache read error → stock pushed (fail-open)**: `cache.get` rejects ⇒ PATCH issued (error swallowed).
- **hostile/malformed id → no cache touch, PATCH path runs**: `updateOfferQuantity({ offerId: 'not-a-valid-id' })` ⇒ `cache.get` **not** called (key builder returns `null`), and the push branch's `productPath` throws (behaviour unchanged for hostile ids; no unvalidated string in the keyspace).
- **cross-connection key isolation**: two adapters built with different `connectionId`s produce **disjoint** cache keys for the same variant id (guards the connection-scoping invariant against a future refactor).
- **reconciliation writes the flag (frozen)**: `getOfferStatus` with `frozenFields: ['stock']` ⇒ `cache.set` called with the key + `true` + `ERLI_FROZEN_STOCK_CACHE_TTL_SEC`.
- **reconciliation clears the flag (not-frozen)**: `getOfferStatus` with `frozenFields: []` ⇒ `cache.delete` called with the key (write-on-frozen-only / delete-on-unfreeze); **no** `cache.set(..., false, …)`.
- **bodyless 2xx leaves the cache untouched**: `getOfferStatus` where `fetchErliProduct` returns `{}` (`frozenFields` `undefined`) ⇒ **no** `cache.set` and **no** `cache.delete` (the undefined-array guard preserves a previously-cached `true`).
- **`getOfferStatus` 404 does NOT touch the cache**: no `cache.set`/`cache.delete` on the `OfferNotFoundOnMarketplaceException` branch.
- **`updateOfferFields` opportunistically writes the flag** (secondary writer): `frozenFields: ['stock']` ⇒ `cache.set(..., true, …)`.
- **no-GET invariant preserved**: cache-wired `updateOfferQuantity` (frozen and not-frozen) issues **no** `httpClient.get` — guards the AC "no additional GET on the hot path" (complements the existing cache-less no-GET assertion).

## Risks

- **Read-key/write-key identity (mitigated, not just noted)**: the feature is a silent no-op if the writer and reader build different keys. Mitigated by the single `frozenStockCacheKey` builder shared by both paths + the write→read round-trip test (D1, Tests) — no longer left as an unguarded assumption.
- **#992-provisional**: the Erli frozen wire-name for stock (`ERLI_FROZEN_STOCK_FIELD = 'stock'`), the `frozenFields` shape, and the seller-key format are unconfirmed until the sandbox spike — isolated in `erli-product.types.ts` + the colocated adapter constants (single change point, same posture as #988). **If #992 switches the seller-key format** (e.g. to a free-form SKU/barcode), the cache-key builder's `ERLI_PRODUCT_ID_PATTERN` validation must be re-confirmed in lockstep with `productPath` (both already share the pattern) — a loosened pattern without that re-confirmation would let externally-sourced ids into the Redis keyspace at high cardinality (bounded by the 26 h TTL, but still). Extend the existing "#992 changes `productPath` + `resolveErliProductId` together" coupling note to include the cache-key builder.
- **Eventual consistency window**: a stock frozen *between* reconciliation ticks is overwritten once until the next pass caches the flag (≤ reconciliation cadence, default 1 h). Acceptable per ADR-025 §1 reconciliation-first posture; tighten the cron if a deployment needs a smaller window. The window is bounded by the **cron cadence** (re-asserted each tick), not the TTL. Documented in the adapter docblock.
- **Cache availability**: if `host.cache` is absent or Redis is down, the feature silently no-ops (fail-open = pre-#1066 behaviour). No correctness regression, only the frozen-stock guarantee lapses — logged at debug.

## Quality gate (scoped — constrained machine)

From `…/.claude/worktrees/1066-erli-frozen-stock`:
```
pnpm --filter @openlinker/integrations-erli type-check
pnpm exec eslint <changed files>
pnpm --filter @openlinker/integrations-erli test
```
No core change ⇒ no `migration:show`, no full-repo build/test.

## Files changed

- `libs/integrations/erli/src/erli-plugin.ts` — pass `host.cache` into `createAdapters`.
- `libs/integrations/erli/src/application/erli-adapter.factory.ts` — accept + forward `cache?: CachePort`.
- `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts` — `cache` ctor dep; `writeFrozenStockFlag` / `isStockFrozenCached`; write in `getOfferStatus` + `updateOfferFields`; read in `updateOfferQuantity`; constants; docblock/comments.
- `libs/integrations/erli/src/infrastructure/adapters/erli-product.types.ts` — (optional) note `stock` as a recognised `frozenFields` member (#992-provisional); no shape change required (`frozenFields: string[]` already covers it).
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-offer-manager.adapter.spec.ts` — cache mock + the cases above.
- `docs/architecture/adrs/025-erli-marketplace-adapter.md` — §4b amendment (doc-only).

## Related

- ADR-025 §4b · #988/#1061 (frozen-field exclusion + the `stock` map omission this completes) · #989 (`getOfferStatus` / reconciliation — the GET we piggyback on) · #816 (`offer_status_snapshots` — the reconciliation infra, deliberately *not* extended) · `CachePort` (`@openlinker/shared`, on `HostServices.cache`).
