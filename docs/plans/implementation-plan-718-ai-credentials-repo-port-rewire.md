# Implementation Plan — Rewire ai callers through ICredentialsService (#718, slice 4 of 4 — final)

**Issue**: [#718 — Rewire cross-context repository-port couplings through service interfaces](https://github.com/SilkSoftwareHouse/openlinker/issues/718)
**Slice**: 4 of 4 — `ai` → `integrations.IntegrationCredentialRepositoryPort` callers.
**Branch**: `718-ai-credentials-repo-port-rewire`
**Drops**: the final 4 core-scope `(file, symbol)` allow-list entries (83 → 79 remaining; the 79 left over are all plugin + apps scope tracked separately by #722).
**Closes**: #718.

---

## 0. Goal

Eliminate the four cross-context value-imports of `integrations`-owned `IntegrationCredentialRepositoryPort` from the `ai` context. After this PR:

- `libs/core/src/ai/application/services/ai-provider-key.service.ts` no longer imports `IntegrationCredentialRepositoryPort` — it calls a new `ICredentialsService` instead.
- `libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts` — same.
- Both consumer specs swap their mocks accordingly.
- 4 entries drop from the allow-list, closing the core-scope half of #718.
- After this merges, **#718's core-scope tracking is fully cleared** — only the plugin + apps scope remains, tracked by #722.

**Non-goals**:
- Removing `IntegrationCredentialRepositoryPort` from `@openlinker/core/integrations`'s public surface. The port stays on the barrel for now (matches the slice 1/2/3 precedent — the rewire targets call sites, not the export surface).
- The plugin + apps scope (#722) — separate sequence.

---

## 1. Naming decision — `ICredentialsService`

The issue body and the allow-list comment both name the rewire target `ICredentialsService`. This matches:

1. **The codebase precedent for service naming**: `I{Purpose}Service` (engineering-standards.md § Class Names). "Credentials" is the purpose.
2. **Disambiguation with the existing `CredentialsResolverPort`**: that port already exists in the integrations context as `CREDENTIALS_RESOLVER_TOKEN` and serves a different need (resolves credentials by ref for adapter bootstrap — owns its own caching). `ICredentialsService` is a cross-context *seam* over the repository CRUD, not a resolver.
3. **Slice 3's narrow-service precedent**: `IOfferMappingsService` is a thin pass-through over a single repository port — same shape applies here. Could call this `IIntegrationCredentialsService` but "credentials" is unambiguous within the integrations context, and shorter reads better at call sites.

Decision: **`ICredentialsService`** (singular, full CRUD surface — mirrors the underlying repository port one-for-one because the application logic in the AI callers already encodes the upsert / not-found / cache-invalidation branching, which is the right layer for that logic to live).

---

## 2. Architecture mapping

| Layer | What lands here |
|---|---|
| **CORE — Integrations application** | New `ICredentialsService` interface + `CredentialsService` impl (pass-through over `IntegrationCredentialRepositoryPort`). |
| **CORE — Integrations tokens** | New `CREDENTIALS_SERVICE_TOKEN` Symbol in `integrations.tokens.ts`. |
| **CORE — Integrations barrel** | `@openlinker/core/integrations` re-exports the interface (token auto-exported via `export *`). |
| **CORE — Integrations module** | `IntegrationsModule` registers the concrete service + token binding, exports both. |
| **CORE — AI application** | `ai-provider-key.service.ts` swaps `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN` for `CREDENTIALS_SERVICE_TOKEN`. |
| **CORE — AI infrastructure** | `credentials-ai-provider.adapter.ts` — same swap. |
| **Lint** | Drop 4 entries from the allow-list. |

**Note on the adapter going through a service**: `credentials-ai-provider.adapter.ts` is infrastructure-layer code that reaches into another context for credential storage. Routing it through `ICredentialsService` is consistent with the cross-context coupling policy (#713) — the rule is about the *cross-context boundary*, not the *layer of the caller*. Same-context infrastructure code keeps using its own repository ports directly; cross-context infrastructure code goes through the service-interface seam, just like cross-context application code.

---

## 3. New service: ICredentialsService

### 3.1 Interface

`libs/core/src/integrations/application/interfaces/credentials.service.interface.ts`

Mirrors the underlying `IntegrationCredentialRepositoryPort` shape one-for-one. The four methods are exactly what both AI callers consume — no method-level reshaping, no premature higher-level abstraction (e.g., no `upsertKey` that hides the create-vs-update branch, because that branch is application-level intent owned by the caller).

```ts
import type {
  CredentialCreate,
  CredentialUpdate,
} from '../../domain/ports/integration-credential-repository.port';
import type { IntegrationCredential } from '../../domain/entities/integration-credential.entity';

export interface ICredentialsService {
  /** Get credential by reference. Throws `CredentialNotFoundException` if absent. */
  getByRef(ref: string): Promise<IntegrationCredential>;

  /** Create a new credential. Plaintext at this layer; underlying repository encrypts. */
  create(payload: CredentialCreate): Promise<IntegrationCredential>;

  /** Update an existing credential. Throws `CredentialNotFoundException` if absent. */
  update(ref: string, patch: CredentialUpdate): Promise<IntegrationCredential>;

  /** Delete a credential by reference. Returns `true` if deleted, `false` if absent. */
  delete(ref: string): Promise<boolean>;
}
```

Re-uses the existing `CredentialCreate` / `CredentialUpdate` payload types from the repository port file — these are pure domain types (no infrastructure leak) and already shared between the repository port and the repository implementation. Importing them from the port keeps the slice tight.

### 3.2 Implementation

`libs/core/src/integrations/application/services/credentials.service.ts`

```ts
@Injectable()
export class CredentialsService implements ICredentialsService {
  constructor(
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly repository: IntegrationCredentialRepositoryPort,
  ) {}

  getByRef(ref: string): Promise<IntegrationCredential> {
    return this.repository.getByRef(ref);
  }

  create(payload: CredentialCreate): Promise<IntegrationCredential> {
    return this.repository.create(payload);
  }

  update(ref: string, patch: CredentialUpdate): Promise<IntegrationCredential> {
    return this.repository.update(ref, patch);
  }

  delete(ref: string): Promise<boolean> {
    return this.repository.delete(ref);
  }
}
```

Pure pass-through; no logger, no metrics — same minimal shape as `OfferMappingsService` (slice 3). No empty-input short-circuits needed; the methods take scalar / object args, not lists.

---

## 4. Tokens + barrel + module

### 4.1 `libs/core/src/integrations/integrations.tokens.ts`

Add:

```ts
export const CREDENTIALS_SERVICE_TOKEN = Symbol('ICredentialsService');
```

Auto-exported via the existing `export *` in `integrations/index.ts`.

**Naming note**: `engineering-standards.md § Symbol DI Token Re-export Convention` rule 5 strictly prescribes `{CONTEXT}_{INTERFACE}_TOKEN` — which would be `INTEGRATIONS_CREDENTIALS_SERVICE_TOKEN`. The existing integrations-context tokens are inconsistent on this: `INTEGRATIONS_SERVICE_TOKEN` / `WEBHOOK_SECRET_SERVICE_TOKEN` follow the rule, while `CREDENTIALS_RESOLVER_TOKEN`, `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN`, `ADAPTER_REGISTRY_TOKEN` don't. Picking `CREDENTIALS_SERVICE_TOKEN` matches the `CREDENTIALS_RESOLVER_TOKEN` precedent in the same file (same "credentials" stem) and keeps the call sites short. A future tightening pass can normalize the whole file; doing it inside #718 is out-of-scope churn.

### 4.2 Barrel re-export (interface)

`libs/core/src/integrations/index.ts` — add one type-only re-export next to the existing `IIntegrationsService` export:

```ts
export type { ICredentialsService } from './application/interfaces/credentials.service.interface';
```

### 4.3 `IntegrationsModule`

Register the concrete + token binding alongside `IntegrationsService`. No barrel-purity guard issue here — the integrations context doesn't have the split-barrel structure that listings does (no `services/` sub-barrel). The concrete class is unambiguously a same-context import; the new token + interface is what crosses contexts.

---

## 5. Consumer rewires

### 5.1 `ai-provider-key.service.ts`

- Drop `IntegrationCredentialRepositoryPort` + `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN` imports.
- Add `ICredentialsService` + `CREDENTIALS_SERVICE_TOKEN` imports (both from `@openlinker/core/integrations`).
- Constructor: `@Inject(CREDENTIALS_SERVICE_TOKEN) private readonly credentials: ICredentialsService` (rename the field from `credentialRepository` → `credentials` — clearer at call sites).
- Call sites — three of them — adjust the receiver name:
  - `this.credentialRepository.update(ref, {...})` → `this.credentials.update(ref, {...})`
  - `this.credentialRepository.create({...})` → `this.credentials.create({...})`
  - `this.credentialRepository.delete(ref)` → `this.credentials.delete(ref)`
- Keep the `CredentialNotFoundException` catch — it's a domain exception, still raised the same way by the underlying repository through the pass-through.

### 5.2 `credentials-ai-provider.adapter.ts`

- Drop `IntegrationCredentialRepositoryPort` + `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN` imports.
- Add `ICredentialsService` + `CREDENTIALS_SERVICE_TOKEN` imports.
- Constructor: `@Inject(CREDENTIALS_SERVICE_TOKEN) private readonly credentials: ICredentialsService` (rename `credentialRepository` → `credentials`).
- Single call site at `tryLoadFromDb`: `this.credentialRepository.getByRef(ref)` → `this.credentials.getByRef(ref)`.
- Keep the `CredentialNotFoundException` catch — same shape, same source.

---

## 6. Spec rewires

| Spec | Mock surface |
|---|---|
| `ai-provider-key.service.spec.ts` | `Pick<ICredentialsService, 'create' \| 'update' \| 'delete'>` — `getByRef` not called by this service. |
| `credentials-ai-provider.adapter.spec.ts` | `Pick<ICredentialsService, 'getByRef'>` — only method the adapter uses. |

Both specs:
- Keep `IntegrationCredential` + `CredentialNotFoundException` imports from `@openlinker/core/integrations` — those are domain entity / exception, allowed cross-context per the policy.
- Drop the full `IntegrationCredentialRepositoryPort` mock; replace with narrow `Pick<ICredentialsService, …>`.
- Constructor sites get `as unknown as ICredentialsService` casts — slice 3 pattern.
- Test assertions change one-for-one: `repository.update.toHaveBeenCalled` → `credentials.update.toHaveBeenCalled`, etc. The wire-level shapes (`{ ref, platformType, credentialsJson }`, etc.) are identical because the service is pure pass-through.

---

## 7. New service unit tests

`libs/core/src/integrations/application/services/__tests__/credentials.service.spec.ts`:

Four tests, one per method, each verifying:
1. The service forwards positional args verbatim to the repository.
2. The return value is passed through verbatim (same `IntegrationCredential` reference / boolean / etc.).

| Method | Test |
|---|---|
| `getByRef` | Forwards `ref` to `repository.getByRef`, returns the entity verbatim. |
| `create` | Forwards `payload` to `repository.create`, returns the entity verbatim. |
| `update` | Forwards `(ref, patch)` to `repository.update`, returns the entity verbatim. |
| `delete` | Forwards `ref` to `repository.delete`, returns the boolean verbatim. |

Single shared `buildRepoMock()` helper. Same shape as `offer-mappings.service.spec.ts` (slice 3).

---

## 8. Allow-list cleanup

Remove these four entries from `scripts/check-cross-context-imports.mjs`:

```
'libs/core/src/ai/application/services/ai-provider-key.service.ts'                  → 'IntegrationCredentialRepositoryPort'
'libs/core/src/ai/application/services/ai-provider-key.service.spec.ts'             → 'IntegrationCredentialRepositoryPort'
'libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts'       → 'IntegrationCredentialRepositoryPort'
'libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.spec.ts'  → 'IntegrationCredentialRepositoryPort'
```

After this: 83 → 79 entries (all 79 remaining are plugin + apps scope, tracked by #722).

Replace with a final comment block noting the core-scope is now fully clear, matching the slice 1/2/3 comment style.

---

## 9. Acceptance criteria

- [ ] Both AI consumer files no longer import `IntegrationCredentialRepositoryPort` or `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN`.
- [ ] Both consumer specs mock `ICredentialsService` (via `Pick`) instead of the repository port.
- [ ] `ICredentialsService` + `CREDENTIALS_SERVICE_TOKEN` exist and are exported from `@openlinker/core/integrations`.
- [ ] `CredentialsService` is registered in `IntegrationsModule` and bound via `useExisting`.
- [ ] Allow-list drops the 4 entries listed in §8 (87 → 83 → 79 across slices 3 and 4).
- [ ] `pnpm check:invariants`, `pnpm lint`, `pnpm type-check`, `pnpm test` all green.
- [ ] PR body includes `Closes #718`.

---

## 10. Risks & open questions

- **Adapter going through a cross-context service**: noted in §2 — architecturally correct per the cross-context coupling policy. The alternative (keep the adapter on the repository port and only rewire the application service) would leave a deny-pattern allow-list entry behind and miss the point of #718. Going through the service is the right call.
- **Field rename `credentialRepository` → `credentials`**: internal to the SUT class; specs don't assert against SUT field names, they assert against local mock variables. No spec-shape changes beyond renaming the local `repository` → `credentials` variable in the two consumer specs.
- **No spec for `IntegrationCredential` entity construction shape changes**: none expected. The service returns whatever the repository returns; no transformation, no entity shape change.

---

## 11. After this PR

- #718 closes. Core-scope cross-context repository-port couplings: all 20 original entries rewired across slices 1–4.
- Plugin + apps scope (~64 entries originally) tracked by #722 — separate follow-up sequence, not affected by this slice.
