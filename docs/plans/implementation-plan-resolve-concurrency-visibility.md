# Implementation Plan — Operator-visible category-resolve in-flight ceiling (#2229)

**Issue**: [#2229](https://github.com/openlinker-project/openlinker/issues/2229)
**Branch**: `2229-resolve-concurrency-visibility`
**Base**: `main` @ `bb1d45593` (#2214 merged)

---

## 1. Understand the task

**Goal.** Make the resolve-path outbound in-flight ceiling a value the operator can read, and stop the
connection page from claiming the opposite; additionally, let an operator's configured
`maxConcurrent` bound it.

**The defect is a false statement, not a missing feature.** `STREAM_CONCURRENCY = 9`
(`resolve-categories-for-batch-by-ean.ts:98`) paces `GET /sale/products` on the wizard's Resolve step.
Allegro declares no `defaultRateLimit` and deliberately never will (#1810 §1), so with no
`config.rateLimit` the connection page renders *"Leave rate limiting off for unlimited (the default for
this adapter)"* and the live readout renders *"No limit configured — this connection is not
rate-limited."* Both are true of the shared outbound limiter and false of the resolve path, whose
ceiling sits inside the adapter's own resolver, below the limiter.

**Layer**: Integration (adapter-declared value) → Application/Interface (projection + DTO) → Frontend
(copy + one rendered line).

**Non-goals** (stated in the issue, restated so scope cannot drift):
- Changing the value 9.
- Adding `defaultRateLimit` to the Allegro manifest (rejected in #1810 §1).
- A new per-capability concurrency **config** key. The ceiling stays code-owned; this makes it
  *visible* and *bounded by a cap the operator already set*.
- Promoting `PrestashopRateLimitReadout` to every connection (see §3, decision D3).

---

## 2. Research — what the repo already has

| Fact | Where | Consequence for this plan |
|---|---|---|
| `STREAM_CONCURRENCY = 9`, `DEFAULT_CONCURRENCY = 3`; stream reads `options?.concurrency ?? STREAM_CONCURRENCY` | `libs/integrations/allegro/.../resolve-categories-for-batch-by-ean.ts:67,98,146` | One arithmetic site to clamp; the option already exists. |
| `EanCategoryMatcherStreaming` sub-capability + `isEanCategoryMatcherStreaming` guard (#2207) | `libs/core/src/listings/domain/ports/capabilities/ean-category-matcher-streaming.capability.ts` | The ceiling belongs to the capability that owns the concurrency, not to a new capability. |
| ADR-046 precedent: `getDescriptionFormat()` is an **optional member of an optional sub-capability**, and the resolver **probes for the method at runtime** rather than trusting the guard | `#2193`, `description-format-resolution.ts` | Exact shape to copy. The `isEanCategoryMatcherStreaming` guard tests only `streamCategoriesForBatchByEan`, so an out-of-tree plugin compiled against older core satisfies it and would throw. |
| `RateLimitStatusService` already resolves adapter **metadata** in a `try/catch` and degrades rather than failing the read | `apps/api/src/integrations/application/services/rate-limit-status.service.ts:69-88` | Same degradation contract for the new adapter resolution. |
| `AllegroAdapterFactory.createAdapters` resolves credentials and **throws `AllegroConfigException`** when absent | `libs/integrations/allegro/src/application/allegro-adapter.factory.ts:74,231` | Adapter resolution here **must** be wrapped. A misconfigured connection must not lose its whole rate-limit readout. |
| `toResponse` (connection list **and** detail) resolves adapter metadata per connection | `apps/api/src/integrations/http/connection.controller.ts:97` | The ceiling must **not** go on `ConnectionResponseDto` — that would construct N adapters on the connections list. |
| `RateLimitSection` is rendered for **every** connection; `PrestashopRateLimitReadout` is mounted **only** by the PrestaShop plugin's extra section | `edit-connection` form vs `plugins/prestashop/components/prestashop-extra-section.tsx` | An Allegro operator never sees the live readout. Putting the ceiling only there would satisfy the letter of the issue and none of its point. |

---

## 3. Design

### D1 — The adapter declares it; the ceiling and the run are computed by one function

A new pure helper in the Allegro util owns the arithmetic:

```ts
// libs/integrations/allegro/src/infrastructure/util/resolve-categories-for-batch-by-ean.ts
export function resolveStreamConcurrency(
  configuredMaxConcurrent?: number,
): { maxInFlight: number; source: 'connection-config' | 'adapter-default'; adapterDefault: number };
```

Both `getStreamConcurrency()` (what the operator is told) and `streamCategoriesForBatchByEan`'s
`concurrency` (what actually runs) call it. **They cannot drift** — a reported ceiling that differs
from the enforced one would be a worse defect than the one being fixed.

Clamp rule: `min(configuredMaxConcurrent, STREAM_CONCURRENCY)`, so a deliberately conservative
operator setting is honoured and a generous one never *raises* the adapter ceiling.

### D2 — Neutral contract: an optional member of the existing sub-capability

```ts
// libs/core/src/listings/domain/types/resolve-concurrency.types.ts  (new)
export const ResolveConcurrencySourceValues = ['connection-config', 'adapter-default'] as const;
export type ResolveConcurrencySource = (typeof ResolveConcurrencySourceValues)[number];

export interface ResolveConcurrencyCeiling {
  maxInFlight: number;
  source: ResolveConcurrencySource;
  /** What the adapter would use with no operator cap — so a clamped value can name what it clamped. */
  adapterDefault: number;
}
```

`EanCategoryMatcherStreaming` gains `getStreamConcurrency?(): ResolveConcurrencyCeiling`. Optional,
because an adapter may stream without a fixed ceiling. Callers probe the **method**, never the guard.

### D3 — Where it surfaces: `rate-limit-status`, rendered by `RateLimitSection`

The ceiling rides the existing single-connection read (`GET /connections/:id/rate-limit-status`) —
never `ConnectionResponseDto` (see §2). Two consequences:

1. `EffectiveRateLimitStatus.enabled` currently short-circuits the whole projection. The ceiling must
   be computed and returned **regardless of `enabled`**, because `enabled: false` is exactly the state
   this issue exists to correct.
2. `RateLimitSection` (every connection) consumes `useRateLimitStatusQuery` for this one line. This is
   deliberately *not* a promotion of `PrestashopRateLimitReadout` — that component is a live
   in-flight/queued readout with a manual refresh, a different thing from a static declared ceiling,
   and promoting it would double-render on PrestaShop. Its own false "not rate-limited" sentence is
   corrected in place.

Copy stays to one fact plus provenance, per the repo's no-dense-clusters convention:
> Category matching on this connection runs at most **9 requests in flight** (adapter default), at every
> batch size.

The "at every batch size" clause is what discharges the small-batch caveat: before #2215 a 45-variant
batch ran 3 in flight and now runs 9, and an operator reading only "adapter default" would assume small
runs are gentler.

### Data flow

```
AllegroOfferManagerAdapter.getStreamConcurrency()      [reads Connection.config.rateLimit.maxConcurrent]
   └─ resolveStreamConcurrency()  ←── same fn ──→  streamCategoriesForBatchByEan({ concurrency })
        │
        ▼  (neutral ResolveConcurrencyCeiling)
RateLimitStatusService.getStatus()  [OfferManager adapter → probe method → try/catch → omit on failure]
        ▼
RateLimitStatusResponseDto  →  GET /connections/:id/rate-limit-status
        ▼
useRateLimitStatusQuery  →  RateLimitSection (every connection)
```

---

## 4. Step-by-step

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/listings/domain/types/resolve-concurrency.types.ts` (new) | `ResolveConcurrencyCeiling` + `as const` source union | Exported from the `listings` barrel; `as const` pattern per engineering-standards |
| 2 | `libs/core/src/listings/domain/ports/capabilities/ean-category-matcher-streaming.capability.ts` | Add optional `getStreamConcurrency?()`; document why it is optional and why callers probe the method | Existing guard unchanged (widening it would stop recognising older plugins for streaming) |
| 3 | `libs/integrations/allegro/.../resolve-categories-for-batch-by-ean.ts` | Add `resolveStreamConcurrency()`; leave `STREAM_CONCURRENCY` as the adapter default | Pure, no I/O; unit-tested for clamp/passthrough/absent |
| 4 | `libs/integrations/allegro/.../allegro-offer-manager.adapter.ts` | Capture `Connection.config.rateLimit?.maxConcurrent` (ctor param is currently `_connection`); implement `getStreamConcurrency()`; pass `concurrency` into the stream call | Reported value === enforced value, asserted by a test |
| 5 | `apps/api/src/integrations/application/types/rate-limit-status.types.ts` | Add `resolveConcurrency?: ResolveConcurrencyCeiling` | Optional — absent means "no adapter reported one" |
| 6 | `apps/api/src/integrations/application/services/rate-limit-status.service.ts` | Resolve `OfferManager`, probe the method, `try/catch` → omit; return the ceiling on **both** the `enabled: false` and `enabled: true` paths | A connection whose adapter cannot be built still returns its limiter status |
| 7 | `apps/api/src/integrations/http/dto/rate-limit-status-response.dto.ts` | Carry the field through `fromDomain` | Swagger-annotated |
| 8 | `apps/web/src/features/connections/api/connections.types.ts` | Mirror the field on `RateLimitStatus` | Doc comment states `enabled:false` no longer implies unthrottled |
| 9 | `apps/web/src/features/connections/components/rate-limit-section.tsx` | Take `connectionId`; render the ceiling line; scope the "unlimited" claim to the shared limiter | Renders nothing extra when no ceiling is reported |
| 10 | `apps/web/src/features/connections/components/EditConnectionForm.tsx` | Pass `connection.id` | — |
| 11 | `apps/web/src/features/connections/components/prestashop-rate-limit-readout.tsx` | Scope "this connection is not rate-limited" to the outbound limiter | No fabricated ceiling when none is reported |

Tests: helper arithmetic (3), adapter report-equals-enforce (4), service degradation + `enabled:false`
carrying the ceiling (6), FE reported / not-reported branches (9, 11).

---

## 5. Validation

- **CORE ↔ Integration**: the ceiling crosses as a neutral `ResolveConcurrencyCeiling`; no Allegro name
  enters core, no `platformType` branch enters `apps/api`.
- **Naming**: `*.capability.ts` optional member, `*.types.ts` for the type, `as const` union.
- **Security**: no new credential surface; the read never calls the destination platform.
- **Risk — adapter construction on a settings read.** Mitigated by `try/catch` + omit. Accepted because
  #2193 set the same precedent (`resolvedVia: null`) for a comparable per-connection declared-capability
  read.
- **Risk — reported ≠ enforced.** Structurally prevented by D1 (one function, two callers) and pinned by
  a test.
