# Implementation Plan — #585 Customer Email Normalizer Strategy

**Issue:** [#585 — [E5] [HIGH] CustomerIdentityResolverService hardcodes 'allegro' for email normalization](https://github.com/openlinker-project/openlinker/issues/585)

**Branch:** `585-customer-email-normalizer-strategy`

## 1. Goal

`CustomerIdentityResolverService` (CORE) calls `normalizeEmail(email, 'allegro')` and `hashEmail(email, 'allegro')` directly, and the Allegro masked-email rule (`fixedPart+transactionId@allegromail.*` → `fixedPart@allegromail.*`) lives inside `libs/shared/src/config/pii-hashing.ts`. Both leak Allegro semantics into platform-agnostic packages.

Replace this with a per-adapter `EmailNormalizerPort` registry, mirroring the recently-landed `WebhookProvisioningRegistryService` (#583) and `ConnectionTesterRegistryService`. Each integration package self-registers its normalizer at boot; CORE stays platform-agnostic; the shared baseline becomes a pure `trim+lowercase`.

**Layer:** CORE refactor + Integration relocation. No DB schema, no API surface, no FE changes.

**Non-goals:**
- Reworking `OrderSourcePort` to carry normalization (the issue text allows either; the registry pattern is more orthogonal).
- Touching `hashAddress` / `normalizeAddress` (no platform branching today).
- Adding new capability to `CoreCapabilityValues` — `EmailNormalizerPort` is registered by `adapterKey` like webhook provisioning, not as a connection-level capability.

## 2. Existing patterns to mirror

- **`WebhookProvisioningRegistryService`** (`libs/core/src/integrations/infrastructure/adapters/webhook-provisioning-registry.service.ts`) — `Map<adapterKey, port>` with `register/get/has`. Integration modules self-register in `onModuleInit`. Token in `integrations.tokens.ts`. Wired in `IntegrationsModule`.
- **`ConnectionTesterRegistryService`** — same shape; same precedent.
- **`AllegroIntegrationModule.onModuleInit`** — already registers metadata, factory, connection tester. One more `registry.register(adapterKey, adapter)` call fits naturally.

## 3. Design

### 3.1 Port (CORE)

```typescript
// libs/core/src/integrations/domain/ports/email-normalizer.port.ts
export interface EmailNormalizerPort {
  /**
   * Return the platform-stable form of an email used for identity hashing.
   * Default semantics: trim + lowercase. Marketplaces with masked-email
   * formats (e.g. Allegro `+transactionId` suffix) override.
   */
  normalize(email: string): string;
}
```

### 3.2 Default normalizer (CORE)

```typescript
// libs/core/src/integrations/infrastructure/adapters/default-email-normalizer.ts
import { normalizeEmail } from '@openlinker/shared/config';
import { EmailNormalizerPort } from '../../domain/ports/email-normalizer.port';

export const DEFAULT_EMAIL_NORMALIZER: EmailNormalizerPort = {
  normalize(email) {
    return normalizeEmail(email); // shared baseline: trim+lowercase
  },
};
```

### 3.3 Registry (CORE)

```typescript
// libs/core/src/integrations/infrastructure/adapters/email-normalizer-registry.service.ts
@Injectable()
export class EmailNormalizerRegistryService {
  private readonly normalizers = new Map<string, EmailNormalizerPort>();

  register(adapterKey: string, normalizer: EmailNormalizerPort): void {
    this.normalizers.set(adapterKey, normalizer);
  }
  get(adapterKey: string): EmailNormalizerPort | undefined {
    return this.normalizers.get(adapterKey);
  }
  has(adapterKey: string): boolean {
    return this.normalizers.has(adapterKey);
  }
  /** Lookup with fallback to the trim+lowercase baseline. */
  resolve(adapterKey: string): EmailNormalizerPort {
    return this.normalizers.get(adapterKey) ?? DEFAULT_EMAIL_NORMALIZER;
  }
}
```

### 3.4 Token + module wiring (CORE)

- Add `EMAIL_NORMALIZER_REGISTRY_TOKEN = Symbol('EmailNormalizerRegistryService')` to `libs/core/src/integrations/integrations.tokens.ts`.
- Register provider + `useExisting` token binding in `IntegrationsModule`. Export both.
- Re-export `EmailNormalizerPort`, `EmailNormalizerRegistryService`, and the token from `libs/core/src/integrations/index.ts`.

### 3.5 Allegro adapter (libs/integrations/allegro)

```typescript
// libs/integrations/allegro/src/infrastructure/adapters/allegro-email-normalizer.adapter.ts
import { EmailNormalizerPort } from '@openlinker/core/integrations';
import { normalizeEmail } from '@openlinker/shared/config';

export class AllegroEmailNormalizerAdapter implements EmailNormalizerPort {
  normalize(email: string): string {
    const baseline = normalizeEmail(email);
    if (!baseline || !baseline.includes('@allegromail.')) return baseline;
    const [local, domain] = baseline.split('@');
    if (!local?.includes('+')) return baseline;
    return `${local.split('+')[0]}@${domain}`;
  }
}
```

Self-register in `AllegroIntegrationModule.onModuleInit()`:

```typescript
this.emailNormalizerRegistry.register(
  'allegro.publicapi.v1',
  new AllegroEmailNormalizerAdapter(),
);
```

### 3.6 Strip platform branching from shared (libs/shared)

`libs/shared/src/config/pii-hashing.ts`:
- Drop the `@allegromail.` branch from `normalizeEmail` (the whole point of the issue — platform-specific logic must not live in `@openlinker/shared`).
- **Keep** the optional `source?: string` parameter on both `normalizeEmail` and `hashEmail` as a deprecated, ignored no-op shim. Mark with `@deprecated` JSDoc pointing at `EmailNormalizerPort`. Rationale: `@openlinker/shared` is now a peerDep (#588) and `@openlinker/core/shared` has no semver discipline yet (#596 still open) — a breaking signature change to a public shared utility is more disruptive than the carrying cost of a one-parameter shim. The shim costs a single ignored argument; the breaking change risks silent type errors in any external consumer or test that ever passed `source`.

The PrestaShop adapter's `hashEmail(normalizedEmail)` call (single-arg, already normalized) is unaffected.

### 3.7 Resolver update (libs/core/src/customers)

`CustomerIdentityResolverService`:
- Inject `EmailNormalizerRegistryService` and `IIntegrationsService` (via `INTEGRATIONS_SERVICE_TOKEN`). `ConnectionPort` stays accessible through the same chain — but the resolver consumes the canonical dispatch helper, not the lower-level building blocks.
- Add private helper:
  ```typescript
  private async resolveEmailNormalizer(connectionId: string): Promise<EmailNormalizerPort> {
    const connection = await this.connectionPort.get(connectionId);
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });
    return this.emailNormalizerRegistry.resolve(metadata.adapterKey);
  }
  ```
  Mirrors the dispatch pattern documented in architecture-overview.md §10 ("Webhook provisioning") — the same two-step `connectionPort.get → integrationsService.resolveAdapterMetadata` flow `ConnectionService.installWebhooks` uses. `resolveAdapterMetadata` does **not** throw on disabled connections (only `getAdapter`/`getCapabilityAdapter` do), so a customer arriving from a now-disabled connection still resolves correctly.

  *Why not call `getAdapter()`?* It validates connection status (throws `ConnectionDisabledException` on disabled) and resolves the full adapter instance — heavy and wrong-shaped for a normalizer lookup that must succeed for customers from any connection state.
- Replace both call sites:
  ```typescript
  const normalizer = await this.resolveEmailNormalizer(sourceConnectionId);
  const normalizedEmail = normalizer.normalize(email);
  const emailHash = hashEmail(normalizedEmail);
  ```

`CustomersModule`:
- Add `IntegrationsModule` to imports (for `EMAIL_NORMALIZER_REGISTRY_TOKEN` and `INTEGRATIONS_SERVICE_TOKEN`). `ConnectionPort` is already available via `IdentifierMappingModule`. No circular dependency: `IntegrationsModule` does **not** import `CustomersModule` (verified).

### 3.8 Test updates

- New unit spec for `EmailNormalizerRegistryService` (mirrors `webhook-provisioning-registry.service.spec.ts`): register / get / has / resolve-fallback / **silent overwrite on duplicate `adapterKey`** (consistency with sister registries).
- New unit spec for `AllegroEmailNormalizerAdapter`: covers `+transactionId` strip, non-allegro pass-through, empty-string, `+` outside `@allegromail.*` domain pass-through.
- Update `customer-identity-resolver.service.spec.ts`:
  - Mock `EmailNormalizerRegistryService`, `ConnectionPort`, and `IIntegrationsService` (only the `resolveAdapterMetadata` method needs a stub).
  - The "Allegro masked email normalization" describe-block keeps its assertion but the mock registry returns `AllegroEmailNormalizerAdapter` for the resolved adapterKey.
  - Add a test: when the registry returns the default normalizer (no adapter registered), masked-email is **not** stripped (proves CORE no longer carries Allegro semantics).
- Integration-test smoke: after wiring lands, run `pnpm test:integration --testPathPattern=app-boot` to verify the new DI dependencies compose correctly through `PluginRegistryModule` → `AllegroIntegrationModule.onModuleInit` (the registration only fires when the integration module is actually loaded; a missed import would only surface in prod otherwise).
- Update `pii-hashing.ts` tests if any exist (grep — likely covered indirectly).

## 4. Step-by-step

| # | File | What | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/integrations/domain/ports/email-normalizer.port.ts` | New port interface + JSDoc | Compiles; only-interface file |
| 2 | `libs/core/src/integrations/infrastructure/adapters/default-email-normalizer.ts` | Default normalizer constant | Pure trim+lowercase via shared baseline |
| 3 | `libs/core/src/integrations/infrastructure/adapters/email-normalizer-registry.service.ts` | `EmailNormalizerRegistryService` (Map + resolve fallback) | Mirrors webhook-provisioning shape |
| 4 | `libs/core/src/integrations/integrations.tokens.ts` | Add `EMAIL_NORMALIZER_REGISTRY_TOKEN` | Symbol token added + re-exported |
| 5 | `libs/core/src/integrations/integrations.module.ts` | Provider + token binding + export | Bootable, registered, exported |
| 6 | `libs/core/src/integrations/index.ts` | Re-export port, registry, token | Surface available to consumers |
| 7 | `libs/core/src/integrations/infrastructure/adapters/__tests__/email-normalizer-registry.service.spec.ts` | Unit spec | register/get/has/resolve-default green |
| 8 | `libs/shared/src/config/pii-hashing.ts` | Drop `_source` and Allegro branch from `normalizeEmail`; drop optional `source` from `hashEmail` | trim+lowercase only; signature simplified |
| 9 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-email-normalizer.adapter.ts` | New adapter | Implements `EmailNormalizerPort` |
| 10 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-email-normalizer.adapter.spec.ts` | Unit spec | masked-email + pass-through cases |
| 11 | `libs/integrations/allegro/src/allegro-integration.module.ts` | Inject registry; register adapter in `onModuleInit` | Boot log shows registration |
| 12 | `libs/core/src/customers/customers.module.ts` | Import `IntegrationsModule` | Compiles; no circular dep |
| 13 | `libs/core/src/customers/application/services/customer-identity-resolver.service.ts` | Inject registry+ConnectionPort+AdapterRegistryPort; helper; replace both call sites | No more `'allegro'` literals; tests pass |
| 14 | `libs/core/src/customers/application/services/customer-identity-resolver.service.spec.ts` | Add registry/connection/adapterRegistry mocks; update existing masked-email test; add default-normalizer test | All paths green |

## 5. Validation against architecture rules

- **Hexagonal layering**: port lives in `domain/`, registry + adapters in `infrastructure/`, resolver in `application/`. ✅
- **Domain has no framework deps**: port is plain interface. ✅
- **No `any`**: all types explicit. ✅
- **No `console.log`**: existing logger continues. ✅
- **Symbol DI tokens**: yes, mirrors precedent. ✅
- **Tests mock ports, not concrete adapters**: yes, registry is mocked in resolver spec; default normalizer fallback proven via direct test. ✅
- **No DB / migration changes**: confirmed. ✅
- **CORE/Integration boundary**: Allegro masked-email logic moves OUT of CORE and OUT of `libs/shared`, into `libs/integrations/allegro`. ✅

## 6. Risks / open questions

- **Heavier resolver constructor** — three new injections. Acceptable; mirrors `ConnectionService.installWebhooks`'s constructor weight.
- **`ConnectionPort.get(disabled)` behaviour** — assumed to return the connection without throwing; verified at call sites in `IntegrationsService.getAdapter` (the disabled-throw is downstream). If `ConnectionPort.get` itself throws on disabled, we'd hit it for customer resolution from disabled connections — will spot-check during implementation.
- **Future shape**: if more Allegro-specific identity rules emerge (phone normalization, etc.), the same registry pattern can be extended with sibling ports without changes here.

## 7. Quality gate

```
pnpm lint && pnpm type-check && pnpm test
```

No migrations needed.
