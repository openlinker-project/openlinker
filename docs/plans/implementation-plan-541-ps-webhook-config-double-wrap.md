# Implementation Plan — #541 PS webhook auto-provisioning double-wrap fix

## 1. Goal

Fix `PrestashopWebhookProvisioningService.upsertConfiguration` so the "Install
webhooks" action against a real PrestaShop shop succeeds end-to-end. Today
every call 400s because the WS payload is wrapped twice (`prestashop ›
configuration › configuration › { id, name, value }`).

Layer: **Integration** (PrestaShop adapter, application service).
Non-goals: multi-store retry-with-defaults (already a TODO at line 198), any
change to the WS client's wrapping behaviour, any change to other PS adapter
call sites (orders/carts/customers/addresses already pass flat payloads).

## 2. Root cause (verified)

- `prestashop-webhook-provisioning.service.ts:211-218` passes
  `{ configuration: { id, name, value } }` as the `data` argument.
- `prestashop-webservice.client.ts:217-221` (`writeResource`) already wraps
  `data` as `{ prestashop: { [resourceKey]: data } }` where
  `resourceKey = 'configuration'` (singularised from `configurations`).
- Net XML body: `<prestashop><configuration><configuration>…</configuration></configuration></prestashop>`.
- PS strips the outer `<prestashop>` wrapper, then sees a `<configuration>`
  child where it expects `<id>`, and rejects with HTTP 400 / error code 90:
  `"id is required when modifying a resource"`.

Every other adapter caller passes flat fields (e.g.
`createResource('orders', prestashopOrderData)` where `prestashopOrderData`
has flat `id_cart`, `id_customer`, etc.).

The unit spec at
`prestashop-webhook-provisioning.service.spec.ts:118-128` and `:152-167`
asserts the buggy shape (`body.configuration.name`), so green CI never caught
the bug.

## 3. Fix

### 3.1 Source code

`libs/integrations/prestashop/src/application/services/prestashop-webhook-provisioning.service.ts:209-218`

Replace:

```ts
if (existing.length > 0) {
  const id = existing[0].id;
  await wsClient.updateResource('configurations', id, {
    configuration: { id: String(id), name, value },
  });
  return;
}
await wsClient.createResource('configurations', {
  configuration: { name, value },
});
```

With:

```ts
if (existing.length > 0) {
  const id = existing[0].id;
  await wsClient.updateResource('configurations', id, {
    id: String(id),
    name,
    value,
  });
  return;
}
await wsClient.createResource('configurations', { name, value });
```

The `id: String(id)` on update is preserved because the PS WS PUT contract
(`prestashop-webservice.client.interface.ts:75-96`) requires it in the body —
PS validates body-id against the path-id.

### 3.2 Unit spec

`libs/integrations/prestashop/src/application/services/__tests__/prestashop-webhook-provisioning.service.spec.ts`

Two changes — both replace assertions on the wrong shape:

- `:118-128` (happy path) — `body.configuration.name` → `body.name`.
- `:158-167` (update path) — drop the nested `configuration:` matcher, assert
  flat `id`, `name`, `value` directly.

### 3.3 New integration test (regression guard)

`apps/api/test/integration/prestashop/prestashop-webhook-provisioning.int-spec.ts`

Suite-scoped (uses the heavy PS Testcontainer harness from #506 Phase 1).
Routes through the public `install()` method with stubbed ports — exercises
**the actual `upsertConfiguration` code path** (not just the WS client) so a
future re-introduction of the wrap or any other shape regression in the
service is caught at the int-spec layer too.

**Layered coverage:**
- Unit spec → asserts the service builds the **correct call shape** for
  `createResource` / `updateResource` (mocks the WS client).
- Int-spec → asserts the **end-to-end install flow** writes the expected
  rows into a real PS 9.0.2 `ps_configuration` table, with the real WS
  client speaking real XML to real PS.

Flow:

1. `beforeAll`: `startPrestashopContainer()` — boots PS + MySQL.
2. Construct stub ports:
   - `ConnectionPort.get()` → returns a `Connection` with
     `config.baseUrl = prestashop.baseUrl`,
     `config.openlinkerCallbackBaseUrl = 'http://test-callback.local'`.
   - `ConnectionPort.update()` → resolves (captures the
     `webhooksConfigured: true` patch for assertion).
   - `IWebhookSecretService.rotate()` → returns
     `{ secret: 'test-secret-541-<random>' }` (a fresh per-run secret).
   - `CredentialsResolverPort.get()` → returns
     `{ webserviceApiKey: prestashop.webserviceApiKey }`.
3. Instantiate `PrestashopWebhookProvisioningService` with the stubs and
   call `install('test-conn-541')`.
4. `it('writes the three OPENLINKER_* configurations into PS via upsertConfiguration')`:
   - `result.webhooksConfigured` is `true`.
   - `result.testPingTriggered` is `false` and
     `result.warning === 'ping-not-received'` (PS doesn't have the OL
     module installed in the harness, so the synchronous ping legitimately
     misses; the install's accept-and-surface policy returns the
     warning — exactly the partial-state path the service was designed to
     handle).
   - `connectionPort.update` called with
     `expect.objectContaining({ config: expect.objectContaining({ webhooksConfigured: true }) })`.
   - Read PS WS `/api/configurations?filter[name]=OPENLINKER_BASE_URL` (and
     the other two keys) directly via raw `fetch` + Basic-auth, assert all
     three rows exist with the expected values. **This is also the
     partial-body PUT proof** — `upsertConfiguration` sends only
     `{ id, name, value }` on update; if PS didn't accept that subset for
     `configurations`, the second `install()` call (step 5) would 400.
5. `it('UPDATE path: re-running install upserts existing rows in place')`:
   - Call `service.install('test-conn-541')` a second time. The first call
     created the rows; the second hits the list-by-name → `updateResource`
     branch in `upsertConfiguration`. Assert PS still returns exactly the
     same three rows (no duplicates, idempotent), and that the secret
     value updates to the new rotated secret.

Naming the keys with the canonical `OPENLINKER_*` prefix is intentional —
they're the production keys, and using anything else would mean the int-spec
isn't actually exercising what production writes. The PS Testcontainer
boots fresh per test run, so there's no cross-run collision.

### 3.4 Harness change — grant `configurations` to the test WS API key

`apps/api/test/integration/helpers/prestashop-fixture.helper.ts:55-70`

The existing `WS_RESOURCES` list (carrier-mapping focus) doesn't include
`configurations`. Add it. Justification: the webhook-provisioning service is
the only OL caller that touches `configurations`, and once the int-spec lands
the harness needs to support it. Existing carrier-mapping spec is unaffected.

## 4. Step-by-step

| # | File | Change | Acceptance |
|---|------|--------|------------|
| 1 | `prestashop-webhook-provisioning.service.ts:209-218` | Drop redundant `configuration:` wrapper at both call sites | Code passes flat `{ id, name, value }` and `{ name, value }` |
| 2 | `prestashop-webhook-provisioning.service.spec.ts:118-128` | Assert `body.name` (flat) | Test still passes after step 1 |
| 3 | `prestashop-webhook-provisioning.service.spec.ts:158-167` | Drop nested `configuration:` matcher | Test still passes after step 1 |
| 4 | `prestashop-fixture.helper.ts:55-70` | Add `'configurations'` to `WS_RESOURCES` | Smoke spec still passes; new int-spec can read/write configurations |
| 5 | `apps/api/test/integration/prestashop/prestashop-webhook-provisioning.int-spec.ts` (new) | End-to-end `install()` against real PS via stubbed ports; create + update paths via re-run | All three `OPENLINKER_*` rows present in PS after first call; idempotent on second call |
| 6 | `docs/testing-guide.md` (PrestaShop Testcontainer Pattern section) | One-line note that PS-Testcontainer int-specs live under `apps/api/test/integration/prestashop/` going forward | Documented placement convention |

## 5. Validation

- **Unit**: `pnpm test -- prestashop-webhook-provisioning` — both happy-path
  and update-path specs pass with flat assertions.
- **Lint + type-check**: `pnpm lint && pnpm type-check`.
- **Integration**: `pnpm test:integration -- prestashop-webhook-provisioning`
  — Docker required, ~60-90s warm cache.
- **Architecture**: no boundaries crossed. The change lives entirely in the
  PrestaShop integration package; no CORE port or interface changed.
- **Naming**: int-spec follows `*.int-spec.ts` convention.
- **Security**: no auth/credential surface change. Webhook secret rotation
  semantics unchanged.

## 6. Risks & open questions

- **Multi-store**: The TODO at `:198-202` flags that some PS 8.2+ multi-store
  hosts may need explicit `id_shop_group` / `id_shop` on the body. Out of
  scope for #541 — that's a separate failure mode not covered by either the
  unit or integration test today. Track when a multi-store user reports it.
- **Old offers**: rows with the mistakenly-shaped XML are already rejected
  pre-write, so there is no stale state to migrate. Re-running install is
  safe and idempotent (the existing comment at `:144` already promises this).
