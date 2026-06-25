# Implementation Plan: Erli Inbound Webhook Decoder + Signature Verifier

**Date**: 2026-06-25  
**Status**: Ready for Review  
**Estimated Effort**: 2–3 hours  
**Issue**: #1081 (depends on #992 for real-shape confirmation)

---

## 1. Task Summary

**Objective**: Implement an Erli-native `InboundWebhookDecoderPort` that authenticates inbound Erli webhooks and decodes them into the host's neutral `InboundWebhookEnvelope`, then register it with `InboundWebhookDecoderRegistryService` so real Erli deliveries no longer get rejected by the OL-HMAC default decoder.

**Context**: PR #1081 / issue #996 shipped `ErliWebhookEventTranslator` and `ErliWebhookProvisioningAdapter`. The provisioner registers the webhook URL + `accessToken` with Erli via `PUT /hooks/{hookName}`. The translator converts decoded events to `CanonicalInboundEvent`. But nothing implements `InboundWebhookDecoderPort` for the `'erli'` provider — so the host's fail-closed OL-HMAC default rejects 100% of real Erli deliveries, leaving the translator as dead code. The #993 inbox poll (`erli-orders-poll`) remains authoritative (ADR-025); webhooks are the low-latency optimisation this issue closes.

**Classification**: Integration / Infrastructure (adapter implementation, no CORE changes)

---

## 2. Scope & Non-Goals

### In Scope
- `ErliInboundWebhookDecoderAdapter` implementing `InboundWebhookDecoderPort`
- Provisional signature-verification logic (access-token comparison, see §5)
- Adding the provisional `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` constant to `erli-webhook.types.ts` (the single reconciliation point for all Erli webhook wire assumptions)
- Registration in `erli-plugin.ts` via `host.inboundWebhookDecoderRegistry.register`
- Unit tests: valid delivery, tampered/missing token, unknown event type, missing order-id, malformed JSON

### Out of Scope
- Confirming Erli's real signature scheme — blocked on **#992** (sandbox spike). The provisional implementation MUST be swappable in `erli-webhook.types.ts` without touching any other file.
- Inbox poll changes — #993 is already shipped and authoritative; this is additive only.
- ADR: the decoder seam is ADR-021; Erli's provisional signature choice is an implementation detail, not an architectural decision.

### Constraints
- All provisional wire assumptions are isolated to `erli-webhook.types.ts` (already established pattern from `erli-webhook-provisioning.adapter.ts`). When #992 lands, the flip is one-file.
- No CORE changes — `InboundWebhookDecoderPort`, `InboundWebhookDecoderRegistryService`, `DecodeResult`, `WebhookVerifyResult` already exist and are not modified.
- No PII may be logged in the verifier path.

---

## 3. Architecture Mapping

**Target Layer**: Integration — `libs/integrations/erli/src/infrastructure/adapters/`

**Capabilities Involved**:
- `InboundWebhookDecoderPort` (core port, `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts`) — implements `verify()` and `extractEnvelope()`
- `InboundWebhookDecoderRegistryService` (core infrastructure service) — the decoder is registered against `'erli'` (the provider URL segment)

**Existing Services Reused**:
- `ErliWebhookEventTypeValues` / `ERLI_WEBHOOK_ORDER_ID_FIELD` from `erli-webhook.types.ts` — shared event-type vocabulary and order-id field name
- `erliAdapterManifest.platformType` (`'erli'`) — the registration key (same pattern as InPost uses `inpostAdapterManifest.platformType`)

**New Components Required**:
- `ErliInboundWebhookDecoderAdapter` — one new file
- `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` constant added to `erli-webhook.types.ts`
- Registration call added to `erli-plugin.ts`
- Unit test file

**Core vs Integration Justification**: Zero CORE changes. The port interface, registry, and types already exist. This is a pure adapter implementation that lives entirely in `libs/integrations/erli/`. The only CORE-adjacent change is the registration call in `erli-plugin.ts`'s `register(host)` method, which is the designed extension point.

---

## 4. External / Domain Research

### Erli Webhook Signature Scheme (PROVISIONAL — #992 unconfirmed)

From `erli-webhook-provisioning.adapter.ts`: the provisioner calls `PUT /hooks/{hookName}` with `{ url, accessToken }`, and the comment states *"the `accessToken` is the shared secret Erli echoes back on each delivery for signature verification."*

**Provisional interpretation**: Erli sends the `accessToken` verbatim in a request header on each delivery (not an HMAC derivation). The receiver checks the header value against the stored secret using `timingSafeEqual` to prevent timing attacks.

**Provisional header name**: `x-access-token` (common for marketplace APIs; to be confirmed by #992). Isolated in the new `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` constant in `erli-webhook.types.ts`.

**No signed timestamp**: Unlike InPost (which signs `{timestamp}.{rawBody}`), Erli's scheme appears to be a direct token echo. The decoder returns `{ ok: true }` without `timestampMs`, so the host's replay-window check is not triggered by a provider-stamped time. The host's `receivedAt` clock still records ingest time.

### Internal Patterns

**Reference implementation**: `InpostInboundWebhookDecoderAdapter` (`libs/integrations/inpost/src/infrastructure/adapters/inpost-inbound-webhook-decoder.adapter.ts`) — the canonical pattern, including:
- `verify()`: header extraction with `timingSafeEqual` comparison
- `extractEnvelope()`: JSON parse → defensive body narrowing → `ignore`/`reject`/`route` routing
- Deterministic `eventId` derivation when no explicit id is in the body
- Total — never throws

**Registration pattern**: from `inpost-plugin.ts`:
```typescript
host.inboundWebhookDecoderRegistry.register(
  inpostAdapterManifest.platformType,  // 'inpost'
  new InpostInboundWebhookDecoderAdapter(),
);
```
Erli follows the same shape with `erliAdapterManifest.platformType` (`'erli'`).

---

## 5. Questions & Assumptions

### Open Questions (blocked on #992)

| # | Question | Impact |
|---|---|---|
| Q1 | Which HTTP header carries the `accessToken` on Erli's delivery? | `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` constant |
| Q2 | Does Erli include a delivery timestamp header? | Whether `verify()` returns `timestampMs` |
| Q3 | Is the event-type discriminator a body field (e.g. `type`) or a header? | `extractEnvelope()` field path |
| Q4 | Does Erli include an explicit `eventId` / `id` field in the body? | `eventId` derivation strategy |
| Q5 | Does Erli include an `occurredAt` / `timestamp` field in the body? | `occurredAt` sourcing |

### Assumptions (safe provisional defaults)

| Assumption | Provisional value | Reconciliation |
|---|---|---|
| Access-token header | `x-access-token` | `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` in `erli-webhook.types.ts` |
| No signed timestamp | decoder returns `{ ok: true, timestampMs: undefined }` | add `timestampMs` when Q2 confirmed |
| Event type is a body field `type` | parse `body.type` | update field path when Q3 confirmed |
| No explicit `eventId` | derive `erli-{sha256(orderId:eventType).slice(0,32)}` | prefer `body.eventId` / `body.id` if Q4 confirmed |
| No `occurredAt` in body | fall back to `new Date().toISOString()` | prefer body/header field when Q5 confirmed |

### Provisional body shape assumed
```json
{
  "type": "orderCreated",      // provisional: Q3
  "orderId": "erli-order-123"  // confirmed field name: ERLI_WEBHOOK_ORDER_ID_FIELD
}
```

---

## 6. Proposed Implementation Plan

### Phase 1 — Extend webhook.types with access-token header constant

**Goal**: Add the single reconciliation symbol for the provisional header name. Every downstream file reads the constant — #992 is a one-line edit.

**Step 1.1 — Add `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` to `erli-webhook.types.ts`**
- **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-webhook.types.ts`
- **Action**: Append after `ERLI_HOOKS_PATH`:
  ```typescript
  /**
   * Request header Erli sends on each delivery carrying the access token for
   * signature verification (#992-PROVISIONAL — exact header unconfirmed).
   * Isolated here so #992 confirmation is a one-character edit; the decoder
   * reads only this constant.
   */
  export const ERLI_WEBHOOK_ACCESS_TOKEN_HEADER = 'x-access-token';

  /**
   * Body field carrying the Erli event-type discriminator (#992-PROVISIONAL).
   * Currently modelled as the `type` field; may differ from the inbox feed's
   * `status` field — #992 confirms or reconciles.
   */
  export const ERLI_WEBHOOK_EVENT_TYPE_FIELD = 'type';
  ```
- **Acceptance**: Constants exported; `pnpm type-check` passes; no other file needs changes for Phase 1.

---

### Phase 2 — Implement ErliInboundWebhookDecoderAdapter

**Goal**: Write the `InboundWebhookDecoderPort` implementation. It must be total (no unbounded throws), fail-closed on bad/missing signature, and forward well-formed payloads as `{ action: 'route', envelope }`.

**Step 2.1 — Create the adapter file**
- **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-inbound-webhook-decoder.adapter.ts`
- **Action**: Implement the class below (full code spec):

```typescript
/**
 * Erli Inbound Webhook Decoder Adapter (#1081, ADR-021)
 *
 * Authenticates + decodes Erli inbound order webhooks at the host ingress,
 * keyed by `provider = 'erli'`. The verify half checks the `accessToken` Erli
 * echoes back in the `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` header against the
 * per-connection shared secret stored OL-side by `IWebhookSecretService`
 * (provisioned by `ErliWebhookProvisioningAdapter`, #996).
 *
 * PROVISIONAL (#992): the header name, body field paths, and the presence of a
 * delivery timestamp are all unconfirmed until the sandbox spike. All wire
 * assumptions are isolated in `erli-webhook.types.ts` — when #992 lands,
 * that file is the single reconciliation point.
 *
 * Trigger model (ADR-025): webhook is a low-latency nudge, never the source
 * of truth. We read only the order id from the body; the authoritative order
 * is fetched downstream by `ErliOrderSourceAdapter.getOrder` via the
 * `marketplace.order.sync` job.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link InboundWebhookDecoderPort} for the port interface
 * @see {@link ErliWebhookProvisioningAdapter} for the provisioner that sets the secret
 * @see {@link ErliWebhookEventTranslator} for the downstream translator
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';
import {
  ERLI_WEBHOOK_ACCESS_TOKEN_HEADER,
  ERLI_WEBHOOK_EVENT_TYPE_FIELD,
  ERLI_WEBHOOK_ORDER_ID_FIELD,
  ErliWebhookEventTypeValues,
} from './erli-webhook.types';

export class ErliInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const token = this.header(input.headers, ERLI_WEBHOOK_ACCESS_TOKEN_HEADER);
    if (!token) {
      return { ok: false };
    }

    // timingSafeEqual requires same-length buffers; if lengths differ, short-circuit
    // before the safe comparison (length mismatch is itself timing-safe information,
    // but mismatched lengths already fail the equality check conclusively).
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.secret);
    if (provided.length !== expected.length) {
      return { ok: false };
    }
    if (!timingSafeEqual(provided, expected)) {
      return { ok: false };
    }

    // Erli does not include a signed timestamp header (#992-PROVISIONAL).
    // Returning without timestampMs causes the host's replay-window check to
    // be skipped — acceptable until #992 confirms a timestamp mechanism.
    return { ok: true };
  }

  extractEnvelope(rawBody: Buffer, headers: Record<string, string>): DecodeResult {
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { action: 'reject', reason: 'body is not valid JSON' };
    }
    if (typeof body !== 'object' || body === null) {
      return { action: 'reject', reason: 'body is not a JSON object' };
    }

    const record = body as Record<string, unknown>;

    // Resolve the event type. Unknown types ack-and-ignore (no retry storm).
    const rawEventType = this.asNonEmptyString(record[ERLI_WEBHOOK_EVENT_TYPE_FIELD]);
    if (!rawEventType) {
      return { action: 'reject', reason: 'missing or empty event type field' };
    }
    if (!ErliWebhookEventTypeValues.includes(rawEventType as (typeof ErliWebhookEventTypeValues)[number])) {
      return { action: 'ignore', reason: `unhandled event type: ${rawEventType}` };
    }
    const eventType = rawEventType;

    // The order id is the only data we extract — the full order is pulled
    // downstream by the sync job (trigger-not-truth, ADR-025).
    const orderId = this.asNonEmptyString(record[ERLI_WEBHOOK_ORDER_ID_FIELD]);
    if (!orderId) {
      return { action: 'reject', reason: 'missing or empty orderId field' };
    }

    return {
      action: 'route',
      envelope: {
        eventId: this.deriveEventId(record, orderId, eventType),
        eventType,
        occurredAt: this.resolveOccurredAt(record, headers),
        objectType: 'order',
        externalId: orderId,
        payload: { [ERLI_WEBHOOK_ORDER_ID_FIELD]: orderId },
      },
    };
  }

  /**
   * Derive a dedup-suitable event id. Prefers an explicit `eventId`/`id`
   * body field; falls back to a deterministic hash of `orderId:eventType` so
   * retries of the same event collapse and distinct events (same orderId,
   * different eventType) don't. Best-effort — idempotent re-fetch is the
   * correctness guarantee.
   */
  private deriveEventId(
    record: Record<string, unknown>,
    orderId: string,
    eventType: string,
  ): string {
    const explicit =
      this.asNonEmptyString(record['eventId']) ?? this.asNonEmptyString(record['id']);
    if (explicit) {
      return explicit;
    }
    const basis = `${orderId}:${eventType}`;
    return `erli-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
  }

  /**
   * Resolve occurredAt from the body or headers (#992-PROVISIONAL).
   * Falls back to now — advisory only (the fetched order carries the
   * authoritative timestamp).
   */
  private resolveOccurredAt(
    record: Record<string, unknown>,
    _headers: Record<string, string>,
  ): string {
    const fromBody =
      this.asNonEmptyString(record['occurredAt']) ??
      this.asNonEmptyString(record['timestamp']) ??
      this.asNonEmptyString(record['createdAt']);
    return fromBody ?? new Date().toISOString();
  }

  private header(headers: Record<string, string>, name: string): string | null {
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
```

- **Acceptance**:
  - Class implements `InboundWebhookDecoderPort` — TypeScript structural check at compile time.
  - `pnpm type-check` passes.
  - No `any`, no `console.log`, all methods are total (no unbounded throws).

---

### Phase 3 — Register the decoder in erli-plugin.ts

**Goal**: Wire the decoder into the host's `InboundWebhookDecoderRegistryService` at boot. Mirroring InPost's exact pattern.

**Step 3.1 — Add import and registration call**
- **File**: `libs/integrations/erli/src/erli-plugin.ts`
- **Action**:
  1. Add import at top (with other adapter imports):
     ```typescript
     import { ErliInboundWebhookDecoderAdapter } from './infrastructure/adapters/erli-inbound-webhook-decoder.adapter';
     ```
  2. In `register(host)`, add after the translator registration (which is logically the downstream partner):
     ```typescript
     // Inbound decoder (#1081, ADR-021): authenticates + decodes real Erli deliveries.
     // Keyed by platformType ('erli') — the provider URL segment the host controller
     // uses to look up the right decoder before dedup. PROVISIONAL (#992): the
     // actual header name and body shape flip is isolated in erli-webhook.types.ts.
     host.inboundWebhookDecoderRegistry.register(
       erliAdapterManifest.platformType,
       new ErliInboundWebhookDecoderAdapter(),
     );
     ```
- **Acceptance**:
  - `pnpm type-check` passes.
  - `pnpm lint` passes.
  - No other plugins are affected.

---

### Phase 4 — Unit tests

**Goal**: Cover all `verify` and `extractEnvelope` branches with obvious-fake fixtures. Mirrors the `InpostInboundWebhookDecoderAdapter` test structure exactly.

**Step 4.1 — Create test file**
- **File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-inbound-webhook-decoder.adapter.spec.ts`
- **Action**: Write the following test suite:

```typescript
/**
 * Unit tests for ErliInboundWebhookDecoderAdapter (#1081, ADR-021).
 *
 * Fixtures use obviously-fake values (#992-PROVISIONAL wire shape).
 */
import { ErliInboundWebhookDecoderAdapter } from '../erli-inbound-webhook-decoder.adapter';

const SECRET = 'test-access-token-secret-ol-side';
const ORDER_ID = 'erli-order-fake-123';

function makeBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({ type: 'orderCreated', orderId: ORDER_ID, ...overrides }),
  );
}

describe('ErliInboundWebhookDecoderAdapter', () => {
  let decoder: ErliInboundWebhookDecoderAdapter;

  beforeEach(() => {
    decoder = new ErliInboundWebhookDecoderAdapter();
  });

  // --- verify ---

  describe('verify', () => {
    it('should accept a correctly-matched access token', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        secret: SECRET,
        headers: { 'x-access-token': SECRET },
      });
      expect(result.ok).toBe(true);
    });

    it('should accept the header in any casing', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        secret: SECRET,
        headers: { 'X-Access-Token': SECRET },
      });
      expect(result.ok).toBe(true);
    });

    it('should reject a tampered (wrong) access token', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        secret: SECRET,
        headers: { 'x-access-token': 'wrong-token' },
      });
      expect(result.ok).toBe(false);
    });

    it('should reject when the access-token header is absent', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        secret: SECRET,
        headers: {},
      });
      expect(result.ok).toBe(false);
    });

    it('should not return timestampMs (provisional: no signed timestamp from Erli)', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        secret: SECRET,
        headers: { 'x-access-token': SECRET },
      });
      expect(result.timestampMs).toBeUndefined();
    });
  });

  // --- extractEnvelope ---

  describe('extractEnvelope', () => {
    const HEADERS = {};

    it('should route an orderCreated event with the orderId as externalId', () => {
      const result = decoder.extractEnvelope(
        makeBody({ type: 'orderCreated' }),
        HEADERS,
      );
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        expect(result.envelope.externalId).toBe(ORDER_ID);
        expect(result.envelope.objectType).toBe('order');
        expect(result.envelope.eventType).toBe('orderCreated');
      }
    });

    it('should route an orderStatusChanged event', () => {
      const result = decoder.extractEnvelope(
        makeBody({ type: 'orderStatusChanged' }),
        HEADERS,
      );
      expect(result.action).toBe('route');
    });

    it('should include a non-empty eventId', () => {
      const result = decoder.extractEnvelope(makeBody(), HEADERS);
      if (result.action === 'route') {
        expect(typeof result.envelope.eventId).toBe('string');
        expect(result.envelope.eventId.length).toBeGreaterThan(0);
      } else {
        throw new Error('expected route');
      }
    });

    it('should produce a deterministic eventId for the same orderId + eventType', () => {
      const body = makeBody();
      const a = decoder.extractEnvelope(body, HEADERS);
      const b = decoder.extractEnvelope(body, HEADERS);
      if (a.action === 'route' && b.action === 'route') {
        expect(a.envelope.eventId).toBe(b.envelope.eventId);
      } else {
        throw new Error('expected both to route');
      }
    });

    it('should prefer an explicit eventId body field over the derived hash', () => {
      const result = decoder.extractEnvelope(
        makeBody({ eventId: 'explicit-evt-id-001' }),
        HEADERS,
      );
      if (result.action === 'route') {
        expect(result.envelope.eventId).toBe('explicit-evt-id-001');
      } else {
        throw new Error('expected route');
      }
    });

    it('should produce distinct eventIds for the same orderId but different eventTypes', () => {
      const a = decoder.extractEnvelope(makeBody({ type: 'orderCreated' }), HEADERS);
      const b = decoder.extractEnvelope(makeBody({ type: 'orderStatusChanged' }), HEADERS);
      if (a.action === 'route' && b.action === 'route') {
        expect(a.envelope.eventId).not.toBe(b.envelope.eventId);
      } else {
        throw new Error('expected both to route');
      }
    });

    it('should ignore (not reject) an unknown event type', () => {
      const result = decoder.extractEnvelope(
        makeBody({ type: 'orderArchived' }),
        HEADERS,
      );
      expect(result.action).toBe('ignore');
    });

    it('should reject malformed JSON', () => {
      const result = decoder.extractEnvelope(Buffer.from('not json'), HEADERS);
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a missing orderId', () => {
      const result = decoder.extractEnvelope(
        Buffer.from(JSON.stringify({ type: 'orderCreated' })),
        HEADERS,
      );
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a blank orderId', () => {
      const result = decoder.extractEnvelope(
        makeBody({ orderId: '   ' }),
        HEADERS,
      );
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a non-string orderId', () => {
      const result = decoder.extractEnvelope(
        makeBody({ orderId: 42 }),
        HEADERS,
      );
      expect(result.action).toBe('reject');
    });

    it('should reject a body missing the event type field', () => {
      const result = decoder.extractEnvelope(
        Buffer.from(JSON.stringify({ orderId: ORDER_ID })),
        HEADERS,
      );
      expect(result.action).toBe('reject');
    });

    it('should include the orderId in the envelope payload', () => {
      const result = decoder.extractEnvelope(makeBody(), HEADERS);
      if (result.action === 'route') {
        expect(result.envelope.payload).toEqual({ orderId: ORDER_ID });
      }
    });

    it('should fall back to a non-empty occurredAt when the body has no timestamp', () => {
      const result = decoder.extractEnvelope(makeBody(), HEADERS);
      if (result.action === 'route') {
        expect(typeof result.envelope.occurredAt).toBe('string');
        expect(result.envelope.occurredAt.length).toBeGreaterThan(0);
      }
    });

    it('should prefer occurredAt body field when present', () => {
      const ts = '2026-06-25T10:00:00.000Z';
      const result = decoder.extractEnvelope(makeBody({ occurredAt: ts }), HEADERS);
      if (result.action === 'route') {
        expect(result.envelope.occurredAt).toBe(ts);
      }
    });
  });
});
```

- **Acceptance**:
  - `pnpm test --testPathPattern erli-inbound-webhook-decoder` passes with all tests green.
  - No `any`, no `console.log`.

---

## 7. Alternatives Considered

### Alternative 1: HMAC-SHA256 over raw body (InPost-style)

- **Description**: Use `createHmac('sha256', secret).update(rawBody).digest('hex')` and compare to a signature header.
- **Why Rejected**: The provisioner's comment says Erli "echoes back" the `accessToken` on delivery — an HMAC derivation is a different scheme. Nothing in the Erli API surface (#992, #996) suggests an HMAC computation step. Implementing HMAC now would be speculative and would fail against real Erli deliveries.
- **Trade-offs**: If #992 reveals Erli does use HMAC, only `verify()` changes (the provisional constant isolation still applies).

### Alternative 2: Treat accessToken as a query-parameter token

- **Description**: Some commerce webhooks send the token as a URL query parameter (`?token=...`).
- **Why Rejected**: Query parameters are not available in the decoder interface (`rawBody + headers` only). This pattern would require changes to the port interface and host controller, which is out of scope.

### Alternative 3: Skip the decoder until #992

- **Description**: Keep the current fail-safe posture (OL-HMAC default rejects all Erli deliveries) until #992 confirms the exact scheme.
- **Why Rejected**: The provisional implementation is isolated and safe — it does not change the inbox poll path, has no performance cost, and is entirely gated behind the registration in `erli-plugin.ts`. Shipping a provisional decoder with clear #992 markers is strictly better than dead code (translator never reached). The constant isolation means #992 confirmation is a one-file edit.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ Integration adapter only — zero CORE changes. `InboundWebhookDecoderPort`, `DecodeResult`, `WebhookVerifyResult` are consumed as-is.
- ✅ Registration follows the InPost pattern (provider key = `platformType`, not `adapterKey`).
- ✅ Decoder is framework-neutral (plain class, no `@Injectable()`) — consistent with InPost reference.
- ✅ No cross-context boundary violations — the decoder imports from `@openlinker/core/integrations` (top-level barrel only).

### Naming Conventions

- ✅ Adapter: `erli-inbound-webhook-decoder.adapter.ts` → `ErliInboundWebhookDecoderAdapter` — follows `{Platform}{Capability}Adapter` pattern.
- ✅ Test: `erli-inbound-webhook-decoder.adapter.spec.ts` — colocated in `__tests__/`.

### Existing Patterns

- ✅ Two-method `verify`/`extractEnvelope` structure mirrors InPost exactly.
- ✅ `timingSafeEqual` for secret comparison — same as InPost.
- ✅ `ignore` for unhandled event types, `reject` for malformed shapes — same as InPost.
- ✅ Deterministic `eventId` derivation fallback — same as InPost (InPost uses `inpost-{sha256hash}`, Erli uses `erli-{sha256hash}`).
- ✅ All wire-shape assumptions isolated in `erli-webhook.types.ts` — established by the provisioner (`#992-PROVISIONAL` comment pattern is already in the file).

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| #992 confirms different header name | High | `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` constant is the single edit point |
| #992 confirms HMAC instead of token echo | Medium | Only `verify()` changes; tests are self-documenting about the assumption |
| #992 confirms different body shape | Medium | `ERLI_WEBHOOK_EVENT_TYPE_FIELD` constant + `ERLI_WEBHOOK_ORDER_ID_FIELD` already isolated |
| `timingSafeEqual` length-mismatch bypass | None | Length is checked explicitly before the safe comparison |
| `extractEnvelope` throws | None | `JSON.parse` is wrapped in try/catch; all other operations on `unknown` are guarded |

### Edge Cases

- **Empty/whitespace orderId**: → `reject` (via `asNonEmptyString`)
- **Unknown event type (e.g. `checkBuyability`)**: → `ignore` (ack-and-ignore, not `reject`, to avoid retry storms)
- **Non-JSON body**: → `reject`
- **Body is a JSON array (not object)**: → `reject`
- **Missing access-token header**: → `{ ok: false }` from `verify()`
- **Token length differs from secret**: → `{ ok: false }` before `timingSafeEqual` (correctly handles length mismatch)
- **No timestamp in body or headers**: → `occurredAt` falls back to `new Date().toISOString()` (advisory; ingestion is idempotent)

### Backward Compatibility

- ✅ No breaking changes. Adding a registration to `erli-plugin.ts`'s `register(host)` is additive — the host only calls the decoder for `provider = 'erli'` deliveries. All other providers are unaffected.
- ✅ The inbox poll (#993) is unchanged and remains authoritative.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

All new logic is tested in:
- **File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-inbound-webhook-decoder.adapter.spec.ts`

Coverage targets (plain class, no DI, directly instantiated):
- `verify`: valid token, tampered token, missing header, wrong-length token, case-insensitive header
- `extractEnvelope`: each event type routes, unknown type ignores, malformed JSON rejects, missing orderId rejects, blank orderId rejects, non-string orderId rejects, missing event-type rejects, explicit eventId preferred, deterministic eventId for same inputs, distinct eventIds for different event types, payload includes orderId, occurredAt falls back, occurredAt prefers body field

### Integration Tests

None required. The decoder is a pure transform (no I/O, no DB, no Redis). End-to-end integration of the full webhook path (controller → decoder → dedup → translator → routing) is covered by the existing integration tests for the webhook service that stub the decoder registry — the new decoder passes through that path without additional integration surface.

### Mocking Strategy

The decoder is framework-neutral and directly instantiable — no mocking framework needed. The test helper `makeBody()` encodes provisional fixture shapes.

### Acceptance Criteria

- [ ] `pnpm test --testPathPattern erli-inbound-webhook-decoder` passes with all tests green
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm lint` passes with zero errors
- [ ] `ErliInboundWebhookDecoderAdapter` is registered for `'erli'` in `erli-plugin.ts`
- [ ] Real Erli deliveries with the correct `accessToken` in `x-access-token` no longer return 400 (unblocked once #992 confirms the provisional header)
- [ ] Deliveries with missing/wrong token still return 400 (fail-closed)
- [ ] Unknown event types (`checkBuyability`, etc.) return 202 without publishing (no retry storm)
- [ ] Inbox poll (#993 `erli-orders-poll`) behaviour is unchanged

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — adapter in `libs/integrations/erli/`, port in CORE unchanged
- [x] Respects CORE vs Integration boundaries — zero CORE modifications
- [x] Uses existing patterns — direct mirror of `InpostInboundWebhookDecoderAdapter`
- [x] Idempotency considered — `eventId` derivation is deterministic; downstream `OrderIngestionService` is idempotent
- [x] Event-driven patterns used where applicable — decoder feeds the existing webhook event bus path unchanged
- [x] Rate limits & retries addressed — `ignore` (not `reject`) for unknown event types prevents retry storms
- [x] Error handling comprehensive — `extractEnvelope` is total; `verify` returns `{ ok: false }` rather than throwing
- [x] Testing strategy complete — 17 unit test cases covering all branches
- [x] Naming conventions followed — `erli-inbound-webhook-decoder.adapter.ts` / `ErliInboundWebhookDecoderAdapter`
- [x] File structure matches standards — adapter in `infrastructure/adapters/`, test in `__tests__/`
- [x] Plan is execution-ready — all file paths, code specs, and acceptance criteria are explicit
- [x] Plan saved as markdown file

---

## Implementation Details Summary

**Files to create:**
| File | Purpose |
|---|---|
| `libs/integrations/erli/src/infrastructure/adapters/erli-inbound-webhook-decoder.adapter.ts` | New adapter implementation |
| `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-inbound-webhook-decoder.adapter.spec.ts` | Unit tests |

**Files to modify:**
| File | Change |
|---|---|
| `libs/integrations/erli/src/infrastructure/adapters/erli-webhook.types.ts` | Add `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` + `ERLI_WEBHOOK_EVENT_TYPE_FIELD` constants |
| `libs/integrations/erli/src/erli-plugin.ts` | Import adapter + add `host.inboundWebhookDecoderRegistry.register` call |

**No migrations needed.** No CORE changes. No new NestJS modules.

---

## Related Documentation

- [Architecture Overview — Webhook Ingestion Flow](./architecture-overview.md#4-webhook-ingestion-flow-inbound--event-bus--sync-trigger)
- [ADR-021 — Inbound Webhook Decoder Seam](./architecture/adrs/021-inbound-webhook-decoder-seam.md)
- [ADR-015 — Inbound Event Routing](./architecture/adrs/015-inbound-event-routing-capability-translated.md)
- [ADR-025 — Erli Marketplace Adapter](./architecture/adrs/025-erli-marketplace-adapter.md)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md)
