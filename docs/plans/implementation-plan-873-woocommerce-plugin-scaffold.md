# Implementation Plan: WooCommerce Plugin Scaffold (#873)

**Date**: 2026-05-29
**Status**: Ready for implementation
**Estimated Effort**: S (1–3 days)

---

## 1. Task Summary

**Objective**: Stand up `libs/integrations/woocommerce` as the plugin foundation for the WooCommerce integration. Covers User Story #1 in the product spec (operator connects a WC shop to OL). This is the first of 6 capability issues (#874–#879) — every downstream WC issue is blocked on this.

**Context**: Issue #873 (part of WooCommerce integration epic #872). WooCommerce uses REST API v3 with Basic Auth (consumer key + consumer secret generated in WP Admin). No OAuth, no webhooks at v1 (REST polling only).

**Classification**: Integration (new package `libs/integrations/woocommerce`) + API/Worker registration.

---

## 2. Scope & Non-Goals

### In Scope
- New package `libs/integrations/woocommerce` (`@openlinker/integrations-woocommerce`)
- Connection config types: `{ siteUrl: string }`
- Credentials types: `{ consumerKey: string; consumerSecret: string }`
- Config shape validator (validates `siteUrl` is a URL) — class-validator DTO with `@IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })` — rejects protocol-less input like `myshop.com` at save-time rather than surfacing a cryptic fetch error at test-time
- Credentials shape validator (validates `consumerKey` + `consumerSecret` non-empty) — inline checks, no DTO (matches PrestaShop/Allegro/InPost precedent)
- Minimal fetch-based Basic Auth HTTP client (constructor accepts `RetryConfig` with `maxRetries: 0` for the tester probe, expandable for capability adapters in #874+); `RetryConfig` extracted to `woocommerce-http-client.types.ts` (not inline in the client file — avoids violating the "types in separate files" rule)
- Connection tester: `GET {siteUrl}/wp-json/wc/v3/products?per_page=1` — minimal scope, requires `products:read` (the same key scope needed by #874)
- Static manifest: `adapterKey: 'woocommerce.restapi.v3'`, `platformType: 'woocommerce'`, `supportedCapabilities: []`, `isDefault: true`
- Plugin descriptor (`createWooCommercePlugin`) + `WooCommerceIntegrationModule` via `createNestAdapterModule`
- Registration in `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`
- Unit tests: connection tester (success, 401, network error), config validator (valid, missing siteUrl, invalid URL), credentials validator (valid, missing key, missing secret)
- `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/worker/package.json`, `apps/worker/tsconfig.json` updated with new package dep + path aliases

### Out of Scope (explicit)
- Any capability adapter (ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager) — #874–#879
- Webhook provisioning — REST polling only at v1
- HPOS-disabled-store handling — HPOS-only at v1
- FE plugin (`apps/web/src/plugins/woocommerce/`) — separate issue (analogue of #771 for InPost)
- Dockerized WC dev stack — #878

### Design Decision: probe endpoint
Use `GET /wp-json/wc/v3/products?per_page=1` instead of `system_status`.
- `system_status` requires `read_shop` scope — broader than needed, causes false negatives on minimal API keys
- `products?per_page=1` requires `products:read` — the same scope #874 will need; validates both auth AND the capability key scope in one probe
- WC version / HPOS status from the AC are FE display concerns read from `connection.config`, not from `ConnectionTestResult`; neither is auto-populated at v1

---

## 3. Reference Patterns

| What | Where |
|---|---|
| Simplest plugin (no NestJS providers) | `libs/integrations/inpost/src/inpost-plugin.ts` + `inpost-integration.module.ts` |
| Config shape validator pattern | `libs/integrations/inpost/src/infrastructure/adapters/inpost-connection-config-shape-validator.adapter.ts` |
| Credentials shape validator pattern | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-connection-credentials-shape-validator.adapter.ts` |
| Connection tester pattern | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-connection-tester.adapter.ts` |
| fetch-based HTTP client pattern | `libs/integrations/inpost/src/infrastructure/http/inpost-http-client.ts` |
| Package config template | `libs/integrations/inpost/package.json`, `tsconfig.json`, `tsconfig.spec.json`, `jest.config.mjs` |
| Plugin registration (API) | `apps/api/src/plugins.ts` |
| Plugin registration (Worker) | `apps/worker/src/plugins.ts` |

---

## 4. File Plan

### New files (19)

```
libs/integrations/woocommerce/
├── package.json
├── tsconfig.json
├── tsconfig.spec.json
├── jest.config.mjs                                            # includes @openlinker/plugin-sdk mapper (see §5)
└── src/
    ├── index.ts                                               # barrel
    ├── woocommerce-plugin.ts                                  # plugin descriptor + static manifest
    ├── woocommerce-integration.module.ts                      # createNestAdapterModule wrapper
    ├── __tests__/
    │   └── woocommerce-plugin.spec.ts                         # manifest shape + register() wiring + unsupported-capability path
    ├── domain/
    │   └── types/
    │       ├── woocommerce-config.types.ts                    # WooCommerceConnectionConfig
    │       └── woocommerce-credentials.types.ts               # WooCommerceCredentials
    ├── application/
    │   └── dto/
    │       └── woocommerce-connection-config.dto.ts           # class-validator DTO (config only)
    └── infrastructure/
        ├── http/
        │   ├── woocommerce-http-client.ts                     # fetch-based Basic Auth client
        │   ├── woocommerce-http-client.types.ts               # RetryConfig (extracted — not inline)
        │   └── __tests__/
        │       └── woocommerce-http-client.spec.ts            # authHeader + siteUrl normalization
        └── adapters/
            ├── woocommerce-connection-tester.adapter.ts
            ├── woocommerce-connection-config-shape-validator.adapter.ts
            ├── woocommerce-connection-credentials-shape-validator.adapter.ts
            └── __tests__/
                ├── woocommerce-connection-tester.adapter.spec.ts
                ├── woocommerce-connection-config-shape-validator.adapter.spec.ts
                └── woocommerce-connection-credentials-shape-validator.adapter.spec.ts
```

### Modified files (6)

| File | Change |
|---|---|
| `apps/api/package.json` | Add `"@openlinker/integrations-woocommerce": "workspace:*"` to dependencies |
| `apps/api/tsconfig.json` | Add `@openlinker/integrations-woocommerce` path alias (2 lines) |
| `apps/worker/package.json` | Add `"@openlinker/integrations-woocommerce": "workspace:*"` to dependencies |
| `apps/worker/tsconfig.json` | Add `@openlinker/integrations-woocommerce` path alias (2 lines) |
| `apps/api/src/plugins.ts` | Import + append `WooCommerceIntegrationModule` |
| `apps/worker/src/plugins.ts` | Import + append `WooCommerceIntegrationModule` |

---

## 5. Key Implementation Details

### Barrel exports (`src/index.ts`)
```typescript
// Types — exported so #874+ adapters can import via barrel, not deep paths
export type { WooCommerceConnectionConfig } from './domain/types/woocommerce-config.types';
export type { WooCommerceCredentials } from './domain/types/woocommerce-credentials.types';

// Plugin descriptor + static manifest (#575)
export { woocommerceAdapterManifest, createWooCommercePlugin } from './woocommerce-plugin';

// Host wiring
export { WooCommerceIntegrationModule } from './woocommerce-integration.module';

// No domain exceptions at scaffold stage — added in #874 when typed HTTP errors land
```

### Manifest
```typescript
export const woocommerceAdapterManifest: AdapterMetadata = {
  adapterKey: 'woocommerce.restapi.v3',
  platformType: 'woocommerce',
  supportedCapabilities: [],   // populated by #874–#879
  displayName: 'WooCommerce REST API v3',
  version: '1.0.0',
  isDefault: true,
};
```

### Connection config type
```typescript
// domain/types/woocommerce-config.types.ts
export interface WooCommerceConnectionConfig {
  // Must include protocol (http:// or https://).
  // Validated at save-time: @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  // Trailing slash is stripped by WooCommerceHttpClient before use.
  // HTTP is accepted but HTTPS is strongly recommended — WC REST transmits
  // consumerKey:consumerSecret on every request (Basic Auth = cleartext over HTTP).
  // HTTPS enforcement is intentionally left to the FE form layer, consistent
  // with Allegro and InPost validators which also don't enforce it.
  siteUrl: string;
}
```

### Credentials type
```typescript
// domain/types/woocommerce-credentials.types.ts
export interface WooCommerceCredentials {
  consumerKey: string;     // ck_...
  consumerSecret: string;  // cs_...
}
```

### HTTP client constructor

`RetryConfig` lives in `infrastructure/http/woocommerce-http-client.types.ts` (not inline),
per the "types in separate files" rule.

```typescript
// infrastructure/http/woocommerce-http-client.types.ts
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}
```

```typescript
// infrastructure/http/woocommerce-http-client.ts
export class WooCommerceHttpClient {
  constructor(
    private readonly siteUrl: string,   // trailing slash stripped in constructor
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    retryConfig?: Partial<RetryConfig>,
  ) {
    // Normalize: strip trailing slash so path construction is always safe.
    // "https://myshop.com/" and "https://myshop.com" both work identically.
    this.siteUrl = siteUrl.replace(/\/+$/, '');
    ...
  }

  private get authHeader(): string {
    // Use Buffer (Node.js) — not btoa() which is browser-only in older runtimes.
    return 'Basic ' + Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
  }
}
```

### Connection tester probe
```
GET {siteUrl}/wp-json/wc/v3/products?per_page=1
Authorization: Basic <base64(key:secret)>
```

The HTTP client normalizes `siteUrl` (trailing slash stripped) before constructing the URL.

| Response | Result |
|---|---|
| 200 | `success: true` |
| 401 / 403 | `success: false`, "WooCommerce authentication failed — check consumer key and secret" |
| 404 | `success: false`, "WooCommerce REST API not found — verify the site URL and that WooCommerce is installed" |
| 5xx | `success: false`, "WooCommerce returned an unexpected error (HTTP {status})" |
| Network error (fetch throws) | `success: false`, error message from caught error |

### createNestAdapterModule (mirrors InPost exactly)
```typescript
export const WooCommerceIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createWooCommercePlugin(),
});
```

### jest.config.mjs — required moduleNameMapper entries
Must include `@openlinker/plugin-sdk` (used by `woocommerce-plugin.ts`) and
`@openlinker/integrations-woocommerce` self-alias, matching InPost's pattern exactly:
```javascript
moduleNameMapper: {
  '^(\\.{1,2}/.*)\\.js$': '$1',
  '^@openlinker/integrations-woocommerce$': '<rootDir>/src/index.ts',
  '^@openlinker/integrations-woocommerce/(.*)$': '<rootDir>/src/$1',
  '^@openlinker/core/(.*)$': '<rootDir>/../../core/src/$1',
  '^@openlinker/shared/(.*)$': '<rootDir>/../../shared/src/$1',
  '^@openlinker/plugin-sdk$': '<rootDir>/../../plugin-sdk/src/index.ts',
},
```
Without the `plugin-sdk` mapper, any test file that transitively imports
`woocommerce-plugin.ts` → `createNestAdapterModule` will fail to resolve.

---

## 6. Testing Strategy

### Unit tests per adapter

**`woocommerce-plugin.spec.ts`**
- `should declare adapterKey as woocommerce.restapi.v3`
- `should declare supportedCapabilities as empty array`
- `should register connection tester with host on register(host)`
- `should register config shape validator with host on register(host)`
- `should register credentials shape validator with host on register(host)`
- `should throw unsupported capability error for any capability`

**`woocommerce-http-client.spec.ts`**
- `should generate correct Basic Auth header from consumerKey and consumerSecret`
- `should strip trailing slash from siteUrl in constructor`
- `should preserve siteUrl without trailing slash unchanged`
- `should make GET request to correct URL`

**`woocommerce-connection-tester.adapter.spec.ts`**
- `should return success when products endpoint responds 200`
- `should return success when siteUrl has a trailing slash`
- `should return failure with auth message when response is 401`
- `should return failure with auth message when response is 403`
- `should return failure with REST API not found when response is 404`
- `should return failure with unexpected error message when response is 500`
- `should return failure when fetch throws a network error`

**`woocommerce-connection-config-shape-validator.adapter.spec.ts`**
- `should pass when siteUrl is a valid URL`
- `should throw InvalidConnectionConfigException when siteUrl is missing`
- `should throw InvalidConnectionConfigException when siteUrl is not a URL`
- `should throw InvalidConnectionConfigException when siteUrl is an empty string`

**`woocommerce-connection-credentials-shape-validator.adapter.spec.ts`**
- `should pass when consumerKey and consumerSecret are present`
- `should throw InvalidCredentialsShapeException when consumerKey is missing`
- `should throw InvalidCredentialsShapeException when consumerSecret is missing`
- `should throw InvalidCredentialsShapeException when consumerKey is empty string`
- `should throw InvalidCredentialsShapeException when consumerSecret is empty string`

No integration tests in this issue — no Dockerized WC stack yet (#878 owns that).

---

## 7. Quality Gate

Before committing:
```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all unit tests pass (including new WC specs)
```

No migration needed — no ORM entities introduced.

---

## 8. Known Gaps (deferred)

| Gap | Tracked by |
|---|---|
| FE platform plugin (WC connection form, connection list display) | separate issue (analogue of #771) |
| Dockerized WC dev stack | #878 |
| WC version / HPOS auto-detection and storage in `connection.config` | deferred to FE plugin issue |
| Webhook provisioning | REST polling only at v1 per spec §4 |
| `docs/specs/product-spec-872-woocommerce-shop-integration.md` | separate task — referenced by issue #873 but not yet written |
| `docs/architecture-overview.md` WC capability listings | update in #874+ when capabilities land |
| Retry loop in `WooCommerceHttpClient.get()` | #874 — typed exceptions (WooCommerceUnauthorizedException etc.) land alongside |
