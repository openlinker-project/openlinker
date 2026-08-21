# Webhook Ingestion Overview

## Introduction

OpenLinker's webhook ingestion system provides a secure, scalable way to receive events from external e-commerce platforms (e.g., PrestaShop, Allegro) and trigger synchronization jobs. The system is designed for **fast webhook processing** with signature verification, replay protection, and deduplication.

## Architecture

```
External System (PrestaShop)
    │
    │ POST /webhooks/:provider/:connectionId
    │ (with X-OpenLinker-Timestamp and X-OpenLinker-Signature headers)
    ▼
┌─────────────────────────────────────┐
│  Webhook Controller → Service       │
│  - Verifies signature, then replay  │
│  - Decodes to the neutral envelope  │
│  - ROUTES synchronously (translator │
│    + capability-gated policy)       │
└─────────────────────────────────────┘
    │
    │ one Postgres transaction
    ▼
┌─────────────────────────────────────┐
│  THE GATE                           │
│  INSERT sync_jobs (queued)          │
│  + INSERT webhook_deliveries        │
│    in its FINAL status              │
│  (a replay conflicts → 202)         │
└─────────────────────────────────────┘
    │
    │ committed work row
    ▼
┌─────────────────────────────────────┐
│  Worker: SyncJobRunner              │
│  1 s poll of sync_jobs              │
│  (FOR UPDATE SKIP LOCKED)           │
└─────────────────────────────────────┘
    │
    │ pull-based sync via adapter APIs
    ▼   (the webhook payload is never the source of truth)
```

> **Since #2280** ([ADR-049](../architecture/adrs/049-durability-spine-and-domain-event-contract.md)
> decision 1) this path touches **no Redis stream at all** — no
> `events.inbound.webhooks` publish, no `jobs.sync` entry, no `jobdedup:*` key.
> The durable write is hop one. The stream sections further down describe the
> remaining, non-webhook producers of `jobs.sync` and the legacy stream that a
> one-shot boot drain still empties after an upgrade.

## Key Features

### 1. **Signature Verification**

All webhook requests must include:
- `X-OpenLinker-Timestamp`: Unix timestamp in milliseconds
- `X-OpenLinker-Signature`: HMAC SHA256 signature

**Signature Scheme**:
```
signedPayload = timestamp + '.' + rawBody
signature = HMAC_SHA256(secret, signedPayload)
```

The signature is computed using the **exact raw bytes** of the JSON payload (not re-stringified), ensuring that whitespace and property order changes are detected.

### 2. **Replay Protection**

Timestamps are validated against a configurable skew window (default: ±5 minutes). Requests with timestamps outside this window are rejected to prevent replay attacks.

### 3. **Deduplication**

Deduplication is **Postgres-authoritative** (ADR-005): the unique constraint on
`webhook_deliveries (provider, connectionId, eventId)` is the gate, and a replay
short-circuits to the same idempotent 202.

A Redis mark (`processing` / `done`) is kept as a fast-path observability hint
only. Since #2280 it is **best-effort**: a Redis outage cannot fail a webhook
whose durable write is about to commit, and nothing is deleted to "allow
retries" — see step 5.

### 4. **Routing (at ingress)**

Since #2280 the connection's translator and the capability-gated
`InboundRoutingPolicy` run **synchronously**, so the jobType, payload and
idempotency key are known before anything is written. Nothing is published to a
stream on this path.

Deterministic faults — connection missing or disabled, no translator for the
adapter, an undecodable or translator-throwing payload, a capability-ungated
domain — resolve to `unroutable` and are recorded as a durable `deadlettered`
delivery row carrying the reason. A transient fault (e.g. the connection read
failing) answers **503** so the source retries, and writes nothing.

### 5. **The gate: one transaction**

The `sync_jobs` work row and the `webhook_deliveries` row commit in the SAME
Postgres transaction (ADR-049 decision 1), with the delivery written in its
final status (`job_enqueued` / `received` for pings / `deadlettered`). The
worker's 1-second poll of `sync_jobs` picks the job up — there is no queue hop
that can lose it, so no compensating delete is needed: a pre-commit failure
rolls both rows back, and after commit there is nothing left to undo.

## API Endpoint

### `POST /webhooks/:provider/:connectionId`

**Headers**:
- `Content-Type: application/json` (required)
- `X-OpenLinker-Timestamp: <timestamp>` (required)
- `X-OpenLinker-Signature: sha256=<hex>` (required)

**Request Body**:
```json
{
  "schemaVersion": 1,
  "eventId": "unique-event-id",
  "eventType": "product.saved",
  "occurredAt": "2025-01-01T12:00:00.000Z",
  "object": {
    "type": "product",
    "externalId": "12345"
  },
  "payload": {
    "name": "Product Name",
    "price": 29.99
  }
}
```

**Response**:
- `202 Accepted`: Webhook accepted and queued for processing
- `400 Bad Request`: Invalid payload or malformed data
- `401 Unauthorized`: Invalid signature or timestamp out of window
- `404 Not Found`: Connection not found or disabled
- `413 Payload Too Large`: Request body exceeds 256KB limit

## Configuration

### Webhook Secrets

Webhook secrets are configured via environment variables:

**Connection-specific** (preferred):
```bash
OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__<CONNECTION_ID>=your-secret-key
```

**Provider-level** (fallback):
```bash
OPENLINKER_WEBHOOK_SECRET__PRESTASHOP=your-secret-key
```

**Note**: Connection IDs in environment variable names should be uppercase and without dashes.

### Timestamp Skew Window

Default: ±5 minutes (300,000ms). Can be configured in `WebhookAuthService`.

## Event Types

Supported event types (examples):
- `product.saved` - Product created or updated
- `stock.changed` - Inventory level changed
- `order.created` - New order created
- `order.status_changed` - Order status updated

Event types follow the pattern: `{category}.{action}` (lowercase, dot-separated).

## Streams

### `events.inbound.webhooks`

Inbound webhook events stream. Messages contain:
- `eventId`: Unique event identifier
- `eventType`: Event type (namespaced as `inbound.webhook.{type}`)
- `payloadJson`: Stringified JSON payload
- `metadataJson`: Stringified JSON metadata (includes schemaVersion, provider, connectionId)
- `occurredAt`: ISO 8601 timestamp when event occurred
- `publishedAt`: ISO 8601 timestamp when event was published

### `jobs.sync`

Sync job requests stream. Messages contain:
- `jobType`: Job type (e.g., `master.product.syncByExternalId`)
- `connectionId`: Connection identifier
- `payloadJson`: Stringified JSON payload
- `idempotencyKey`: Idempotency key for deduplication
- `createdAt`: ISO 8601 timestamp when job was created

## Consumer Groups

### `webhook-handler`

Consumer group for processing inbound webhook events:
- **Group Name**: `webhook-handler`
- **Consumer Name**: `webhook-handler-{pid}` (process ID)
- **Stream**: `events.inbound.webhooks`
- **Behavior**: Reads new messages (`>`), ACKs after successful job enqueue

## Error Handling

### Webhook Processing Errors

- **Signature Verification Failure**: Returns `401 Unauthorized`
- **Timestamp Out of Window**: Returns `401 Unauthorized` (replay protection)
- **Connection Not Found**: Returns `404 Not Found`
- **Connection Disabled**: Returns `404 Not Found`
- **Publish Failure**: Returns `500 Internal Server Error` (processing marker cleared for retry)
- **Duplicate Event**: Returns `202 Accepted` (no duplicate publish)

### Handler Errors

- **Job Enqueue Failure**: Message not ACKed, will be re-delivered
- **Handler Crash**: Pending messages remain in PEL, processed on restart
- **Idempotency Key Collision**: Job enqueue skipped, existing job ID returned

## Monitoring

### Logs

Key log messages:
- `Processing webhook: provider=..., connectionId=..., eventId=...`
- `Published webhook event: ... messageId=...`
- `Duplicate webhook event detected: ...`
- `Invalid webhook signature: ...`
- `Failed to process webhook: ...`

### Metrics (Future)

- Webhook request rate
- Signature verification failures
- Duplicate event rate
- Handler processing latency
- Job enqueue rate

## Security Considerations

1. **Secrets Management**: Current implementation uses environment variables (stub). Production should use a secrets manager (e.g., Vault).

2. **Signature Verification**: Uses constant-time comparison (`timingSafeEqual`) to prevent timing attacks.

3. **Replay Protection**: Timestamp validation prevents replay attacks within the skew window.

4. **Rate Limiting**: Not implemented in MVP. Consider adding per-connection/IP rate limiting for production.

5. **Payload Size Limits**: 256KB maximum payload size enforced.

## Future Enhancements

- [ ] Full Sync Manager with DB-backed job persistence
- [ ] Production secret provider (Vault integration)
- [ ] Rate limiting per connection/IP
- [ ] Webhook retry logic
- [ ] Webhook monitoring dashboard
- [ ] Multi-provider support (beyond PrestaShop)
- [ ] Dead-letter queue for failed events
- [ ] Metrics and alerting

---

## Testing webhooks

### Prerequisites

1. API running (`pnpm start:dev:api`)
2. Postgres and Redis up (`pnpm dev:stack:up`)
3. An active connection (any platform that supports webhook ingestion — currently PrestaShop)

### Manual testing

**1. Create a test connection**

```bash
curl -X POST http://localhost:3000/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test PrestaShop Connection",
    "platformType": "prestashop",
    "adapterKey": "prestashop.webservice.v1",
    "status": "active",
    "credentials": {
      "apiUrl": "https://example.com/api",
      "apiKey": "test-key"
    }
  }'
```

Save the `connectionId` from the response.

**2. Set the webhook secret**

```bash
# Connection-scoped (preferred)
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__<CONNECTION_ID>=your-secret-key-here

# Or provider-level fallback
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP=your-secret-key-here
```

Replace `<CONNECTION_ID>` with your connection ID (uppercase, no dashes).

**3. Generate a valid signature**

Signature scheme: `HMAC_SHA256(secret, timestamp + '.' + rawBody)`. The raw body must match byte-for-byte what's sent on the wire (preserving whitespace and property order).

```javascript
// generate-signature.js
const crypto = require('crypto');

const secret = process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP || 'your-secret-key-here';
const timestamp = Date.now().toString();
const rawBody = JSON.stringify({
  schemaVersion: 1,
  eventId: 'test-event-123',
  eventType: 'product.saved',
  occurredAt: new Date().toISOString(),
  object: { type: 'product', externalId: '12345' },
  payload: { name: 'Test Product', price: 29.99 },
});

const signedPayload = timestamp + '.' + rawBody;
const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

console.log('Timestamp:', timestamp);
console.log('Signature:', `sha256=${signature}`);
console.log('Raw Body:', rawBody);
```

**4. Send the request**

```bash
curl -X POST http://localhost:3000/webhooks/prestashop/<CONNECTION_ID> \
  -H "Content-Type: application/json" \
  -H "X-OpenLinker-Timestamp: <TIMESTAMP>" \
  -H "X-OpenLinker-Signature: sha256=<SIGNATURE>" \
  -d '<RAW_BODY_FROM_STEP_3>'
```

Expected response: `202 Accepted` (no body).

**5. Verify**

Look in the API logs for:

- `Published inbound webhook event test-event-123 to stream events.inbound.webhooks`
- `Processed webhook event test-event-123 and enqueued job master.product.syncByExternalId`

Inspect Redis:

```bash
redis-cli
XREAD STREAMS events.inbound.webhooks 0   # the inbound event
XREAD STREAMS jobs.sync 0                  # the enqueued sync job
XINFO GROUPS events.inbound.webhooks       # consumer group state
KEYS webhook:prestashop:*                  # deduplication keys
```

### Integration tests

Webhook integration tests live at `apps/api/test/integration/webhook-ingestion.int-spec.ts` and cover:

- valid webhook acceptance and event publishing,
- invalid-signature rejection,
- duplicate-event prevention (deduplication semantics),
- raw-body signature correctness (whitespace / property order),
- handler crash / retry with job-level dedup.

Run them with:

```bash
pnpm test:integration                                                # all integration tests
pnpm --filter @openlinker/api test:integration webhook-ingestion     # webhook only
```

Requires Docker — see [Testing Guide](../testing-guide.md) for the Testcontainers setup.

A representative test shape:

```typescript
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import * as crypto from 'crypto';

describe('Webhook Ingestion', () => {
  let harness;
  const webhookSecret = 'test-secret-key';

  beforeAll(async () => {
    harness = await getTestHarness();
    process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = webhookSecret;
  });

  afterEach(async () => { await resetTestHarness(); });
  afterAll(async () => { await teardownTestHarness(); });

  it('should accept valid webhook and publish event', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      status: 'active',
    });

    const payload = {
      schemaVersion: 1,
      eventId: 'test-event-123',
      eventType: 'product.saved',
      occurredAt: new Date().toISOString(),
      object: { type: 'product', externalId: '12345' },
      payload: { name: 'Test Product' },
    };

    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(timestamp + '.' + rawBody.toString())
      .digest('hex');

    await harness
      .getHttp()
      .post(`/webhooks/prestashop/${connection.id}`)
      .set('X-OpenLinker-Timestamp', timestamp)
      .set('X-OpenLinker-Signature', `sha256=${signature}`)
      .send(payload)
      .expect(202);

    // ... assertions against events.inbound.webhooks stream
  });
});
```

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` | Signature mismatch (raw body bytes differ), wrong secret env var name, or timestamp outside the ±5-minute skew window |
| `404 Not Found` | Connection ID doesn't exist, is disabled, or the URL provider doesn't match `connection.platformType` |
| `400 Bad Request` | Missing `X-OpenLinker-Timestamp` / `X-OpenLinker-Signature` header, or payload doesn't match the expected DTO |
| Events not landing in the stream | Handler consumer group not initialized; check API logs for `Created consumer group webhook-handler`. Verify Redis is reachable. |

Debugging:

- `LOG_LEVEL=debug` for verbose webhook tracing
- `XINFO STREAM events.inbound.webhooks` to inspect stream state
- `XINFO GROUPS events.inbound.webhooks` for consumer status
- `KEYS webhook:*` for dedup state

---

## Related Documentation

- [PrestaShop Webhook Integration](./prestashop.md)
- [Architecture Overview](../architecture-overview.md)
- [Testing Guide](../testing-guide.md)
- [Engineering Standards](../engineering-standards.md)

