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

### 3. Configure PrestaShop Webhook

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

**Result**: Triggers `prestashop.product.syncByExternalId` job to fetch full product data via PrestaShop WebService API.

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

## Best Practices

1. **Use Connection-Specific Secrets**: Prefer connection-specific secrets over provider-level for better security isolation.

2. **Monitor Webhook Delivery**: Set up alerts for signature verification failures and duplicate events.

3. **Idempotent Event IDs**: Use deterministic event IDs (e.g., `prestashop-product-{id}`) to enable proper deduplication.

4. **Minimal Payloads**: Keep webhook payloads minimal. Full data is fetched via adapter APIs during sync jobs.

5. **Error Handling**: Implement retry logic in PrestaShop webhook module for transient failures (5xx responses).

## Related Documentation

- [Webhook Overview](./overview.md)
- [Webhook Testing Guide](../webhook-testing-guide.md)
- [Architecture Overview](../architecture-overview.md)

