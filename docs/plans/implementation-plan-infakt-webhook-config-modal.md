# Implementation Plan — inFakt webhook config modal (#1770)

Design artifact (source of truth for UX): https://claude.ai/code/artifact/37803167-dd9d-443a-9eb7-fd548d0fc827

## 1. Goal

Give operators a first-class UI to finish inFakt webhook setup: register the OL endpoint, see live activation/signature status, and **paste the inFakt-generated HMAC secret into OL** (replacing the deprecated `OPENLINKER_WEBHOOK_SECRET__INFAKT` env var). Rendered as a modal opened from the connection Actions tab and the create-wizard finish step.

Layer: Integration (BE, `apps/api` + `libs/core/integrations`) + Frontend (`apps/web`).

Non-goals: webhook auto-provisioning to inFakt (inFakt has no such API); changing the InPost/WC rotate flow; the connection-list header chip (nice-to-have, deferred).

## 2. Backend

### 2.1 `set` on the webhook-secret service
- `libs/core/src/integrations/application/interfaces/webhook-secret.service.interface.ts` — add `set(provider, connectionId, secret, actorUserId?): Promise<void>`.
- `libs/core/src/integrations/application/services/webhook-secret.service.ts` — implement `set`: same persist path as `rotate` (update-or-create `webhookSecretRef`, `invalidate`, log `webhook_secret.set`) but with the caller-supplied secret, no `randomBytes`. Extract the shared persist into a private `persist(connection, secret)`.
- Unit test: extend `webhook-secret.service.spec.ts` — persists supplied secret, create-on-missing, invalidates cache.

### 2.2 `PUT /connections/:id/webhooks/secret`
- New DTO `apps/api/src/integrations/http/dto/set-webhook-secret.dto.ts` — `{ secret: string }`, `@IsString() @IsNotEmpty() @MinLength(8)`.
- `connection.controller.ts` — `@Roles('admin') @Put(':id/webhooks/secret')`, `204`. Resolve connection, call `webhookSecretService.set(platformType, id, dto.secret, user?.id)`. `Cache-Control: no-store`.
- Controller spec: sets secret, 400 on empty (validation).

### 2.3 `GET /connections/:id/webhooks/status`
- New response DTO `apps/api/src/integrations/http/dto/webhook-status-response.dto.ts`:
  - `activation: 'not-registered' | 'verified'` (heuristic: any recorded delivery ⇒ verified; else not-registered)
  - `signature: 'off' | 'configured' | 'mismatch'` (DB secret present ⇒ configured; latest delivery `signatureValid === false` ⇒ mismatch; else off)
  - `lastDeliveryAt / lastDeliveryEvent / lastDeliveryResult` from the latest `webhook_deliveries` row.
- Derivation lives in a small service method — reuse `IWebhookDeliveryQueryService.list({ provider, connectionId }, { limit: 1 })` for the latest row, and check stored secret via `credentialRepository.getByRef(webhookSecretRef(id))` presence (add a `has(provider, connectionId)` to the secret provider port, or a try/catch presence check in the controller-facing service). Prefer a new `WebhookStatusService` (`apps/api/src/integrations/application/services/`) implementing `IWebhookStatusService` to keep the controller thin.
- Guard `@Roles('admin')`. Unit test the derivation matrix.

## 3. Frontend

### 3.1 feature/connections API + hooks
- `connections.api.ts` — add `setWebhookSecret(connectionId, secret)` (`PUT`), `getWebhookStatus(connectionId)` (`GET`). Types in `connections.types.ts` (`WebhookStatus`, `WebhookActivation`, `WebhookSignatureState`).
- Hooks: `use-set-webhook-secret-mutation.ts` (invalidates the status query), `use-webhook-status-query.ts`.
- Export all via `features/connections/index.ts` barrel.

### 3.2 `InfaktWebhookConfig` modal body
- `apps/web/src/plugins/infakt/components/infakt-webhook-config.tsx` — content-only body (no Dialog chrome):
  - endpoint URL (`{apiBase}/webhooks/infakt/{connectionId}`; resolve api base like `inpost-webhook-runbook.tsx`) + `CopyableId`;
  - subscribed-event chips (`send_to_ksef_success`, `send_to_ksef_error`, `invoice_marked_as_paid`);
  - two-lane exchange (`→ You register in inFakt` / `← inFakt gives you (optional)`);
  - optional signature-secret paste `Input` + Save (wired to `useSetWebhookSecretMutation`);
  - activation/signature status strip from `useWebhookStatusQuery` (loading/error/data states);
  - disclosure "Why can't OpenLinker set this up for me?".
- `InfaktWebhookConfigDialog` — wraps the body in shared `Dialog` (`shared/ui/dialog.tsx`) with a `Configure webhooks` title + Done footer.
- CSS: new bounded section in `apps/web/src/index.css` (`/* ── inFakt webhook config (#1770) ── */`) — exchange grid, seam, status strip, lane chips. Tokens only.

### 3.3 wire into plugin + wizard
- `apps/web/src/plugins/infakt/index.ts` — add `ConnectionActions: InfaktWebhookConnectionActions` (compact row: title + status summary chips + "Configure webhooks…" button opening the dialog).
- `apps/web/src/features/connections/components/infakt-setup-form.tsx` — in the post-create region, add a "Delivery webhooks" item with a "Configure…" button opening the same dialog.

### 3.4 tests
- `infakt-webhook-config.test.tsx` — renders endpoint, copies, save-secret happy/error, status strip states.
- plugin slot render test; wizard post-create render.

## 4. Validation / risk
- No `platformType === 'infakt'` in shared components — plugin-registry only.
- Plugin → feature imports via barrel only.
- Status activation is a documented heuristic (no inFakt read-back of subscription state). Signature `mismatch` only reflects the most recent delivery.
- Docs: update `libs/integrations/infakt/docs/setup-guide.md` webhook section (coordinate w/ open PR #1307) + remove the "no OL admin-UI affordance" residual-limitation caveat in `docs/architecture-overview.md`.

## 5. Verify against artifact
Stand up the demo docker backend, run this worktree's FE against it, and screenshot the Actions-tab row + open modal to confirm parity with the artifact (modal, two-lane exchange, activation-vs-optional-signature status strip).
