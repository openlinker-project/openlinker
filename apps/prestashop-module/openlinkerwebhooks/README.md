# OpenLinker Webhooks PrestaShop Module

PrestaShop module that emits secure webhook events to OpenLinker to support event-driven synchronization triggers ("trigger pull").

## Overview

This module captures PrestaShop events (product/order/stock) via hooks, writes them to a durable outbox table, and delivers them to OpenLinker via HTTP POST with HMAC signature and retry/backoff support.

**Key Features**:
- Non-blocking hook execution (fast writes to outbox)
- Durable outbox with retry/backoff
- HMAC signature compatible with OpenLinker
- Stable event IDs across retries
- Processing lease to prevent stuck rows
- Deterministic claiming to prevent overlap
- **Automatic event deduplication** (prevents duplicate events from multiple hook fires)
- **Custom menu tab** for easy access

## Accessing the Module

After installation, the OpenLinker module is accessible in two ways:

1. **Main Menu** (Recommended): 
   - Navigate to **Improve** → **OpenLinker** in the left sidebar menu
   - This provides quick access to the module configuration

2. **Module Manager**:
   - Navigate to **Modules** → **Module Manager**
   - Search for "OpenLinker Webhooks"
   - Click **Configure**

## Installation

### Development (Bind-Mount)

1. **Add to docker-compose.yml**:
   ```yaml
   services:
     prestashop:
       volumes:
         - ./apps/prestashop-module/openlinkerwebhooks:/var/www/html/modules/openlinkerwebhooks
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```

2. **Start PrestaShop**: `docker compose up -d prestashop`

3. **Install module**: PrestaShop Backoffice → Modules → Module Manager → Install "OpenLinker Webhooks"

4. **Edit code locally**: Changes apply instantly (no ZIP upload needed)

### Production (ZIP Upload)

1. **Create ZIP**: `cd apps/prestashop-module && zip -r openlinkerwebhooks.zip openlinkerwebhooks/`

2. **Upload**: PrestaShop Backoffice → Modules → Module Manager → Upload a module

3. **Install**: Click "Install" on the uploaded module

## Configuration

### Required Settings

- **Base URL**: OpenLinker API base URL
  - Dev: `http://host.docker.internal:3000`
  - Production: `https://your-openlinker-instance.com`
- **Connection ID**: UUID from OpenLinker connection
- **Webhook Secret**: Shared secret (must match OpenLinker env var)
- **Cron Token**: Random token for securing cron endpoint

### Event Type Toggles

- **Enable Product Events**: Capture product save/update events
- **Enable Stock Events**: Capture stock quantity changes
- **Enable Order Events**: Capture order creation and status changes

### Advanced Settings

- **Batch Size**: Number of events to process per cron run (default: 50)
- **Max Retry Attempts**: Maximum delivery attempts before marking as failed (default: 25)
- **Retry Backoff Multiplier**: Exponential backoff multiplier (default: 2.0)

## Event Deduplication

PrestaShop's hooks (especially `actionProductSave`) can fire **multiple times** during a single operation (e.g., 6 times when saving a product). This is expected PrestaShop behavior.

The module implements **automatic deduplication**:
- Event IDs are generated deterministically based on product ID + event type + time window (1 minute)
- Database unique constraint on `event_id` prevents duplicates
- `INSERT IGNORE` handles duplicate attempts gracefully

**Result**: Only 1 event is created per product save, even if the hook fires 6+ times.

## Cron Setup

Set up a system cron to trigger webhook delivery:

```bash
# Every 2 minutes
*/2 * * * * curl -s "https://your-shop.com/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN" > /dev/null 2>&1
```

**Recommended frequency**: Every 1-5 minutes

## Webhook Endpoint

The module sends webhooks to:
```
{OPENLINKER_BASE_URL}/webhooks/prestashop/{OPENLINKER_CONNECTION_ID}
```

With headers:
- `Content-Type: application/json`
- `X-OpenLinker-Timestamp: {unix_milliseconds}`
- `X-OpenLinker-Signature: sha256={hmac_signature}`

## Event Types

### `product.saved`
Triggered when a product is created or updated.

### `order.created`
Triggered when a new order is validated/created.

### `order.status_changed`
Triggered when order status changes.

### `stock.changed`
Triggered when product stock quantity changes.

## Troubleshooting

### Module Not Appearing in Module Manager

- Clear PrestaShop cache: **Advanced Parameters → Performance → Clear cache**
- Check module files exist in `/modules/openlinkerwebhooks/`
- Verify `config.xml` is present and valid

### Events Not Being Created

- Check event type toggles are enabled in configuration
- Verify connection ID is configured
- Check PrestaShop logs: **Advanced Parameters → Logs**

### Events Stuck in Pending

- Check `next_attempt_at` - events scheduled for future won't be processed until due
- Use "Run Delivery Now" button to force immediate delivery
- Check OpenLinker API is accessible from PrestaShop

### Multiple Events for Single Action

This is normal PrestaShop behavior. The module automatically deduplicates events within the same time window (1 minute). If you see duplicates:
- Verify `event_id` column has unique constraint
- Check events are created in different time windows (this is correct behavior)

## Architecture

### Outbox Pattern

The module uses an **outbox pattern** to ensure reliable webhook delivery:

1. **Hooks** capture PrestaShop events and enqueue to outbox table (fast, non-blocking)
2. **Cron** periodically claims batches from outbox and delivers via HTTP
3. **Retry logic** handles failures with exponential backoff
4. **Stale row recovery** prevents stuck events if cron crashes

This ensures:
- Hooks never block (checkout/admin operations remain fast)
- Events survive OpenLinker downtime (retry later)
- No duplicate deliveries (atomic claiming by runId)
- No lost events (durable outbox table)

### State Machine

Events flow through these states:
- `pending` → `processing` → `delivered` (success)
- `pending` → `processing` → `pending` (retry with backoff)
- `pending` → `processing` → `failed` (max attempts reached)

### Concurrency Safety

- **Deterministic claiming**: Each cron run uses unique `runId` to claim events
- **Processing lease**: `processing_owner` and `processing_started_at` prevent overlap
- **Stale recovery**: Rows stuck in `processing` for >15 minutes are automatically requeued

## Related Documentation

- [PrestaShop Webhook Integration](../../docs/webhooks/prestashop.md) - OpenLinker webhook integration guide
- [PrestaShop Module Testing Guide](../../docs/prestashop-module-testing-guide.md) - Testing and troubleshooting
- [Architecture Overview](../../docs/architecture-overview.md) - System architecture
