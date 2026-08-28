# PrestaShop Webhook Integration

## Overview

This guide explains how to configure and use PrestaShop webhooks with OpenLinker. PrestaShop webhooks allow real-time synchronization of products, inventory, and orders.

## Prerequisites

1. **PrestaShop Installation**: PrestaShop 1.7+ with webhook module installed
2. **OpenLinker Connection**: Active PrestaShop connection configured in OpenLinker
3. **Webhook Secret**: Shared secret configured in both PrestaShop and OpenLinker

## Configuration

### 1. Create Connection in OpenLinker

```bash
POST /connections
{
  "name": "My PrestaShop Store",
  "platformType": "prestashop",
  "adapterKey": "prestashop.webservice.v1",
  "status": "active",
  "credentials": {
    "apiUrl": "https://your-store.com/api",
    "apiKey": "your-api-key"
  }
}
```

Save the `connectionId` from the response.

### 2. Configure Webhook Secret

Set the webhook secret as an environment variable:

```bash
# Connection-specific (recommended)
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__<CONNECTION_ID>=your-secret-key

# Or provider-level (fallback)
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP=your-secret-key
```

**Note**: Replace `<CONNECTION_ID>` with your actual connection ID (uppercase, no dashes).

### 3. Install PrestaShop Webhook Module

Install the OpenLinker module in your PrestaShop instance:

**For detailed installation instructions**, see: [PrestaShop Module README](../../apps/prestashop-module/openlinker/README.md)

**Quick Start**:
1. Upload module ZIP to PrestaShop (or use bind-mount for development)
2. Install module via PrestaShop backoffice: **Modules → Module Manager**
3. Configure module settings (see module README for details)

### 4. Configure PrestaShop Webhook Module

In your PrestaShop webhook module configuration:

- **Webhook URL**: `https://your-openlinker-instance.com/webhooks/prestashop/<CONNECTION_ID>`
- **Secret Key**: Same secret as configured in OpenLinker
- **Events**: Select events to subscribe to (see Supported Events below)

## Supported Events

### Product Events

#### `product.saved`
Triggered when a product is created or updated.

**Payload**:
```json
{
  "schemaVersion": 1,
  "eventId": "prestashop-product-12345",
  "eventType": "product.saved",
  "occurredAt": "2025-01-01T12:00:00.000Z",
  "object": {
    "type": "product",
    "externalId": "12345"
  },
  "payload": {
    "name": "Product Name",
    "reference": "PROD-001",
    "price": 29.99
  }
}
```

**Result**: Triggers `master.product.syncByExternalId` job to fetch full product data via PrestaShop WebService API.

#### `product.deleted`
Triggered when a product is deleted (PrestaShop's `actionProductDelete` hook).
On a multistore install the hook fires only once the product is gone from every
shop, so a delete in one shop does not report a deletion the catalogue has not
made yet.

**Payload**:
```json
{
  "schemaVersion": 1,
  "eventId": "prestashop-product-12345",
  "eventType": "product.deleted",
  "occurredAt": "2025-01-01T12:00:00.000Z",
  "object": {
    "type": "product",
    "externalId": "12345"
  }
}
```

**Result**: Triggers the same `master.product.syncByExternalId` job. The webhook
is a trigger, not the deletion itself - the shop answering "no such product" is
the authoritative signal, which stales the product's variants, emits
`master.product.stale` and pauses the offers on every marketplace.

Without this event a deletion reached OpenLinker only through the hourly
deletion-audit pass (`master.product.reconcile`), which walks the catalogue a
page at a time, so on a large shop a deleted product kept selling for as long as
the walk took to reach it. The audit pass is unchanged and stays the backstop
for a lost or undelivered webhook.

### Inventory Events

#### `stock.changed`
Triggered when product stock level changes.

**Payload**:
```json
{
  "schemaVersion": 1,
  "eventId": "prestashop-stock-12345",
  "eventType": "stock.changed",
  "occurredAt": "2025-01-01T12:00:00.000Z",
  "object": {
    "type": "stock",
    "externalId": "12345"
  },
  "payload": {
    "quantity": 100
  }
}
```

**Result**: Triggers `prestashop.inventory.syncByExternalId` job to sync inventory levels.

### Order Events

#### `order.created`
Triggered when a new order is created.

**Payload**:
```json
{
  "schemaVersion": 1,
  "eventId": "prestashop-order-67890",
  "eventType": "order.created",
  "occurredAt": "2025-01-01T12:00:00.000Z",
  "object": {
    "type": "order",
    "externalId": "67890"
  },
  "payload": {
    "total": 99.99,
    "currency": "EUR"
  }
}
```

**Result**: Triggers `prestashop.order.syncByExternalId` job to fetch full order data.

#### `order.status_changed`
Triggered when order status changes.

**Payload**:
```json
{
  "schemaVersion": 1,
  "eventId": "prestashop-order-status-67890",
  "eventType": "order.status_changed",
  "occurredAt": "2025-01-01T12:00:00.000Z",
  "object": {
    "type": "order",
    "externalId": "67890"
  },
  "payload": {
    "status": "shipped"
  }
}
```

**Result**: Triggers `prestashop.order.syncByExternalId` job to sync order status.

## Webhook Signature Generation

PrestaShop webhook module must generate signatures using the same scheme as OpenLinker:

```javascript
const crypto = require('crypto');

function generateSignature(secret, timestamp, rawBody) {
  const signedPayload = timestamp + '.' + rawBody;
  return crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
}

// Usage
const timestamp = Date.now().toString();
const rawBody = JSON.stringify(payload);
const signature = generateSignature(secret, timestamp, rawBody);

// Headers
headers['X-OpenLinker-Timestamp'] = timestamp;
headers['X-OpenLinker-Signature'] = `sha256=${signature}`;
```

## Testing

### Manual Test

1. **Generate signature**:
   ```bash
   node scripts/generate-webhook-signature.js your-secret-key
   ```

2. **Send test webhook**:
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
       }
     }'
   ```

3. **Verify**:
   - Check application logs for "Published webhook event"
   - Check Redis stream: `XREAD STREAMS events.inbound.webhooks 0`
   - Check job queue: `XREAD STREAMS jobs.sync 0`

## Event Deduplication

### Why Multiple Hook Fires Occur

PrestaShop's `actionProductSave` hook (and other hooks) can fire **multiple times** during a single product save operation. This is expected PrestaShop behavior, not a bug.

**Common scenarios**:
- Product saved for multiple languages (2 languages = 2+ hook fires)
- Product saved for multiple shops (multi-shop setup)
- Product saved in multiple phases (main record, attributes, categories, stock, images, SEO)
- Hook called from multiple places in PrestaShop core code

**Example**: Saving a product with 2 languages can trigger the hook **6 times** within the same second, all for the same product ID.

### How Deduplication Works

The PrestaShop webhook module coalesces repeat hook fires. Coalescing is keyed on queue state, not on a clock (#2603):

1. **Subject-derived dedup key**: every outbox row carries a `dedup_key` over Provider + Connection ID + Event Type + Object Type + External ID. No timestamp goes into it.

2. **Database-level coalescing**: `INSERT IGNORE` plus a unique constraint on `dedup_key` drops a repeat fire while the first row is still queued.

3. **The key is released when the row leaves the queue**: the repository sets `dedup_key` to `NULL` when a row is claimed for delivery, when it is delivered, and when it fails for good. MySQL treats `NULL` as distinct in a unique index, so history never blocks a new event.

**Result**: even if a hook fires 6 times in one second, only **1 event** is created and sent to OpenLinker. A *later* change to the same object always gets its own row, whatever the cron cadence.

**Event IDs are unique per row and must stay that way.** OpenLinker keys its own durable replay protection on `(provider, connection_id, event_id)`, so reusing an id across two rows would make the second real delivery look like a replay and be discarded. The id is generated once at enqueue time and stored on the row, which is what makes a *retry* of the same delivery recognisable as a replay.

**The key covers the subject, not the payload.** Two `order.status_changed` fires while a row is queued deliver only the first `newStatusId`. That is correct under "the webhook is a trigger, the pull is authoritative" - the sync job re-reads current shop state.

### Verification

To verify deduplication is working:

```sql
-- At most one queued row per subject (should return 0 rows)
SELECT dedup_key, COUNT(*) as count
FROM ps_openlinker_webhook_outbox
WHERE dedup_key IS NOT NULL
GROUP BY dedup_key
HAVING count > 1;

-- Check events for a specific product (one row per save operation)
SELECT id, event_type, external_id, status, dedup_key, created_at
FROM ps_openlinker_webhook_outbox
WHERE external_id = '23' AND event_type = 'product.saved'
ORDER BY created_at DESC;
```

**Expected**: one event per product save operation, even if the hook fired multiple times. Rows that have already been delivered or have failed for good show `dedup_key = NULL`.

## Troubleshooting

### 401 Unauthorized

**Possible causes**:
- Invalid signature (check secret key matches)
- Timestamp out of window (check system clock sync)
- Signature computed on wrong body (must use exact raw bytes)

**Solution**: Verify signature generation matches OpenLinker's scheme exactly.

### 404 Not Found

**Possible causes**:
- Connection ID doesn't exist
- Connection is disabled
- Provider mismatch (URL says `prestashop` but connection is `allegro`)

**Solution**: Check connection exists and is active with correct `platformType`.

### Events Not Processing

**Possible causes**:
- Handler not running (check application logs)
- Consumer group not created (check logs for "Created consumer group")
- Redis connection issues

**Solution**: Check application logs and Redis connectivity.

### Duplicate Events in Database

Two rows for the same object are normal when the change really happened twice. Investigate only if a single save produced several rows.

**Possible causes**:
- The `dedup_key` column or its unique index is missing (the 1.3.0 upgrade did not run)
- `INSERT IGNORE` is no longer used in `OutboxRepository::enqueueEvent()`

**Solution**:
1. Verify the schema: `SHOW CREATE TABLE ps_openlinker_webhook_outbox;` - both `event_id` and `dedup_key` must carry a unique key
2. Do **not** make event IDs deterministic. They are unique per row on purpose; a reused id is discarded by OpenLinker as a replay
3. Verify `INSERT IGNORE` is being used in `OutboxRepository::enqueueEvent()`

## Best Practices

1. **Use Connection-Specific Secrets**: Prefer connection-specific secrets over provider-level for better security isolation.

2. **Monitor Webhook Delivery**: Set up alerts for signature verification failures and duplicate events.

3. **Unique Event IDs, Idempotent Handling**: give every delivery its own event ID and keep it stable across retries of that delivery. OpenLinker dedups on `(provider, connection_id, event_id)`, so a deterministic id shared by two real changes silently discards the second. Coalesce repeat fires at the source instead, on a key you release once the event is sent.

4. **Minimal Payloads**: Keep webhook payloads minimal. Full data is fetched via adapter APIs during sync jobs.

5. **Error Handling**: Implement retry logic in PrestaShop webhook module for transient failures (5xx responses).

## Related Documentation

- [Webhook Overview](./overview.md) - OpenLinker webhook ingestion system
- [PrestaShop Module README](../../apps/prestashop-module/openlinker/README.md) - **Module installation and configuration guide**
- [Architecture Overview](../architecture-overview.md) - System architecture

