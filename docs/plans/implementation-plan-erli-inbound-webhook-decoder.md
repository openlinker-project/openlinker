# Implementation Plan: Erli-native Inbound Webhook Decoder + Signature Verifier (#1145)

**Date**: 2026-06-23
**Status**: Draft / Ready for Review
**Estimated Effort**: ~1.5 days code + 0.5 day sandbox spike (spike is blocking)
**Issue**: #1145 (`Closes #1145`)
**Depends on**: #1081 / #996 (branch `996-erli-webhooks`) — this branch is **stacked** on it; rebase onto `main` before final PR once #1081 merges.

---

## 1. Task Summary

**Objective**: Make the Erli inbound-webhook *receive* path functional by implementing an Erli-native `InboundWebhookDecoderPort` (signature verifier + envelope extractor) and registering it under `provider = 'erli'`, so real Erli deliveries authenticate and route through the **already-shipped** `ErliWebhookEventTranslator` → core routing policy → `marketplace.order.sync`.

**Context**: #996 (PR #1081) shipped the Erli webhook *translator* + *provisioner* (`PUT /hooks` sets the shared `accessToken`), but the receive path is dead: the host's fail-closed OL-HMAC `DefaultWebhookDecoder` rejects 100% of real Erli deliveries because no Erli-native decoder is registered. This is an accepted reconciliation-first posture (the #993 inbox poll is authoritative, ADR-025), so order ingestion is unaffected — but webhooks contribute zero low-latency value until this lands. #1145 closes that gap.

**Classification**: Integration (plugin-layer only). No CORE change, no migration, no frontend. Adds a second implementation of the existing `InboundWebhookDecoderPort` (the InPost adapter is the working precedent).

---

## 2. Scope & Non-Goals

### In Scope
- `ErliInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort` (`verify` + `extractEnvelope`).
- Registration via `host.inboundWebhookDecoderRegistry.register('erli', …)` in `erli-plugin.ts`'s `register(host)`.
- Unit tests mirroring the InPost decoder spec (valid sig, tampered sig, missing headers, malformed body, ignore vs reject, deterministic `eventId`).
- A **blocking sandbox verification spike** (Phase 0) to confirm Erli's actual delivery auth scheme, captured as updated facts in `erli-webhook.types.ts` (drop the `#992-PROVISIONAL` flags it confirms).

### Out of Scope
- Changing the translator, provisioner, inbox poll, or any CORE contract.
- Frontend (the connection-actions "Configure webhooks" affordance already exists for the provisioner).
- An integration vertical-slice int-spec is **optional** (see Phase 4) — adapter unit tests + existing core webhook int-specs are the baseline gate.
- A new ADR — #1145 is a routine second implementation of the existing **ADR-021** decoder pattern under the **ADR-025** reconciliation-first posture. No new architectural decision.

### Constraints
- Stacked on #1081; keep the diff limited to net-new Erli files + the one `register()` edit.
- Decoder must be **pure + total** (ADR-015): never throw unbounded; `verify` → `{ ok, timestampMs? }`, `extractEnvelope` → `route | ignore | reject`.
- Fail-closed: an unconfirmed/auth-failing delivery must `{ ok: false }` (401), never silently route.

---

## 3. Architecture Mapping

**Target Layer**: Integration — `libs/integrations/erli/src/infrastructure/adapters/`.

**Capabilities / Ports Involved** (all existing — none new):
- `InboundWebhookDecoderPort` — `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts`. Two methods:
  - `verify({ rawBody: Buffer; headers: Record<string,string>; secret: string }): WebhookVerifyResult` → `{ ok: boolean; timestampMs?: number }`.
  - `extractEnvelope(rawBody: Buffer, headers: Record<string,string>): DecodeResult` → `{ action:'route'; envelope } | { action:'ignore'; reason } | { action:'reject'; reason }`.
- `InboundWebhookDecoderRegistryService` — keyed by **`provider`** (the `/webhooks/:provider/:connectionId` path segment = `'erli'`), exposed as `host.inboundWebhookDecoderRegistry` (`libs/plugin-sdk/src/host-services.ts`).
- `WebhookSecretProviderPort.getSecret(provider, connectionId)` — the **host** resolves the secret and passes it into `verify({ secret })`. The decoder does **not** fetch it (no NestJS DI needed in the decoder).

**Existing Services Reused**:
- `ErliWebhookEventTranslator` (already registered by `adapterKey`) — the decoder hands off to it downstream via the host pipeline; no direct call.
- Host receive pipeline (`apps/api/src/webhooks/.../webhook.service.ts`): `decoder = registry.get(provider) ?? defaultDecoder` → `assertConnectionUsable` → `getSecret` → `verify` → replay-window check (only if `timestampMs` returned) → `extractEnvelope` → Postgres dedup on `(provider, connectionId, eventId)` → publish → (separate handler) translator → routing policy.

**New Components Required**:
- `erli-inbound-webhook-decoder.adapter.ts` (+ `__tests__/…spec.ts`).
- One `register()` line in `erli-plugin.ts`.
- Possibly small additions to `erli-webhook.types.ts` (confirmed header/field names from the spike).

**Core vs Integration Justification**: Pure Integration. The signature scheme is Erli-specific; CORE already exposes the seam (port + registry + secret provider). Mirrors InPost (`InpostInboundWebhookDecoderAdapter`, registered `host.inboundWebhookDecoderRegistry.register('inpost', …)`).

---

## 4. External / Domain Research

### Erli delivery auth scheme — ⚠️ THE load-bearing unknown (#992-BLOCKED)

Confirmed today:
- Provisioning works (`PUT /hooks/{orderCreated|orderStatusChanged}` body `{ url, accessToken }`, verified #992). The `url` is a single endpoint `…/webhooks/erli/{connectionId}` shared by both hooks.
- The provisioner doc *hypothesizes* the `accessToken` (= the rotated webhook secret) is "echoed back on each delivery for signature verification."

**NOT confirmed anywhere in the repo** (must come from the spike):
1. Does Erli **HMAC-sign** deliveries, or just **echo the `accessToken`** as a shared bearer token? (changes `verify` from constant-time HMAC compare → constant-time token compare.)
2. Header/field names carrying the signature/token and (if any) timestamp.
3. Whether a timestamp is present and **covered** by the signature (drives whether we return `timestampMs` for the replay-window check — InPost returns it, the default decoder requires it; if Erli has none, we return `undefined` and the host skips replay).
4. How a delivery signals **which hook fired** (`orderCreated` vs `orderStatusChanged`) — header? body `type` field? The translator reads `event.eventType` expecting exactly those literals, so the decoder must surface it.
5. The delivery **body shape** (the translator/`erli-webhook.types.ts` assume id-only `{ orderId }`, also `#992-PROVISIONAL`).

### Internal precedent (the template to copy)
- `libs/integrations/inpost/src/infrastructure/adapters/inpost-inbound-webhook-decoder.adapter.ts` — HMAC-SHA256 (base64) over `{timestamp}.{rawBody}`, header `x-inpost-signature`/`x-inpost-timestamp`, `timestampMs = Date.parse(iso)`; `extractEnvelope` ignores non-matching topics (202), rejects malformed (400), derives a deterministic `eventId`. Stateless POJO, `new …Adapter()` with no args, registered in the plain `register(host)`.
- Its spec (`__tests__/inpost-inbound-webhook-decoder.adapter.spec.ts`) is the test template.

---

## 5. Questions & Assumptions

### Open Questions (resolved by Phase 0 spike)
- OQ-1..5 = the five unknowns in §4. **All are blocking for a shippable `verify()`.**

### Assumptions (safe defaults if the spike is inconclusive)
- **A1 (most likely)**: Erli echoes the `accessToken` (shared secret) on each delivery in a header (candidate names to probe: `x-erli-token`, `authorization`, `x-webhook-token`). `verify` = timing-safe compare of the echoed token against `secret`; **no** timestamp → `timestampMs: undefined` (replay-window skipped, acceptable because `eventId` Postgres dedup is the authoritative idempotency gate and the #993 poll backstops loss).
- **A2 (fallback)**: If Erli HMAC-signs, copy the InPost HMAC path verbatim (swap header names + base64/hex per the spike).
- **A3**: Event type rides a body field (`type`) or a per-hook header; if neither exists, default `eventType` to `'orderStatusChanged'` → translator maps to `'updated'` → a safe full re-pull (matches the translator's existing unknown→updated fallback).
- **A4**: `eventId = sha256(connectionId + ':' + externalId + ':' + eventType)[:N]` (deterministic; collapses retries, distinguishes created vs status-changed). Correctness guarantee is the idempotent downstream re-read, so best-effort dedup suffices.

### Documentation Gaps
- `erli-webhook.types.ts` is entirely `#992-PROVISIONAL`. The spike confirms/repairs it; this plan's Phase 0 updates those facts in the same PR.

---

## 6. Proposed Implementation Plan

### Phase 0 — Sandbox verification spike (BLOCKING) 🔬
**Goal**: Capture a real Erli sandbox delivery and confirm OQ-1..5.

**Steps**:
1. Stand up a public callback (ngrok/webhook.site) and provision a sandbox Erli connection's hooks at it (`callbackBaseUrl` → tunnel; reuse the existing provisioner).
2. Trigger a sandbox order (or status change) so Erli fires a real delivery; capture **full headers + raw body** for both `orderCreated` and `orderStatusChanged`.
3. Record: signature/token header name + format, timestamp presence/format/coverage, the field/header that distinguishes the hook, and the body shape.
4. **Acceptance**: a written record of one real delivery per hook type; `erli-webhook.types.ts` updated to confirmed facts (provisional flags dropped for what's now verified). If the spike is genuinely impossible in sandbox, proceed under A1/A3 and label the decoder `PROVISIONAL` with a follow-up verify-in-staging task — but prefer confirming.

> If you reach this phase and the spike cannot be completed, **stop and flag it** — shipping `verify()` on an unconfirmed scheme is the one thing that can make this worse than the status quo (false-accept = security hole).

### Phase 1 — Decoder adapter
**Steps**:
1. **`erli-inbound-webhook-decoder.adapter.ts`** — `libs/integrations/erli/src/infrastructure/adapters/`.
   - File header per standards (purpose, ADR-021/ADR-025, the trigger-not-source-of-truth note like InPost).
   - `verify({ rawBody, headers, secret })`: implement the confirmed scheme (A1 token-compare or A2 HMAC). Always timing-safe (`crypto.timingSafeEqual`). Return `{ ok:false }` on any missing/mismatch; return `timestampMs` only if Erli sends a signature-covered timestamp.
   - `extractEnvelope(rawBody, headers)`: parse JSON total-ly; `reject` on non-JSON/non-object/missing order id; build `InboundWebhookEnvelope` with `eventType` (mapped to `'orderCreated'|'orderStatusChanged'` so the translator's switch hits), `objectType:'order'`, `externalId` = the order id (defensive `unknown`→non-empty-string narrowing, same as the translator), `occurredAt`, and a deterministic `eventId` (A4). Use `ignore` (202) for a recognizable setup-ping/unknown-topic so Erli doesn't retry-storm.
   - **Acceptance**: pure + total; no `Logger`/DI/I/O; no secret ever logged.
2. Reuse/extend `erli-webhook.types.ts` for confirmed header/field-name constants (don't inline literals in the adapter).
   - **Acceptance**: type-check clean; constants single-sourced.

### Phase 2 — Registration
**Steps**:
1. In `erli-plugin.ts` `register(host)`, beside the existing translator registration, add:
   ```ts
   host.inboundWebhookDecoderRegistry.register(
     erliAdapterManifest.platformType, // 'erli' — provider key, NOT ERLI_ADAPTER_KEY
     new ErliInboundWebhookDecoderAdapter(),
   );
   ```
   Update the adjacent comment (the current one says the path is dead until the decoder lands — flip it to "decoder live").
   - **Acceptance**: provider `'erli'` now resolves a native decoder instead of falling to the OL-HMAC default; `erli-plugin.spec.ts` asserts the registration.

### Phase 3 — Unit tests
**Steps**:
1. **`__tests__/erli-inbound-webhook-decoder.adapter.spec.ts`** mirroring the InPost spec:
   - `verify`: valid (→ `ok:true`, `timestampMs` iff applicable); tampered token/signature → `ok:false`; missing header(s) → `ok:false`; (HMAC path) wrong-length guard.
   - `extractEnvelope`: valid `orderCreated`/`orderStatusChanged` → `route` with correct `eventType`/`externalId`; deterministic `eventId` (same in → same out); unknown topic/ping → `ignore`; non-JSON / missing order id → `reject`.
   - A "never logs the secret" assertion (mirror the provisioner spec).
   - **Acceptance**: full erli suite green; coverage ≥ adapter threshold (70%).

### Phase 4 — Integration vertical slice (OPTIONAL)
**Steps**:
1. If time allows, an `apps/api` int-spec posting a signed Erli delivery to `POST /webhooks/erli/:connectionId` and asserting it verifies → publishes → routes to `marketplace.order.sync` (and that a tampered sig 401s). Otherwise rely on adapter unit specs + the existing core webhook int-specs (consciously noted, same call #1081 made for orders).
   - **Acceptance**: green; or an explicit note in the PR that the slice was deferred.

### Configuration / Migrations / Events
- **Config**: none new (secret already provisioned; `callbackBaseUrl` already on the connection).
- **Migrations**: none.
- **Events**: none new — reuses `events.inbound.webhooks` → `WebhookEventTranslator` → routing policy → `marketplace.order.sync`.
- **Error handling**: rely on host mapping — `verify` false → 401, `reject` → 400, `ignore`/`route` → 202. No new exceptions.

---

## 7. Alternatives Considered

- **A. Loosen the default OL-HMAC decoder to accept Erli** — rejected: pollutes the host with provider-specific logic, violates ADR-021's provider-keyed decoder seam, and couples CORE to Erli's scheme.
- **B. Skip webhooks entirely, rely on the #993 poll** — rejected as the *end state* (webhooks are the low-latency win #1145 exists to deliver) but is exactly the safe fallback if the spike fails; that's why the poll stays authoritative (ADR-025).
- **C. NestJS module for the decoder (like the provisioner)** — rejected: the decoder needs no injected services (the host passes `secret` into `verify`); a stateless POJO in `register(host)` is correct, matching InPost.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Hexagonal: Integration adapter implements a CORE port; CORE untouched.
- ✅ Provider-keyed decoder per ADR-021; translator stays `adapterKey`-keyed.
- ✅ Pure + total adapter (ADR-015); no DI/I/O/logging of secrets.

### Naming Conventions
- ✅ `erli-inbound-webhook-decoder.adapter.ts` / `ErliInboundWebhookDecoderAdapter` (matches `{System}{Capability}Adapter` + InPost sibling).

### Risks
- **R1 — unconfirmed scheme (HIGH)**: building `verify()` blind risks false-reject (status quo) or false-accept (security hole). **Mitigation**: Phase 0 is blocking; fail-closed default; never ship A1 to prod without confirmation.
- **R2 — no timestamp ⇒ no replay window (MED)**: if Erli sends no signed timestamp, replay protection relies solely on the Postgres `eventId` dedup. **Mitigation**: deterministic `eventId` + idempotent downstream re-read + the poll backstop. Acceptable, documented.
- **R3 — stacked-PR hygiene (LOW)**: diff carries #1081 until it merges. **Mitigation**: rebase onto `main` before final PR.
- **R4 — event-type ambiguity (LOW)**: if the hook isn't distinguishable, default to `updated`/full re-pull (safe).

### Edge Cases
- Setup ping / unknown topic → `ignore` (202, no retry storm).
- Body present but order id missing/blank → `reject` (400).
- Verified request reaching extract without the expected fields → `reject` (don't fabricate).

### Backward Compatibility
- ✅ Additive — registering a native decoder only changes behavior for `provider='erli'` deliveries (currently 100% rejected). No other provider affected.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-inbound-webhook-decoder.adapter.spec.ts` (mirrors InPost).
- `erli-plugin.spec.ts` — assert decoder registered under `'erli'`.

### Integration Tests
- Optional `apps/api/test/integration/.../erli-webhook-receive.int-spec.ts` (Phase 4).

### Mocking Strategy
- Sign fixtures with a known secret via the confirmed scheme; call the adapter directly (no host needed for unit tests).

### Acceptance Criteria
- [ ] Phase 0 spike documented; `erli-webhook.types.ts` provisional flags resolved for confirmed facts.
- [ ] `verify` authenticates a genuine delivery and rejects a tampered one (fail-closed).
- [ ] `extractEnvelope` yields a translator-compatible envelope with deterministic `eventId`.
- [ ] Decoder registered under `provider='erli'`; real deliveries no longer hit the default decoder.
- [ ] Full erli suite green; type-check + lint + `check:invariants` clean.
- [ ] `Closes #1145`; rebased onto `main` after #1081 merges.

---

## 10. Alignment Checklist
- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no CORE change)
- [x] Uses existing patterns (InPost decoder; no new abstraction/ADR)
- [x] Idempotency considered (deterministic `eventId` + Postgres dedup)
- [x] Event-driven (reuses inbound-webhook stream + translator)
- [x] Rate limits & retries addressed (`ignore` avoids retry storms; poll backstop)
- [x] Error handling comprehensive (verify/reject/ignore → 401/400/202)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready (modulo the blocking Phase 0 spike)

---

## Related Documentation
- ADR-021 (inbound-webhook decoder pattern), ADR-025 (Erli reconciliation-first posture), ADR-015 (translator totality)
- `docs/plans/implementation-plan-erli-webhooks.md` (#996 parent), Issue #1145, PR #1081
- InPost precedent: `libs/integrations/inpost/src/infrastructure/adapters/inpost-inbound-webhook-decoder.adapter.ts`
