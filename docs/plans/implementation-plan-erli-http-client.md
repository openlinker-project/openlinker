# Implementation Plan: ErliHttpClient — bearer auth, keep-alive, 429 backoff (#981)

**Date**: 2026-06-12
**Status**: Ready for Review
**Estimated Effort**: 1–2 days
**Issues**: Closes #981
**Branch**: `981-erli-http-client` (stacked on `980-983-erli-plugin-skeleton-adr`, PR targets `main` as draft until #1019 merges)

---

## 1. Task Summary

**Objective**: Ship the shared HTTP client every Erli adapter (offers half #984+, orders half #993+) routes through: static API-key **bearer** auth on every request, **keep-alive pooled** connections (Erli docs recommend it to avoid repeated SSL handshakes), bounded **429 backoff-retry** with typed exhaustion error, structured logging via the shared `Logger`, and typed GET / POST / PATCH wrappers (the only methods Erli's REST API uses).

**Context**: Wave 1 of the Erli integration (spec `docs/specs/product-spec-978-erli-marketplace-integration.md`, ADR-022). The client is pure infrastructure inside the plugin package — nothing consumes it yet; #982/#984/#993 wire it into the adapter factory per connection.

**Classification**: Integration (`libs/integrations/erli/` only). No core, app, or migration changes.

---

## 2. Scope & Non-Goals

### In Scope
- `IErliHttpClient` interface + `ErliHttpClient` implementation under `libs/integrations/erli/src/infrastructure/http/`.
- Typed `get<T>` / `post<T>` / `patch<T>` wrappers returning `ErliHttpResponse<T> = { status, data }` (Erli's async writes answer **HTTP 202** — adapters must be able to see the status, so the wrapper exposes it; mirrors Allegro's `{ data }`-wrapper shape).
- Static bearer auth: `Authorization: Bearer ${apiKey}`, key passed via constructor (InPost precedent — credentials *resolution* from `credentialsRef` is #982/#984 factory territory).
- Keep-alive pooling via Node's global `fetch` (undici under the hood) — same as every sibling client (see Decision D1). **Note**: this satisfies the AC's keep-alive requirement at the *runtime* layer; it is not unit-assertable without an injected dispatcher (see Decision D2).
- **Retry policy — conservative by default (see Decision D3):**
  - `429` → always retried (bounded exponential backoff + jitter, `Retry-After` honored); exhaustion surfaces `ErliRateLimitException`.
  - `5xx` / network errors → retried **only for idempotent requests** (GET/PATCH by HTTP semantics, or any request the caller explicitly marks `idempotent: true`); exhaustion surfaces `ErliNetworkException`. A non-idempotent request (default for POST) that hits a 5xx/network error throws `ErliNetworkException` **immediately, without retry** — this prevents a blind retry from double-creating a resource (the DPD double-COD failure mode). Mirrors DPD's per-request `idempotent` gate, not InPost's retry-everything loop.
- Typed domain exceptions: `ErliApiException` (non-retryable 4xx), `ErliAuthenticationException` (401/403), `ErliRateLimitException` (429 exhausted, carries `retryAfterMs`), `ErliNetworkException` (network/timeout, or 5xx — both the immediate non-idempotent case and the exhausted-budget case).
- Unit tests (auth header, 429 retry + Retry-After, exhaustion, status classification, 202 passthrough, **idempotent-vs-non-idempotent retry branching**).
- Barrel export from `src/index.ts`: **the four exceptions only** — matching every sibling (InPost/Allegro/DPD barrels export exceptions + domain types, never the HTTP client). `IErliHttpClient` and `ErliHttpClient` stay **package-private**; the #982 `ErliAdapterFactory` is in-package and imports them by relative path, so the barrel needn't widen its public surface.

### Out of Scope (own issues)
- Credentials resolution / shape validation / connection tester (#982).
- Any adapter using the client (#984, #993), inbox-cursor mechanics (#993), 202-reconciliation logic (#989).
- Request-level idempotency keys, circuit breaking, metrics.

### Constraints
- Plugin package only — must not import `@nestjs/common` (plugins are framework-neutral; logging via `@openlinker/shared/logging` console default).
- No `OL_*` env vars; retry tuning via optional constructor `Partial<RetryConfig>` like every sibling client.

---

## 3. Architecture Mapping

**Target Layer**: Integration infrastructure (`libs/integrations/erli/src/infrastructure/http/` + `domain/exceptions/`).

**Reference precedents** (verified 2026-06-12):
- `InpostHttpClient` (`libs/integrations/inpost/src/infrastructure/http/`) — closest match: static bearer token in constructor, `withRetry` loop (3 retries, 500 ms initial, 8 000 ms max, ×2 + jitter, `Retry-After` honored), 401/403 → unauthorized exception, other 4xx → rejection, 5xx/network retried.
- `AllegroHttpClient` (`libs/integrations/allegro/src/infrastructure/http/`) — typed per-method wrappers (`get/post/patch`), `{ data }` response wrapper, trace-id logging, `.types.ts` colocated file.
- Exception shape: `*Exception extends Error` with `name` + `Error.captureStackTrace`, in `domain/exceptions/` (InPost/Allegro/DPD all identical).
- Test convention: `infrastructure/http/__tests__/*.spec.ts`, stub the fetch seam, ~1 ms retry delays.

**Reuse audit — no SDK infrastructure is being reinvented** (verified 2026-06-12 against `libs/plugin-sdk/**` and `libs/shared/**`):
- **No shared HTTP client, retry loop, or backoff/rate-limit helper exists** anywhere in `@openlinker/plugin-sdk` or `libs/shared`. Allegro, DPD, and InPost each own a `fetch`-based client with a home-grown retry loop — a per-plugin `ErliHttpClient` is the established pattern, not duplication. (Pre-empts the "why not a shared base class?" review question — the reuse check was done and came back empty.)
- **`HostServices.logger` / `credentialsResolver`** are reused: logging via the shared `Logger` (sibling convention, see D-Logger note in Step 4), and the API key arrives already resolved (the future `ErliAdapterFactory` calls `host.credentialsResolver.get<ErliCredentials>(connection.credentialsRef)` in #982 — the client itself never touches the resolver).
- **`HostServices.cache` is intentionally unused.** Allegro caches token state + category-params there; Erli has a static API key (ADR-022, no token to refresh and no expensive read this client owns), so the client touches no cache. Deliberate, not an overlooked affordance.

**Transport exceptions live in `domain/exceptions/`, not `infrastructure/`, by design** (hexagonal). A network/rate-limit error looks like an infrastructure concern, but these four exception *types* are the plugin's **published contract that the host sync-runner classifies against** (`RetryClassifierPort` #581, `AuthFailureClassifierPort` #819 — see Decision D4). They cross the plugin boundary, so they belong in the domain layer. Matches InPost/Allegro/DPD placement.

### Decision D1 — keep-alive mechanism

- **Chosen**: Node's global `fetch` — identical to every sibling client (Allegro, InPost, DPD). Node 18+'s global `fetch` *is* undici, which keep-alive-pools by default. The AC's keep-alive requirement is therefore already satisfied transitively; the client reuses one HTTP path across requests (no per-call agent/client setup) and a file-header comment records that pooling is provided by the global `fetch` runtime. (How this is — and isn't — tested is settled in Decision D2: runtime-provided, not unit-asserted.)
- **Rejected**: explicit `undici` `Agent` dependency. It does not enable any pooling that the global `fetch` lacks, introduces the only explicit-undici dependency in the repo (breaking the "mirror the siblings" principle the rest of this plan rests on), adds a version-skew maintenance surface against Node's bundled undici, and sets an odd precedent for future plugins. The marginal gain — literal mock-an-agent testability — does not justify the divergence.

### Decision D2 — keep-alive is runtime-provided and NOT unit-asserted

#981's AC reads *"Connections are keep-alive pooled"* **and** *"Unit tests (… keep-alive)"*. With the D1 choice (global `fetch`, no injected dispatcher) there is **nothing observable to assert** in a unit test — connection pooling happens inside the Node `fetch` runtime, below the seam the test can see. Rather than ship a test that asserts nothing and can never fail, this plan is explicit:

- Keep-alive pooling is satisfied **transitively** by the Node `fetch` (undici) runtime, which keep-alive-pools by default. A file-header comment on `erli-http-client.ts` records this.
- The keep-alive AC is therefore met at the runtime layer and is **deliberately not** backed by a dedicated unit test (a "fetch invoked without per-request teardown" assertion would be theatre — it verifies nothing about actual socket reuse).
- **Reviewer sign-off required**: the #981 AC was written assuming an explicit agent. The #981 PR description must call out this deviation so the reviewer accepts "runtime-provided, not unit-asserted" instead of expecting a keep-alive spec. If the reviewer insists on a literal test, the only honest way to provide one is an injected transport/dispatcher seam — which reopens D1; surface that trade-off explicitly rather than smuggling a hollow test in.

### Decision D3 — retry policy is conservative-by-default for non-idempotent writes

The earlier draft retried 5xx/network on every method, justified by *"Erli writes are idempotent by design."* That fact is **unverified** — confirming Erli's write semantics is exactly what the #992 sandbox spike exists to do, and #992 has not landed. Banking a safety-critical retry decision on an unconfirmed assumption is the DPD double-COD trap (`dpd-http-client` retries non-idempotent creates only behind an explicit flag for this reason).

- **Chosen**: retry `429` unconditionally (the server demonstrably did *not* process the request, so a retry can't double-apply). Retry `5xx`/network **only** when the request is idempotent — GET and PATCH by HTTP semantics, plus any request the caller explicitly opts in via `idempotent: true`. POST defaults to **non-idempotent**: a 5xx/network failure throws `ErliNetworkException` immediately, no retry. This is safe even though it means a transient blip on a POST surfaces as an error the caller must handle — correctness over convenience.
- **Rejected**: retry-everything (InPost model). Safe for InPost because its retryable surface is effectively idempotent; not safe to assume for an unverified marketplace write API.
- **#992 follow-up**: once the sandbox confirms which Erli writes are genuinely idempotent (e.g. PATCH-upsert keyed by external id, inbox ack), #984/#993 may pass `idempotent: true` on those specific calls — a per-call opt-in, never a global default flip. A `// TODO(#992)` on the retry predicate records this.

### Decision D4 — the client is tier-one retry; the host runner is tier-two via classifiers (#581 / #819 / ADR-008)

OpenLinker does **not** treat a plugin's in-client retry as the whole story. After the client throws, the sync-job runner (`apps/worker/src/sync/sync-job.runner.ts`) calls `retryClassifierRegistry.isNonRetryable(cause)` and `authFailureClassifierRegistry.isCredentialRejected(cause)` to decide **job-level** retry and **connection re-auth**. Verified default (`retry-classifier-registry.service.ts:46`): **with no classifier registered, every error is treated as retryable.**

So there are two retry tiers, by design (Allegro does both):
- **Tier one (this PR)** — the client retries the fast transient (`429`/idempotent `5xx`/idempotent network) in-request, with bounded backoff. `maxRetries: 3` stays deliberately modest *because* tier two backstops it — do not compound the tiers with a large in-client budget.
- **Tier two (#984/#993)** — the runner retries the job, gated by the plugin's `RetryClassifierPort`, and flags the connection `needs_reauth` via `AuthFailureClassifierPort`.

**Classifier *registration* is out of #981 scope** — correctly, because no Erli capability/adapter exists until #984/#993, so no Erli job can run and there is nothing for a classifier to classify yet. But this is a **conscious deferral with a hard requirement on #984/#993**, not an omission:

- **#984/#993 MUST register both classifiers** via `plugin.register(host)` (mirroring `allegro-retry-classifier.adapter.ts` + `allegro-auth-failure-classifier.adapter.ts`). The consequence of skipping them is concrete and bad: an `ErliApiException` for a permanent `400`/`422` would be retried to `maxAttempts` pointlessly, and an `ErliAuthenticationException` for a bad API key would be retried pointlessly **and never flag the connection for re-auth** — defeating the whole point of #819/ADR-008 (the operator never learns their key is wrong).
- **#981's job is to make that registration trivial**: the exception taxonomy (`ErliApiException` / `ErliAuthenticationException` / `ErliRateLimitException` / `ErliNetworkException`) is designed precisely so the future classifiers can `instanceof`-discriminate — `ErliAuthenticationException` → `isCredentialRejected = true`; permanent-4xx `ErliApiException` → `isNonRetryable = true`; `ErliRateLimitException`/`ErliNetworkException` → retryable. This is the reason for distinct types rather than one catch-all error.

---

## 4. External / Domain Research

- **Erli Shop API** (https://erli.pl/svc/shop-api/doc/): REST over HTTPS, GET/POST/PATCH only; static API-key bearer auth (no OAuth, no refresh, no expiry signal — ADR-022); writes return **202** with ~20-min cache lag; only **429** is documented for rate limiting (load-dependent, no published quota); keep-alive recommended by Erli.
- **Base URLs**: prod `https://erli.pl/svc/shop-api` (path per docs), sandbox `https://sandbox.erli.dev` — the client takes `baseUrl` via constructor; which URL applies per connection is #982's config concern. Exact path prefix to be confirmed against docs during implementation; the client itself is URL-agnostic.
- **401 vs Allegro**: no token refresh exists — 401/403 maps straight to `ErliAuthenticationException`, never retried (simpler than Allegro's refresh dance; matches InPost).

---

## 5. Questions & Assumptions

### Assumptions (safe defaults)
1. **Retry safety does NOT assume Erli idempotency** (see Decision D3) — `429` always retried; `5xx`/network retried only for idempotent requests (GET/PATCH, or explicit `idempotent: true`); non-idempotent POST fails fast. The earlier "writes are idempotent by design" assumption is deferred to #992 verification and does not gate this PR.
2. **`ErliHttpResponse<T> = { status, data }`** — adapters need the 200/202 distinction (#989 reconciliation); siblings differ (Allegro wraps, InPost doesn't) so this is a deliberate choice, documented in the interface header.
3. **API key via constructor string** — `ErliCredentials` shape + resolution land with #982; passing the resolved key keeps this PR free of credential plumbing.
4. **Empty/204/202-no-body responses** return `data: undefined as T` like siblings.
5. **Retry defaults**: `maxRetries 3, initialDelayMs 500, maxDelayMs 8000, backoffMultiplier 2` + jitter — InPost values; overridable per `Partial<RetryConfig>`.
6. **`baseUrl` must be `https:`** — the client rejects a non-HTTPS base URL in its constructor (defense-in-depth; Erli is HTTPS-only). Prevents a misconfigured connection from sending the bearer key over plaintext.

### Open Questions
- None blocking. D1 resolved (keep-alive via global `fetch`, no undici dep). D2 resolved (keep-alive is runtime-provided, not unit-asserted — needs reviewer sign-off in the PR). D3 resolved (conservative retry; Erli idempotency deferred to #992).

---

## 6. Proposed Implementation Plan

### Step 1 — Exceptions (`libs/integrations/erli/src/domain/exceptions/`)
- `erli-api.exception.ts` — `ErliApiException` (`statusCode`, `responseBody?`, `url?`).
- `erli-authentication.exception.ts` — `ErliAuthenticationException` (401/403).
- `erli-rate-limit.exception.ts` — `ErliRateLimitException` (`retryAfterMs?`).
- `erli-network.exception.ts` — `ErliNetworkException` (`cause?`).
- Each: `extends Error`, sets `name`, `Error.captureStackTrace` — verbatim sibling shape.
- **`responseBody` log-leak guard**: `ErliApiException.responseBody` may echo back submitted data, so its docblock states it is for diagnostics only and **must not** be logged at `info`/`warn` — only `debug`. The same "no key, no bodies above debug" rule (Step 4) covers thrown-exception bodies.
- **Classifier-ready taxonomy (D4)**: the four distinct types exist so the future `RetryClassifierPort` / `AuthFailureClassifierPort` adapters (#984/#993) can `instanceof`-discriminate — `ErliAuthenticationException` → credential-rejected; permanent-4xx `ErliApiException` → non-retryable; `ErliRateLimitException`/`ErliNetworkException` → retryable. Each exception's docblock names which classification it feeds, so the #984/#993 author wires the host registries without re-deriving intent. This is *why* it's four types, not one catch-all.

### Step 2 — Types (`infrastructure/http/erli-http-client.types.ts`)
- `RetryConfig` (`maxRetries`, `initialDelayMs`, `maxDelayMs`, `backoffMultiplier`), `DEFAULT_RETRY_CONFIG` const.
- `ErliRequestOptions` (`queryParams?`, `headers?`, `timeoutMs?`, `idempotent?: boolean` — gates 5xx/network retry per Decision D3), `ErliHttpResponse<T>` (`status`, `data`).
- **Deliberate standards-alignment note**: siblings (InPost/Allegro) inline `RetryConfig` in their `.ts`; this plan puts it in a dedicated `.types.ts` to honor engineering-standards "types in separate files." This is an intentional improvement over the precedent, not an inconsistency — the file header / PR description says so to pre-empt a "why differ from InPost?" review comment.

### Step 3 — Interface (`infrastructure/http/erli-http-client.interface.ts`)
- `IErliHttpClient` with `get<T>(path, options?)`, `post<T>(path, body?, options?)`, `patch<T>(path, body?, options?)` → `Promise<ErliHttpResponse<T>>`. GET/PATCH are idempotent by HTTP semantics; POST is non-idempotent unless `options.idempotent === true` (D3).

### Step 4 — Implementation (`infrastructure/http/erli-http-client.ts`)
- **Plain class, never a Nest provider, never `@Injectable` (NestJS best practice).** Instantiated **per connection** inside the future `ErliAdapterFactory` (#982) — exactly like `AllegroHttpClient` / `DpdHttpClient`, which are `new`'d in their factories, not registered in the DI container. The client closes over **one connection's resolved API key**, so providerizing it as a singleton would be a real cross-connection credential-bleed bug. Erli stays on `createNestAdapterModule` (no plugin-specific Nest providers — static key, no token-refresh service to inject). This step adds the class only; the factory that constructs it lands in #982.
- **Logging**: `private readonly logger = new Logger(ErliHttpClient.name)` from `@openlinker/shared/logging` — the sibling convention (InPost/Allegro/DPD all do this; the shared package's console default + host boot-swap means the client need not be handed `host.logger`).
- `constructor(connectionId: string, baseUrl: string, apiKey: string, retryConfig?: Partial<RetryConfig>)`. **Constructor rejects a non-`https:` `baseUrl`** (`throw new ErliApiException(...)` or a small config guard) so the bearer key can never go out over plaintext (Assumption 6).
- Internal `RetryableHttpError` marker class (InPost pattern — never escapes the client) carrying `status?`, `retryAfterMs?`, and a **`kind: 'rate-limit' | 'transport'` discriminator** so the loop throws the correct typed exception on exhaustion (`ErliRateLimitException` for `'rate-limit'`, `ErliNetworkException` for `'transport'`).
- Private `request<T>(method, path, body?, options?)` over Node's global `fetch` (keep-alive pooled by the runtime, D1/D2). Status classification: `401/403` → `ErliAuthenticationException` (no retry); other non-429 `4xx` → `ErliApiException` (no retry); `429` → `RetryableHttpError{kind:'rate-limit'}`; `5xx`/network → `RetryableHttpError{kind:'transport'}` **only if the request is idempotent** (GET/PATCH or `options.idempotent`), otherwise `ErliNetworkException` thrown immediately (D3). `// TODO(#992)`: revisit which writes may opt into `idempotent: true` once sandbox confirms Erli write semantics.
- Retry loop: `Retry-After` wins over computed backoff, capped at `maxDelayMs`; jittered exponential backoff otherwise. **`Retry-After` parse guard**: `Number(header)` → if `NaN`/non-finite (e.g. HTTP-date form), fall back to jittered backoff — never feed `NaN` to `setTimeout`.
- 30 s default timeout via `AbortController`; per-request UUID `requestId` in debug/warn logs; never log the API key, request bodies, or `responseBody` at non-debug levels.

### Step 5 — Barrel wiring
- `src/index.ts`: export **the four exceptions only** (sibling convention — see In Scope). `IErliHttpClient`, `ErliHttpClient`, and the `.types.ts` types stay package-private (the #982 in-package factory imports them relatively). No new package dependency (global `fetch`, D1).
- **Forward-contract note (no code in #981)**: the exceptions are exported now so #984/#993 can build `RetryClassifierPort` / `AuthFailureClassifierPort` adapters against them and register via `plugin.register(host)` (D4). #981 registers **no** classifier (nothing to classify until an adapter runs jobs); the obligation is recorded on #984/#993.

### Step 6 — Unit tests (`infrastructure/http/__tests__/erli-http-client.spec.ts`)
- Stub `global.fetch` (sibling convention). Cover: bearer header on every method; query-param serialization; 429 retried then success; `Retry-After` honored; **malformed (HTTP-date / non-numeric) `Retry-After` falls back to backoff, never `NaN`**; 429 exhaustion → `ErliRateLimitException` with `retryAfterMs`; 401 → `ErliAuthenticationException` no-retry; 400 → `ErliApiException` no-retry; **idempotent (GET/PATCH) 5xx/network retried then exhaustion → `ErliNetworkException`**; **non-idempotent POST 5xx/network → `ErliNetworkException` immediately, fetch called exactly once (no retry)**; **POST with `idempotent: true` IS retried**; 202 returns `status: 202`; empty-body handling; **non-`https:` baseUrl rejected at construction**. Retry delays tuned to ~1 ms.
- Keep-alive: **no dedicated test** — runtime-provided per Decision D2 (documented, reviewer-signed-off in the PR description).

### Step 7 — Quality gate
- `pnpm --filter @openlinker/integrations-erli test`, then `pnpm lint`, `pnpm type-check` (resource-constrained box: package-scoped test first, full gate before commit).

---

## 7. Validation

- **Architecture**: infrastructure-only inside one plugin package; no core imports beyond `@openlinker/shared/logging`; no NestJS decorators; no cross-context barrels touched → cross-context walker unaffected. Transport exceptions sit in `domain/exceptions/` because they're the host-classification contract, not a layering slip (§3 / D4).
- **NestJS wiring**: client is a plain per-connection class `new`'d in the (#982) factory — never `@Injectable`, never a DI singleton (would bleed one connection's key across all) — matching Allegro/DPD; Erli stays on `createNestAdapterModule` (Step 4).
- **Reuse / don't-reinvent**: verified no shared HTTP/retry/backoff helper in `plugin-sdk` or `shared`; `host.credentialsResolver` reused for the key, `host.cache` intentionally unused (§3).
- **Host retry/auth contract (D4)**: client is tier-one retry only; #984/#993 must register `RetryClassifierPort` + `AuthFailureClassifierPort` against the exception taxonomy shipped here, or permanent-4xx/401 errors get pointlessly retried and bad-key connections never flag `needs_reauth`.
- **Naming**: `*.exception.ts` in `domain/exceptions/`, `*.types.ts` separate, interface in its own file, `I*` interface prefix — all per `docs/engineering-standards.md`.
- **Security**: API key only in the `Authorization` header, never logged; `responseBody` on `ErliApiException` is debug-only (Step 1); non-HTTPS `baseUrl` rejected at construction so the key can't leave over plaintext (Step 4); no secrets in code or fixtures.
- **Retry safety**: conservative-by-default (D3) — no double-create risk on non-idempotent POST; Erli idempotency claims deferred to #992 rather than assumed here.
- **Testing**: unit-only (client has no DB/Redis surface); int-spec coverage arrives with #991's vertical slice.
- **AC traceability**: one-client routing (interface ready for #984/#993) ✔; 429 bounded retry + typed exhaustion ✔ (Step 4/6); keep-alive pooled ✔ at runtime (D1) — explicitly *not* unit-asserted, reviewer sign-off required (D2); unit tests ✔ (Step 6, incl. retry-branching + HTTPS guard).
