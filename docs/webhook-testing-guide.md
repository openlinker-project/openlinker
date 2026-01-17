# Webhook Testing Guide

This guide explains how to test the webhook ingestion implementation manually and via integration tests.

## Prerequisites

1. **Application Running**: The API should be running (`pnpm start:dev`)
2. **Services Running**: PostgreSQL and Redis should be running (`pnpm dev:stack:up`)
3. **Connection Created**: You need an active connection in the database

## Manual Testing

### Step 1: Create a Test Connection

First, create a connection via the API:

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

Save the `connectionId` from the response (e.g., `123e4567-e89b-12d3-a456-426614174000`).

### Step 2: Set Webhook Secret

Set the webhook secret as an environment variable:

```bash
# For connection-specific secret
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__<CONNECTION_ID>=your-secret-key-here

# Or for provider-level secret (fallback)
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP=your-secret-key-here
```

**Note**: Replace `<CONNECTION_ID>` with your actual connection ID (uppercase, no dashes).

### Step 3: Generate a Valid Signature

The signature is computed as: `HMAC_SHA256(secret, timestamp + '.' + rawBody)`

Here's a Node.js script to generate a signature:

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
  object: {
    type: 'product',
    externalId: '12345'
  },
  payload: {
    name: 'Test Product',
    price: 29.99
  }
});

const signedPayload = timestamp + '.' + rawBody;
const signature = crypto.createHmac('sha256', secret)
  .update(signedPayload)
  .digest('hex');

console.log('Timestamp:', timestamp);
console.log('Signature:', `sha256=${signature}`);
console.log('Raw Body:', rawBody);
```

Run it:
```bash
node generate-signature.js
```

### Step 4: Send Test Webhook Request

Use the timestamp and signature from Step 3:

```bash
curl -X POST http://localhost:3000/webhooks/prestashop/<CONNECTION_ID> \
  -H "Content-Type: application/json" \
  -H "X-OpenLinker-Timestamp: <TIMESTAMP>" \
  -H "X-OpenLinker-Signature: sha256=<SIGNATURE>" \
  -d '{
    "schemaVersion": 1,
    "eventId": "test-event-123",
    "eventType": "product.saved",
    "occurredAt": "2025-01-01T12:00:00.000Z",
    "object": {
      "type": "product",
      "externalId": "12345"
    },
    "payload": {
      "name": "Test Product",
      "price": 29.99
    }
  }'
```

**Expected Response**: `202 Accepted` (no body)

### Step 5: Verify Results

#### Check Application Logs

Look for log messages like:
- `Published inbound webhook event test-event-123 to stream events.inbound.webhooks`
- `Processed webhook event test-event-123 and enqueued job master.product.syncByExternalId`

#### Check Redis Streams

```bash
# Connect to Redis
redis-cli

# Check events stream
XREAD STREAMS events.inbound.webhooks 0

# Check jobs stream
XREAD STREAMS jobs.sync 0

# Check consumer group
XINFO GROUPS events.inbound.webhooks
```

#### Check Deduplication Keys

```bash
# In Redis CLI
KEYS webhook:prestashop:*

# Should see keys like:
# webhook:prestashop:<connectionId>:test-event-123
```

## Integration Testing

### Running Integration Tests

```bash
# Run all integration tests (from root)
pnpm test:integration

# Or from API package
pnpm --filter @openlinker/api test:integration

# Run specific webhook integration test
pnpm --filter @openlinker/api test:integration webhook-ingestion.int-spec.ts
```

**Note**: Integration tests require Docker to be running (uses Testcontainers for PostgreSQL and Redis).

### Integration Tests

Integration tests are located in `apps/api/test/integration/webhook-ingestion.int-spec.ts` and include:

- Valid webhook acceptance and event publishing
- Invalid signature rejection
- Duplicate event prevention
- Raw body signature correctness (whitespace/property order)
- Handler crash/retry with job dedup

### Example Integration Test Structure

The existing test file (`webhook-ingestion.int-spec.ts`) follows this structure:

```typescript
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import * as crypto from 'crypto';

describe('Webhook Ingestion', () => {
  let harness: IntegrationTestHarness;
  const webhookSecret = 'test-secret-key';

  beforeAll(async () => {
    harness = await getTestHarness();
    process.env.OPENLINKER_WEBHOOK_SECRET__PRESTASHOP = webhookSecret;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should accept valid webhook and publish event', async () => {
    // 1. Create test connection
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      status: 'active',
    });

    // 2. Prepare webhook payload
    const payload = {
      schemaVersion: 1,
      eventId: 'test-event-123',
      eventType: 'product.saved',
      occurredAt: new Date().toISOString(),
      object: {
        type: 'product',
        externalId: '12345',
      },
      payload: {
        name: 'Test Product',
      },
    };

    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = Date.now().toString();
    const signedPayload = timestamp + '.' + rawBody.toString();
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');

    // 3. Send webhook request
    await harness
      .getHttp()
      .post(`/webhooks/prestashop/${connection.id}`)
      .set('X-OpenLinker-Timestamp', timestamp)
      .set('X-OpenLinker-Signature', `sha256=${signature}`)
      .send(payload)
      .expect(202);

    // 4. Verify event in Redis stream
    const redisClient = harness.getRedisClient();
    if (!redisClient) {
      throw new Error('Redis client not available');
    }

    const events = await redisClient.xRead(
      [{ key: 'events.inbound.webhooks', id: '0' }],
      { COUNT: 10 },
    );

    expect(events).toBeDefined();
    expect(events.length).toBeGreaterThan(0);
    
    // Find our event
    const ourEvent = events[0].messages.find(
      (msg) => msg.message.eventId === 'test-event-123',
    );
    expect(ourEvent).toBeDefined();
  });

  it('should reject invalid signature', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      status: 'active',
    });

    const payload = {
      schemaVersion: 1,
      eventId: 'test-event-456',
      eventType: 'product.saved',
      occurredAt: new Date().toISOString(),
      object: { type: 'product', externalId: '12345' },
    };

    await harness
      .getHttp()
      .post(`/webhooks/prestashop/${connection.id}`)
      .set('X-OpenLinker-Timestamp', Date.now().toString())
      .set('X-OpenLinker-Signature', 'sha256=invalid-signature')
      .send(payload)
      .expect(401);
  });

  it('should prevent duplicate events', async () => {
    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      status: 'active',
    });

    const payload = {
      schemaVersion: 1,
      eventId: 'duplicate-test-event',
      eventType: 'product.saved',
      occurredAt: new Date().toISOString(),
      object: { type: 'product', externalId: '12345' },
    };

    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(timestamp + '.' + rawBody.toString())
      .digest('hex');

    // First request - should succeed
    await harness
      .getHttp()
      .post(`/webhooks/prestashop/${connection.id}`)
      .set('X-OpenLinker-Timestamp', timestamp)
      .set('X-OpenLinker-Signature', `sha256=${signature}`)
      .send(payload)
      .expect(202);

    // Second request with same eventId - should also succeed (202) but not publish duplicate
    await harness
      .getHttp()
      .post(`/webhooks/prestashop/${connection.id}`)
      .set('X-OpenLinker-Timestamp', timestamp)
      .set('X-OpenLinker-Signature', `sha256=${signature}`)
      .send(payload)
      .expect(202);

    // Verify only one event in stream
    const redisClient = harness.getRedisClient();
    if (!redisClient) {
      throw new Error('Redis client not available');
    }

    const events = await redisClient.xRead(
      [{ key: 'events.inbound.webhooks', id: '0' }],
      { COUNT: 10 },
    );

    const duplicateEvents = events[0].messages.filter(
      (msg) => msg.message.eventId === 'duplicate-test-event',
    );
    expect(duplicateEvents.length).toBe(1);
  });
});
```

## Common Issues

### 401 Unauthorized

- **Invalid signature**: Check that the signature is computed correctly with the exact raw body bytes
- **Wrong secret**: Verify the environment variable name matches the connection ID (uppercase, no dashes)
- **Timestamp out of window**: Ensure timestamp is within ±5 minutes of current time

### 404 Not Found

- **Connection not found**: Verify the connection ID exists and is active
- **Provider mismatch**: Ensure `platformType` matches the provider in the URL

### 400 Bad Request

- **Missing headers**: Ensure both `X-OpenLinker-Timestamp` and `X-OpenLinker-Signature` are present
- **Invalid payload**: Check that the JSON payload matches the DTO structure

### Events Not Appearing in Stream

- **Handler not running**: Check application logs for consumer group initialization
- **Consumer group not created**: Look for `Created consumer group webhook-handler` in logs
- **Redis connection**: Verify Redis is accessible and streams are enabled

## Debugging Tips

1. **Enable Debug Logging**: Set `LOG_LEVEL=debug` in environment
2. **Check Redis Streams**: Use `XINFO STREAM events.inbound.webhooks` to inspect stream
3. **Monitor Consumer Group**: Use `XINFO GROUPS events.inbound.webhooks` to see consumer status
4. **Check Dedup Keys**: Use `KEYS webhook:*` to see deduplication state

## Next Steps

After manual testing works:
1. Write integration tests (see example above)
2. Test error scenarios (invalid signature, replay protection, etc.)
3. Test handler crash/retry scenarios
4. Test with multiple concurrent requests

