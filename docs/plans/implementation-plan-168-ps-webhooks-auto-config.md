# Implementation Plan — #168 PrestaShop Webhooks Auto-Provisioning

## Goal

Eliminate the operator copy-paste flow for PS webhook configuration. Today an operator generates a webhook secret on OL, opens PS admin, pastes Base URL + Connection ID + Secret into the `openlinker` module's manual form. After this PR: operator clicks one button on the OL connection detail page; OL pushes config to PS via PS WebService (no browser-mediated handoff, no install token, no env-var pattern). A round-trip "test ping" confirms within ~2 seconds.

## Issue-body correction (worth flagging in the PR)

The original issue body assumes the OL backend looks up webhook secrets via the `OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__<connectionId>` env-var pattern and proposes moving them to a credentials store. **Both halves of this premise are stale.**

- The credentials-store migration shipped post-#165: `WebhookSecretService.rotate()` (`libs/core/src/integrations/application/services/webhook-secret.service.ts`) generates 32-byte secrets and persists them encrypted in `integration_credentials` keyed by `webhookSecretRef(connectionId)`. `WebhookAuthService.verifySignature()` reads from `WebhookSecretProviderPort.getSecret(provider, connectionId)`. The env-var pattern doesn't exist anywhere in the codebase.
- `POST /connections/:id/webhooks/secret/rotate` admin endpoint already returns the plaintext secret one-time at `apps/api/src/integrations/http/connection.controller.ts:213-231`.

So the BE secret-storage half of #168 is already done. **The remaining surface is purely the provisioning UX**: getting that already-rotated secret + Base URL + Connection ID into the PS module's `Configuration::*` rows without the operator's keyboard.

## Industry-pattern decision

Three patterns dominate PS module auto-provisioning (Shippo / EasyShip / Sendcloud paste-API-key, OAuth, Lengow / ShoppingFeed / Akeneo SaaS-pushes-via-WS). For OL specifically — operator already pasted a PS WS key at connection-create time, OL already has authenticated WS access — **the canonical pattern is "SaaS pushes config via the built-in `configurations` resource"**. Zero new module config endpoints, zero browser-mediated handoff, zero install tokens. The plaintext secret never leaves the server-to-server boundary.

A round-trip verification ping does need a tiny PS module front controller (HMAC-authenticated using the freshly-written secret), but that endpoint is **verification-only** and not part of the configuration push.

## Layer classification

Three layers, all incremental. No CORE port changes (PS-specific capability). No new domain ports (the work is a service plus an HTTP push).

- **Integration (PS adapter + tiny PHP front controller)** — service that orchestrates rotate + push; ping receiver in PHP.
- **Interface (OL endpoint + DTO extension)** — new `POST /connections/:id/webhooks/install` admin endpoint; one DTO field added.
- **Frontend** — "Configure webhooks" button on connection detail page; status display.

## Decisions locked from the tech-review pass

1. **Push mechanism: built-in PS WS `configurations` resource.** No new module admin controller, no new auth code on the PHP side. Three `PUT /api/configurations` calls (or a get-list-then-update-or-create dance per name) for `OPENLINKER_BASE_URL`, `OPENLINKER_CONNECTION_ID`, `OPENLINKER_WEBHOOK_SECRET`. WS basic-auth with the existing connection's WS key.
2. **Test-ping mechanism: tiny PS module front controller `controllers/front/ping.php`.** HMAC-authenticated using the just-written `OPENLINKER_WEBHOOK_SECRET` (reuses `HmacRequestVerifier` from #515). Verifies inbound, then **synchronously** invokes `WebhookSender::sendEvent()` with a `test_ping` event — bypasses the cron-triggered outbox so the round-trip completes in ~1-2s. ~30 LoC PHP.
3. **State storage: extend `PrestashopConnectionConfigDto` with two fields.**
   - `webhooksConfigured?: boolean` — operator can't manually set it but the validator must accept it on writes from OL itself.
   - `openlinkerCallbackBaseUrl?: string` — OL's URL from PS's perspective. Per-connection (legitimate variability: dev `host.docker.internal`, multi-network deploys), defaulted from the OL request's `Host` header on first connection-edit fetch, operator-overridable. **No new env var** — connection-scoped per the engineering-standards Configuration rule.
   The "last test ping at" timestamp is queried from the existing `WebhookDeliveryQueryService` (extended in Step 5b below) — no new state field needed.
4. **Failure-mode policy: accept-and-surface.** If rotate succeeds but PS WS push fails, we leave `webhooksConfigured: false`; FE shows "Configuration push failed — try again". If push succeeds but ping fails, we mark `webhooksConfigured: true` but the FE shows "Configured, ping not yet received — try again or wait for next event". `rotate()` invalidates the previous secret on the OL side; if PS still has the old secret, signature verification on real webhooks will fail loudly until the operator retries. This is acceptable for an admin button. Concurrent clicks: FE disables button while in flight — no BE cooldown needed.

## Files

**New:**

- `libs/integrations/prestashop/src/application/interfaces/prestashop-webhook-provisioning.service.interface.ts`
- `libs/integrations/prestashop/src/application/services/prestashop-webhook-provisioning.service.ts`
- `libs/integrations/prestashop/src/application/services/__tests__/prestashop-webhook-provisioning.service.spec.ts`
- `apps/api/src/integrations/http/dto/configure-webhooks-response.dto.ts`
- `apps/prestashop-module/openlinker/controllers/front/ping.php`
- `apps/web/src/features/connections/hooks/use-configure-webhooks.ts`
- `apps/web/src/features/connections/components/configure-webhooks-button.tsx` (+ test)

**Modified:**

- `apps/api/src/integrations/application/dto/prestashop-connection-config.dto.ts` — add `webhooksConfigured?: boolean` and `openlinkerCallbackBaseUrl?: string` with appropriate decorators.
- `apps/api/src/integrations/http/connection.controller.ts` — add `POST /connections/:id/webhooks/install` (`@Roles('admin')`) that delegates to the new provisioning service.
- `apps/api/src/integrations/http/connection.controller.spec.ts` — controller-level tests for the new endpoint.
- `libs/core/src/webhooks/domain/types/webhook-delivery.types.ts` — add `eventType?: string` to `WebhookDeliveryFilters`.
- `libs/core/src/webhooks/infrastructure/persistence/repositories/webhook-delivery.repository.ts` — extend the query builder with one optional `where` clause for `eventType`.
- `apps/api/src/webhooks/http/webhook-delivery.controller.ts` (+ query DTO) — accept `eventType` query param.
- `apps/api/src/webhooks/application/services/__tests__/webhook-delivery-query.service.spec.ts` — one new branch covering `eventType` filter.
- `apps/prestashop-module/openlinker/openlinker.php` — register the new front controller in install hooks if PS doesn't auto-discover (verify; PS 8 typically auto-discovers).
- `apps/prestashop-module/openlinker/README.md` — document the new front-controller, deprecate the manual config form (keep it as fallback).
- `apps/web/src/pages/connections/connection-detail-page.tsx` (or wherever PS connection card renders) — add the button + status badge.

## Step-by-step

### Step 1 — Extend `PrestashopConnectionConfigDto`

Add two optional fields with explanatory JSDoc:

```ts
@ApiPropertyOptional({
  description:
    'Whether OL has successfully pushed webhook configuration to the PS ' +
    '`openlinker` module. Set by `POST /connections/:id/webhooks/install`; ' +
    'operators do not set this manually.',
})
@IsOptional()
@IsBoolean()
webhooksConfigured?: boolean;

@ApiPropertyOptional({
  description:
    'OL base URL from PS\'s perspective — used by the PS module to POST ' +
    'webhooks back to OL. Per-connection (covers dev `host.docker.internal`, ' +
    'multi-network deploys, etc.). When unset, OL falls back to the request ' +
    'origin of the most-recent connection-edit fetch.',
  example: 'http://host.docker.internal:3000',
})
@IsOptional()
@IsString()
@IsUrl({ require_protocol: true, require_tld: false })
openlinkerCallbackBaseUrl?: string;
```

Add 2-3 boundary tests in `connection.service.spec.ts` confirming the validator accepts both fields with valid PS config, rejects non-boolean for the first, and rejects invalid URLs for the second.

### Step 2 — Implement `PrestashopWebhookProvisioningService`

Service interface + impl in the PS integration package. Key shape:

```ts
export interface IPrestashopWebhookProvisioningService {
  install(connectionId: string, actorUserId?: string): Promise<InstallResult>;
}

export interface InstallResult {
  webhooksConfigured: boolean;
  testPingTriggered: boolean;
  warning?: string;  // populated on partial-success states
}
```

**Algorithm:**

1. Get connection via `ConnectionPort` (404 if missing or non-prestashop platformType).
2. Resolve OL's externally-reachable base URL: `connection.config.openlinkerCallbackBaseUrl`. **No request-origin fallback** — host-header injection would let an attacker write a malicious callback URL into PS during a legitimate install click. If unset, throw `BadRequestException`: "Set OL callback URL on the connection-edit page before configuring webhooks." The FE pre-fills the field from `window.location.origin` on the connection-edit form (browser-context value, not server-trusted), so most operators set it implicitly on first edit-save.
3. Call `webhookSecretService.rotate(provider='prestashop', connectionId, actorUserId)` → get plaintext secret.
4. Build the WS client for this connection (existing factory pattern).
5. Push the three config rows. Two PS-WS-specific notes:
   - PS `configurations` is keyed by `id`, not `name`. To upsert by name we have to: `listResources('configurations', { filter: { name: '<NAME>' } })` → if hit, `updateResource('configurations', id, ...)`; if miss, `createResource('configurations', ...)`. Encapsulate this as a private `upsertConfiguration(name, value)` method on the service so each of the three pushes is one call.
   - Body shape: `{ configuration: { name, value, id_shop_group: 0, id_shop: 0 } }` — defaults to all-shops on multi-store installs (matches the manual form's existing behavior).
6. After all three pushes succeed, mark `connection.config.webhooksConfigured = true` via `connectionPort.update(connectionId, { config: { ...existing, webhooksConfigured: true } })`.
7. Trigger the test ping: POST to `${baseUrl}/module/openlinker/ping` with HMAC headers using the just-rotated secret. Body `{ event: 'test_ping' }`. Timeout 5s. Best-effort: failure here doesn't roll back step 6, but `testPingTriggered: false` propagates to the response so the FE can surface it.
8. Log `{ connectionId, webhooksConfigured, testPingTriggered, actor }` at `log` level.

**Failure handling:**
- Step 3 fails → throw, no partial state.
- Step 5 fails (one or more pushes fail) → throw with the WS error attribution. `webhooksConfigured` stays at its prior value (likely `false`/unset). The previously-rotated secret is now invalidated on OL's side; PS still has the old secret. Operator clicks again, eventually consistent. Surface this in the error message: "Configuration push partially failed; click again to retry."
- Step 6 fails (DB write) → log error, return `{ webhooksConfigured: false, testPingTriggered: false, warning: 'state-update-failed' }`. PS now has the right config but OL didn't record success. Re-running install is safe (it'll re-rotate, re-push, re-mark).
- Step 7 fails → return `{ webhooksConfigured: true, testPingTriggered: false, warning: 'ping-not-received' }`. Configuration is correct; verification just didn't complete.

### Step 3 — Add `POST /connections/:id/webhooks/install` to `connection.controller.ts`

Mirror the existing `rotateWebhookSecret` controller method shape. Roles: `admin`. Returns `ConfigureWebhooksResponseDto` matching `InstallResult`. No request headers consumed — the controller is a thin pass-through.

```ts
@Roles('admin')
@Post(':id/webhooks/install')
@HttpCode(HttpStatus.OK)
async installWebhooks(
  @Param('id') id: string,
  @CurrentUser() user: AuthenticatedUser,
): Promise<ConfigureWebhooksResponseDto> {
  return this.webhookProvisioningService.install(id, user?.id);
}
```

### Step 4 — Implement `controllers/front/ping.php`

PHP front controller. ~30 LoC. Receives POST, verifies HMAC headers via `HmacRequestVerifier` using `Configuration::get('OPENLINKER_WEBHOOK_SECRET')`, then synchronously invokes `WebhookSender::sendEvent()` with a constructed `OutboxEvent` of type `test_ping`. Synchronous send means the round-trip completes inside the original install request's wall-clock window. Returns `{ ok: true }` on success.

Why front controller (not admin controller): admin controllers require admin session cookies; front controllers are public PHP endpoints owned by the module, gateable by HMAC. This matches `controllers/front/cartshipping.php` from #515.

Skeleton:

```php
class OpenLinkerPingModuleFrontController extends ModuleFrontController {
    public $auth = false;  // HMAC, not session
    public $ssl = true;

    public function postProcess() {
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/HmacRequestVerifier.php';
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/WebhookSender.php';
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/OutboxEvent.php';
        require_once _PS_MODULE_DIR_ . 'openlinker/classes/EventIdGenerator.php';

        $rawBody = Tools::file_get_contents('php://input') ?: '';
        $secret = (string) Configuration::get('OPENLINKER_WEBHOOK_SECRET');
        try {
            HmacRequestVerifier::verify(
                $rawBody,
                isset($_SERVER['HTTP_X_OPENLINKER_TIMESTAMP']) ? $_SERVER['HTTP_X_OPENLINKER_TIMESTAMP'] : null,
                isset($_SERVER['HTTP_X_OPENLINKER_SIGNATURE']) ? $_SERVER['HTTP_X_OPENLINKER_SIGNATURE'] : null,
                $secret
            );
        } catch (Exception $e) {
            $this->respond(401, ['error' => $e->getMessage()]);
            return;
        }

        $event = new OutboxEvent();
        $event->event_id = EventIdGenerator::generate();
        $event->schema_version = '1.0';
        $event->event_type = 'test_ping';
        $event->object_type = 'connection';
        $event->external_id = (string) Configuration::get('OPENLINKER_CONNECTION_ID');
        $event->occurred_at = date('Y-m-d H:i:s');
        $event->payload_json = json_encode(['source' => 'install-verification']);

        try {
            (new WebhookSender())->sendEvent($event);
            $this->respond(200, ['ok' => true]);
        } catch (Exception $e) {
            $this->respond(502, ['error' => WebhookSender::getErrorMessage($e)]);
        }
    }

    private function respond($status, $body) {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($body);
        exit;
    }
}
```

URL surface: `${baseUrl}/module/openlinker/ping` (PS standard front-controller routing).

### Step 5 — Extend OL's webhook intake to recognize `test_ping`

`WebhookToJobHandler` (consumer of `events.inbound.webhooks`): for `eventType === 'test_ping'`, **skip job enqueue** (it's purely diagnostic, no sync action needed). Just persist the delivery record (existing behavior). Trivial — likely a single guard inside the handler's switch.

### Step 5b — Extend `WebhookDeliveryFilters` with `eventType`

`WebhookDeliveryFilters` (`libs/core/src/webhooks/domain/types/webhook-delivery.types.ts`) currently accepts `provider`, `connectionId`, `status`, `since`, `until` — no `eventType`. Need this so the FE can query "last `test_ping` for connection X". Small extension across 4 files (~15 LoC):

1. Add `eventType?: string` to the filters interface.
2. Extend `WebhookDeliveryRepository.list()` query builder with one optional `andWhere('eventType = :eventType', ...)` clause.
3. Extend the controller's query DTO with `@IsOptional() @IsString() eventType?: string`.
4. One new branch in `webhook-delivery-query.service.spec.ts` covering the filter.

The FE consumes via `webhook-deliveries.api.ts` with `?eventType=test_ping&connectionId=X&limit=1`, takes `items[0]?.receivedAt` as the "last ping at" display value.

### Step 6 — Frontend mutation hook + button

- `useConfigureWebhooks(connectionId)` — TanStack Query mutation. On success, invalidates the connection-detail query.
- `<ConfigureWebhooksButton connectionId={...} />` — calls the mutation, disabled while in-flight, shows result via the existing `Toast` primitive ("Webhooks configured ✓" / "Configuration push failed — please try again"). Following the FE-002 button conventions: `tone="primary"` `size="md"`.
- **Connection-edit page (PS connections):** the existing edit form gains an `openlinkerCallbackBaseUrl` field. **Pre-fill the input with `window.location.origin` on first render when the field is empty** — captures the browser-context URL, which is what PS-server-to-OL needs in 95% of cases. Operator sees the default, can override for dev (`http://host.docker.internal:3000`) or unusual deploys. Saved via the existing connection-update mutation; the new DTO field on the BE accepts it.
- Connection detail page: render the button next to the existing "Test connection" / "Disable" actions. Below: a subtle status row "Webhooks: configured ✓ — last ping <timestamp>" or "Webhooks: not configured — click 'Configure webhooks' to set up" — sourced from `connection.config.webhooksConfigured` + the `eventType=test_ping` webhook-deliveries query. If the operator clicks before saving the callback URL, the BE returns `400` with operator-actionable text — the toast surfaces "Set OL callback URL on the connection-edit page first" with a link to the edit page.

No URL state, no form state for the install button itself — local UI state for the in-flight indicator, server state for everything else. The callback-URL field uses standard React Hook Form via the existing edit-page form.

### Step 7 — Tests

**BE unit tests** (`prestashop-webhook-provisioning.service.spec.ts`):

- Happy path: rotate + 3× upsertConfiguration + connection update + ping fire → `{ webhooksConfigured: true, testPingTriggered: true }`.
- Push fails (one of the three configurations resource calls rejects) → throws; connection.config not updated; observable error message attributes the failure to the WS push.
- Ping fails after push succeeds → `{ webhooksConfigured: true, testPingTriggered: false, warning: 'ping-not-received' }`.
- Connection update fails after push succeeds → `{ webhooksConfigured: false, testPingTriggered: false, warning: 'state-update-failed' }`.
- Non-prestashop connection → throws `BadRequestException`.
- Mock `WebhookSecretService` (port), `ConnectionPort`, `PrestashopWebserviceClient` (port), and the HTTP client used for the ping call.

**BE controller tests** (`connection.controller.spec.ts`):

- Endpoint resolves, `@Roles('admin')` enforced, 404 on missing connection, response shape matches DTO.

**FE tests** (Vitest + Testing Library):

- Button renders, click triggers mutation, in-flight disable works, success state surfaces toast, error state surfaces toast.
- Mutation hook unit test covering success + failure branches.

**No PHP tests** — repo doesn't have a PHP test harness. Manual smoke documented in the PR.

### Step 8 — Manual verification (dev shop)

Documented in the PR description:

1. With a fresh PS connection, confirm `connection.config.webhooksConfigured` is unset and the manual config form in PS admin is empty.
2. Click "Configure webhooks" on the OL connection detail page.
3. Within ~2s, the FE shows "Webhooks: configured ✓ — last ping just now".
4. Confirm in PS admin that `OPENLINKER_BASE_URL`, `OPENLINKER_CONNECTION_ID`, `OPENLINKER_WEBHOOK_SECRET` are populated (Configure → OpenLinker module page).
5. Save a product in PS admin. Within a cron tick, OL receives the `actionProductSave` webhook and the dashboard reflects it.
6. Click "Configure webhooks" again. Confirm idempotent: secret rotates, PS gets the new one, test ping arrives again. Confirm operator sees the new "last ping" timestamp.
7. Failure simulation: temporarily make PS WS unreachable (block in dev hosts file), click "Configure webhooks", confirm error surfaces and `webhooksConfigured` stays false.

## Quality gate

```bash
pnpm lint && pnpm type-check && pnpm test
```

No migration (DTO field is JSONB-blob-internal, not a schema column). No worker changes. No new MCP/external dependencies.

## Open questions (resolved)

1. ~~`OL_PUBLIC_BASE_URL` provenance.~~ **Resolved:** no env var, no request-header derivation (host-header injection risk). Per-connection `openlinkerCallbackBaseUrl?: string` field on `PrestashopConnectionConfigDto`, FE pre-fills from `window.location.origin` on first render of the connection-edit page, operator-overridable. BE throws `400` with operator-actionable text if unset at install time.
2. **PS WS `configurations` resource shape on multi-store.** Need to confirm against the dev shop that `{ name, value }` body without explicit `id_shop_group` / `id_shop` defaults to "all shops" on PS 8.x. The existing manual form's `Configuration::updateValue($key, $value)` writes globally; the WS resource should mirror. Low risk; **pre-committed fallback:** if PS ≥ 8.2 rejects the bare body with a multi-store error, retry with explicit `id_shop_group: 1, id_shop: 1` (PS-default scope IDs). No multi-store hierarchy iteration in this PR.
3. ~~Webhook delivery `eventType` filter.~~ **Resolved:** filter doesn't exist. Step 5b adds it (~15 LoC). Repository's `andWhere` clause must use the snake_case column name (`event_type`) since the entity maps `@Column({ name: 'event_type' })`.

## Out of scope

- Removing the manual config form in PS admin entirely. Keep it as a fallback for environments where WS push fails (operator can still paste manually). A future PR can hide it behind an "Advanced" disclosure once auto-config is the default path.
- Multi-tenant OL (multiple OL instances writing to one PS) — out of scope; assumes one OL ↔ one PS pairing.
- A "Send test ping" button on the PS module side. The OL-side install button covers verification; a PS-side button would be nice for diagnostic re-tests but adds another endpoint with a different auth model. Defer.
- Surfacing the install URL or any browser-mediated handoff. The whole point of pattern 3 is that the browser is not in the loop.

## Implementation order

1. Step 1 — DTO extension (smallest, no behavior change yet)
2. Step 2 — Provisioning service + interface + tests (the meat)
3. Step 3 — Controller endpoint + tests
4. Step 4 — PS module front controller + manual smoke that ping arrives
5. Step 5 — `test_ping` recognition in webhook intake
6. Step 6 — FE button + hook + tests
7. Step 7 — Run quality gate, self-review per `docs/code-review-guide.md`
8. Step 8 — Manual end-to-end verification on the dev shop
