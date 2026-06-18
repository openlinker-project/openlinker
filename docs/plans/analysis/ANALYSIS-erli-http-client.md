# Pre-Implement Gate: ErliHttpClient (#981)

**Plan**: `docs/plans/implementation-plan-erli-http-client.md`
**Gate run**: 2026-06-14 (read-only; live-repo grep)
**Verdict**: 🟡 **NEEDS-REVISION** — one convention/contract defect (barrel exports the client class on a false premise). Everything else is clean. No code exists yet; the fix is a one-line plan edit.

---

## Reuse findings (does it already exist?)

Audited `libs/integrations/erli/**`, then `libs/integrations/**` / `libs/**`. The Erli package is a bare #980 skeleton — every artifact the plan creates is confirmed **absent**.

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `infrastructure/http/` directory | **NEW** | `libs/integrations/erli/src/` holds only `erli-plugin.ts`, `erli-integration.module.ts`, `index.ts`, `__tests__/erli-plugin.spec.ts` |
| `IErliHttpClient` + `ErliHttpClient` | **NEW** | no `erli-http-client.*` anywhere |
| `ErliApiException` / `ErliAuthenticationException` / `ErliRateLimitException` / `ErliNetworkException` | **NEW** | no `domain/exceptions/` dir in erli; sibling exceptions exist at `libs/integrations/{inpost,allegro,dpd-polska}/src/domain/exceptions/` as reference shape |
| `RetryConfig` / `DEFAULT_RETRY_CONFIG` / `ErliRequestOptions` / `ErliHttpResponse<T>` | **NEW** | absent in erli; `RetryConfig` precedent exists in siblings |
| `undici` dependency | **N/A (correctly absent)** | `erli/package.json` deps = `@openlinker/core`, `@openlinker/plugin-sdk`, `@openlinker/shared` only — matches the D1 decision to NOT add undici |
| Barrel exports in `src/index.ts` | **PARTIAL (extend)** | file exists, exports `erliAdapterManifest`, `createErliPlugin`, `ErliIntegrationModule`; plan adds exception exports (non-breaking) — see Critical-1 for the class-export issue |

**No reuse collisions.** Nothing the plan builds duplicates an existing port, service, token, ORM entity, or capability. The SDK reuse claims in the plan (`host.credentialsResolver`, `host.logger`, no shared HTTP/retry helper, `host.cache` unused) were independently confirmed in review #2 against `libs/plugin-sdk/**` + `libs/shared/**`.

---

## Backward-compatibility findings

| Surface | Finding | Severity |
|---|---|---|
| Top-level barrel `@openlinker/integrations-erli` | Plan Step 5 / In-Scope says export **the concrete `ErliHttpClient` class** "because sibling plugins export their clients for factory use." **This premise is false** — InPost, Allegro, and DPD barrels export only their **exceptions + domain types**, never the HTTP client class or its interface. The future `ErliAdapterFactory` lives *inside* the erli package (`src/application/`), so it imports the client by **relative path**, not via the barrel — exactly why siblings don't export it. Exporting it needlessly widens the plugin's public contract surface against the established convention. | **Critical** (contract-surface shape, but additive — nothing consumes erli's barrel yet, so no runtime break) |
| Port method signatures | No existing `*Port` is implemented or changed (the client implements its own new `IErliHttpClient`). | none |
| DTO shapes | No request/response DTOs touched. | none |
| Symbol tokens | No `*.tokens.ts` added or changed (client is `new`'d in the #982 factory, not DI-bound). | none |
| ORM schema / migrations | No ORM entity, no table, no column → **no migration** (`docs/migrations.md` N/A). | none |
| `check:invariants` | Cross-context import guard: infrastructure-layer files are exempt (`.eslintrc.js` infra/persistence/application override), and the client imports only `@openlinker/shared/logging` + relative `../../domain/exceptions/*` — both allowed (verified against `inpost-http-client.ts`). `check-service-interfaces` only scans `libs/core/src/**` — out of scope. No repo-URL guard surface. **No trip.** | none |

### Suggested fix for Critical-1
Change the plan's barrel bullet (Step 5 + the In-Scope line) to export **only the four exceptions** from `src/index.ts` (matching InPost/Allegro/DPD). Drop "the concrete class too — sibling plugins export their clients for factory use." The `IErliHttpClient` interface and `ErliHttpClient` class stay package-private; the #982 factory imports them relatively. This is the single edit that moves the verdict to READY.

---

## Confirmed-correct (no action)

- **Exception file naming** `erli-{type}.exception.ts`, `extends Error` + `name` + `Error.captureStackTrace` — matches all three siblings verbatim.
- **File layout** `infrastructure/http/erli-http-client.ts` + `.interface.ts` + `.types.ts` + `__tests__/` — sibling-consistent.
- **`RetryConfig` in a separate `.types.ts`** — the plan flags this as a deliberate deviation from InPost/Allegro/DPD (which inline it); confirmed it **matches the newer WooCommerce precedent** (`woocommerce-http-client.types.ts`) and engineering-standards §"Type Definitions in Separate Files". Not a problem.
- **tsconfig/jest** — erli has `tsconfig.json` + `tsconfig.spec.json`; a new `__tests__/*.spec.ts` is auto-discovered. `pnpm --filter @openlinker/integrations-erli test` is the correct command (package name confirmed `@openlinker/integrations-erli`).
- **NestJS wiring** — plain per-connection class, never `@Injectable`; erli stays on `createNestAdapterModule` (skeleton module comment already anticipates exactly this). Aligned with Allegro/DPD.

---

## Open questions (non-blocking)

1. **Erli base-URL path prefix** — the plan leaves the exact prod path (`https://erli.pl/svc/shop-api`?) "to be confirmed against docs during implementation." The client is URL-agnostic (takes `baseUrl` via constructor), so this does not block #981; it surfaces in #982 (connection config). No gate impact.
2. **D2 keep-alive reviewer sign-off** — the plan defers a literal keep-alive unit test (runtime-provided), requiring #981-PR reviewer acknowledgement. Process item, not a code-readiness blocker.
3. **D4 classifier registration** — correctly deferred to #984/#993; the exception taxonomy shipped here is the input. No #981 blocker.

---

## Bottom line

One concrete fix required before implementation: **do not export the `ErliHttpClient` class/interface from the barrel** — export only the exceptions, matching every sibling. The plan's justification for exporting the class is factually wrong (no sibling does this). Once that bullet is corrected, the plan is implementable as-is against a clean slate with zero reuse collisions and zero contract breaks.
