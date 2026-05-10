# Implementation Plan — Decouple Retry Classification from Allegro (#581)

**Parent**: Modularity Thread E (#551). Sibling already shipped: #582 (PR #620, dropped the `platformType === 'allegro'` filter in inventory propagation), #583 (PR #619, webhook-provisioning registry).
**Layer**: CORE (sync) + adapter (Allegro) + worker runner.
**Branch**: `581-decouple-retry-classification-from-allegro`.

---

## 1. Goal

`SyncJobRunner` imports `AllegroApiException` / `AllegroAuthenticationException` and a `NON_RETRYABLE_ALLEGRO_STATUS_CODES` set to decide which jobs are non-retryable (`apps/worker/src/sync/sync-job.runner.ts:19-30, 352-378`). A Shopify plugin can't extend the runner without a core PR; the worker has an architectural inversion against `@openlinker/integrations-allegro`.

Replace the hardcoded sniffing with a `RetryClassifierPort` + registry that integrations self-register against in `onModuleInit`. The runner asks the registry "is this error non-retryable?" — adapters answer for their own exception hierarchies. Identical behaviour for Allegro after the change.

## 2. Non-goals

- **Not** rewriting the retry policy itself (exponential backoff, max attempts, etc.). The runner keeps everything except the platform-specific exception sniffing.
- **Not** introducing per-platform `Retry-After` semantics — that's a follow-up; this plan only solves "is this error non-retryable?", not "when to retry next?".
- **Not** broadening the registry to handle anything beyond "should this error kill the job?". A future port may grow `getRetryDelay(error)` etc.; out of scope here.
- **Not** touching `OfferCreationInvariantException` handling — it's a CORE exception (`@openlinker/core/listings`), which is fine to keep referenced directly from the runner.
- **Not** moving the runner itself into core. It stays in `apps/worker`.
- **Not** anything in `inventory-propagate-to-marketplaces.handler.ts` — #582 already shipped (PR #620).

## 3. Design

### 3.1 — #581 — `RetryClassifierPort` + registry

**Pattern**: mirror `ConnectionTesterRegistryService` and `WebhookProvisioningRegistryService` (sibling registries, both shipped via #570/#571 and #583). Map keyed by `adapterKey`, registered in `onModuleInit`, queried by the runner.

**Port** (`libs/core/src/sync/domain/ports/retry-classifier.port.ts`):
```ts
export interface RetryClassifierPort {
  /**
   * Returns true if the cause is a deterministic, non-retryable failure
   * (auth, deterministic 4xx, etc.) for this platform's exception
   * hierarchy. The runner OR's the answers across registered classifiers.
   * Unknown errors return false — i.e., default-retryable.
   */
  isNonRetryable(cause: unknown): boolean;
}
```

**Registry** (`libs/core/src/sync/infrastructure/adapters/retry-classifier-registry.service.ts`):
```ts
@Injectable()
export class RetryClassifierRegistryService {
  private readonly classifiers: Map<string, RetryClassifierPort> = new Map();

  register(adapterKey: string, classifier: RetryClassifierPort): void;
  get(adapterKey: string): RetryClassifierPort | undefined;
  has(adapterKey: string): boolean;

  /** Iterate registered classifiers; return true if any reports non-retryable. */
  isNonRetryable(cause: unknown): boolean;
}
```

The `isNonRetryable(cause)` aggregation method is the only behavioural difference from the connection-tester / webhook-provisioning registries (which look up by adapterKey because dispatch is connection-bound). Retry classification doesn't have an adapterKey at hand — the runner just has the raw error — so the registry walks all classifiers. Each classifier's `isNonRetryable` is an O(1) `instanceof` check, so iterating ~handful of platforms is free.

**Note on the registry shape**: like its siblings (`ConnectionTesterRegistryService`, `WebhookProvisioningRegistryService`), `RetryClassifierRegistryService` does **not** have an `IRetryClassifierRegistryService` interface. This bends `.claude/rules/backend.md` "all services must implement an interface", but registries are containers (not application services in the application-layer sense), and the sibling pattern is well-established. Consistency wins.

**Token**: `RETRY_CLASSIFIER_REGISTRY_TOKEN = Symbol('RetryClassifierRegistryService')` — exported from `libs/core/src/sync/sync.tokens.ts` and the sync barrel.

**Wiring**: provided + bound + exported by `SyncModule` alongside `SyncJobRepositoryPort`, etc.

**Allegro adapter** (`libs/integrations/allegro/src/infrastructure/adapters/allegro-retry-classifier.adapter.ts`):
```ts
export class AllegroRetryClassifierAdapter implements RetryClassifierPort {
  private static readonly NON_RETRYABLE_STATUS_CODES = new Set([400, 403, 404, 405, 409, 415, 422]);

  isNonRetryable(cause: unknown): boolean {
    if (cause instanceof AllegroAuthenticationException) return true;
    if (
      cause instanceof AllegroApiException &&
      cause.statusCode !== undefined &&
      AllegroRetryClassifierAdapter.NON_RETRYABLE_STATUS_CODES.has(cause.statusCode)
    ) {
      return true;
    }
    return false;
  }
}
```

**Self-registration** in `AllegroIntegrationModule.onModuleInit`, alongside the existing metadata + factory + connection-tester registrations:
```ts
this.retryClassifierRegistry.register(
  'allegro.publicapi.v1',
  new AllegroRetryClassifierAdapter(),
);
```

**Runner change** (`apps/worker/src/sync/sync-job.runner.ts`):
- Drop the imports of `AllegroApiException`, `AllegroAuthenticationException`, and `NON_RETRYABLE_ALLEGRO_STATUS_CODES`.
- Inject `RetryClassifierRegistryService` via `@Inject(RETRY_CLASSIFIER_REGISTRY_TOKEN)`.
- **The runner owns the `SyncJobExecutionError.cause` unwrap**: the existing `const cause = error instanceof SyncJobExecutionError && error.cause ? error.cause : error;` line stays in `isNonRetryableError`. The unwrapped `cause` is what gets passed to `registry.isNonRetryable(cause)`. Each platform classifier sees the unwrapped value — no per-classifier unwrap dance.
- `isNonRetryableError(error)` keeps its `OfferCreationInvariantException` short-circuit (core, no platform coupling), then delegates the rest to `this.retryClassifierRegistry.isNonRetryable(cause)`.
- The lengthy comment block explaining each Allegro branch moves to the adapter.

After this change, `apps/worker` imports nothing from `@openlinker/integrations-allegro` for retry classification — the only remaining static import is in `sync-worker.module.ts` (`AllegroIntegrationModule`), which is part of the Thread C work tracked separately by #572 and out of scope here.

### 3.2 — Behaviour preservation matrix

| Scenario | Before | After |
|---|---|---|
| Allegro auth failure (401) | dead immediately | dead immediately (via `AllegroRetryClassifierAdapter`) |
| Allegro deterministic 4xx (422) | dead immediately | dead immediately (via classifier) |
| Allegro 5xx / 408 / 425 | retry with backoff | retry (no classifier returns true) |
| Allegro `AllegroNetworkException` | retry | retry (not classified non-retryable) |
| `OfferCreationInvariantException` | dead immediately | dead immediately (kept inline in runner — core exception) |
| Unrelated error (`new Error('boom')`) | retry | retry |

## 4. Step-by-step plan

> **Cross-cutting**: every new file in this PR ships with a JSDoc file header following `engineering-standards.md` §"File Headers" (purpose + context + `@module` + `@see` to siblings). Spec files included.

### CORE — port, registry, wiring

1. **Add port** `libs/core/src/sync/domain/ports/retry-classifier.port.ts` with `RetryClassifierPort.isNonRetryable(cause)`.
2. **Add registry** `libs/core/src/sync/infrastructure/adapters/retry-classifier-registry.service.ts` with register / get / has + aggregating `isNonRetryable`.
3. **Add token** `RETRY_CLASSIFIER_REGISTRY_TOKEN` to `libs/core/src/sync/sync.tokens.ts`.
4. **Wire** in `libs/core/src/sync/sync.module.ts`: register `RetryClassifierRegistryService` as a provider, bind `RETRY_CLASSIFIER_REGISTRY_TOKEN` via `useExisting`, and **export both the class and the token** in `SyncModule.exports`. The token export is what lets `AllegroIntegrationModule.onModuleInit` `@Inject(RETRY_CLASSIFIER_REGISTRY_TOKEN)` — without it the integration module can't resolve the dependency. Mirror of how `IntegrationsModule` exports `CONNECTION_TESTER_REGISTRY_TOKEN` alongside the class.
5. **Export** from `libs/core/src/sync/index.ts` — port, registry, token.
6. **Add unit spec** for the registry in `libs/core/src/sync/infrastructure/adapters/__tests__/retry-classifier-registry.service.spec.ts` — register / get / has, plus the `isNonRetryable` aggregation across multiple classifiers (none match → false; one matches → true).

### Allegro adapter

7. **Add `AllegroRetryClassifierAdapter`** at `libs/integrations/allegro/src/infrastructure/adapters/allegro-retry-classifier.adapter.ts`.
8. **Add unit spec** at `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-retry-classifier.adapter.spec.ts` — branches: auth exception, API non-retryable status (415, 422), API retryable status (503, 408), unrelated error, network exception (must NOT be classified — preserves the #499 cure).
9. **Register** in `AllegroIntegrationModule.onModuleInit`, mirroring the existing connection-tester registration. Inject `RETRY_CLASSIFIER_REGISTRY_TOKEN`. Update the `Registering Allegro adapter (metadata + factory + tester)` log line to mention the retry classifier. **Note the new cross-package import**: the Allegro module currently imports from `@openlinker/core/integrations` only; this PR adds a second import from `@openlinker/core/sync` for the registry + token. Architecturally fine (integrations may depend on core), but flag in the imports list during review.
10. **Export** the adapter from `libs/integrations/allegro/src/index.ts` alongside the connection tester.

### Worker — runner

11. **Update `apps/worker/src/sync/sync-job.runner.ts`**:
    - Drop imports of `AllegroApiException`, `AllegroAuthenticationException`, `NON_RETRYABLE_ALLEGRO_STATUS_CODES` constant.
    - Inject `RetryClassifierRegistryService` via `RETRY_CLASSIFIER_REGISTRY_TOKEN` (alongside the existing token injections).
    - In `isNonRetryableError`: keep `OfferCreationInvariantException` check, delegate the rest to `this.retryClassifierRegistry.isNonRetryable(cause)`.
    - Update the JSDoc on `isNonRetryableError` to point at the registry instead of listing Allegro branches.
12. **Update `apps/worker/src/sync/__tests__/sync-job.runner.spec.ts`**:
    - Provide a real `RetryClassifierRegistryService` with the real `AllegroRetryClassifierAdapter` registered, so the existing Allegro behavioural tests pass unchanged.
    - Existing tests stay green: auth exception, API 415, API 503, network exception, `OfferCreationInvariantException`.
    - **The spec keeps its existing `@openlinker/integrations-allegro` import** (`AllegroApiException`, `AllegroNetworkException`). The runner *production* code becomes platform-neutral; the runner *spec* still wires Allegro into a real registry to verify end-to-end retry classification. Don't follow the runner's import deletion into the spec — they're decoupled by design.

### Quality gate + ship

13. Run `pnpm lint && pnpm type-check && pnpm test`. Fix anything that surfaces.
14. Commit with `refactor(sync): route retry classification via core port + registry (#581)`.
15. Self-review (architecture, hexagonal compliance, naming, tests). Push, open PR, `Closes #581`.

## 5. Architecture compliance

- **Boundary**: `RetryClassifierPort` lives in `libs/core/src/sync/domain/ports/`; registry in `libs/core/src/sync/infrastructure/adapters/`. Allegro classifier in `libs/integrations/allegro/src/infrastructure/adapters/`. No platform names in core after this lands.
- **Dependency direction**: runner (apps/worker) → core port → core registry. Allegro adapter implements the core port. Mirror of the #570/#571/#583 pattern.
- **Naming**: `*.port.ts` / `{Capability}Port`; `*.adapter.ts` / `{Platform}{Capability}Adapter`. Symbol DI token. Match existing standards.
- **Domain purity**: the port is a pure interface (one method, no framework deps). The registry is `@Injectable` and lives in infrastructure.
- **Testing**: every new file gets a `*.spec.ts` mocking the port. The runner spec uses a real registry + real Allegro classifier (the Allegro classifier is itself a deterministic adapter with no I/O).

## 6. Risks & open questions

- **Risk: registry-aggregation order matters?** No — each classifier owns disjoint exception hierarchies (`AllegroApiException` vs hypothetical `ShopifyApiException`). Aggregation is OR; one match wins. No ordering dependency.
- **Open question: should `apps/api` also consume the registry?** The runner is the only consumer today. `apps/api` doesn't classify retry — out of scope.
- **Open question: where does the `OfferCreationInvariantException` short-circuit ultimately belong?** It could become a `CoreRetryClassifier` registered by `SyncModule` itself, removing the inline import. That's cosmetic — the runner is in `apps/worker` and importing from `@openlinker/core/listings` is allowed (apps → core). Leave it inline for this PR. Track as cleanup if it ever feels worth it.
