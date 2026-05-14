# Allegro Integration Runbook

Operational guide for managing and troubleshooting the Allegro integration in OpenLinker.

## Table of Contents

- [Reset Cursor](#reset-cursor)
- [Diagnose Rate Limiting](#diagnose-rate-limiting)
- [View Failed Commands](#view-failed-commands)
- [Offer↔Product Mappings](#offerproduct-mappings)
- [Troubleshoot Order Sync Failures](#troubleshoot-order-sync-failures)
- [Monitor Command Status](#monitor-command-status)

## Reset Cursor

OpenLinker persists Allegro cursors in `connection_cursors` and currently uses two keys:

- `allegro.orders.lastEventId` for `marketplace.orders.poll` (`GET /order/events`)
- `allegro.offers.lastEventId` for `marketplace.offers.sync` in events mode (`GET /sale/offer-events`)

Resetting a cursor allows you to replay data from an earlier point.

### When to Reset

- Re-sync all orders from the beginning
- Recover from a sync failure
- Start fresh after a configuration change

### How to Reset

**Option 1: Delete cursor via API** (if endpoint exists)

```bash
# Delete orders cursor for a connection
curl -X DELETE http://localhost:3000/integrations/allegro/connections/{connectionId}/cursors/allegro.orders.lastEventId

# Delete offers cursor for a connection
curl -X DELETE http://localhost:3000/integrations/allegro/connections/{connectionId}/cursors/allegro.offers.lastEventId
```

**Option 2: Direct database update**

```sql
-- Delete orders cursor for a specific connection
DELETE FROM connection_cursors
WHERE connection_id = 'your-connection-id'
  AND cursor_key = 'allegro.orders.lastEventId';

-- Delete offers cursor for a specific connection
DELETE FROM connection_cursors
WHERE connection_id = 'your-connection-id'
  AND cursor_key = 'allegro.offers.lastEventId';
```

**Option 3: Set cursor to a specific event ID**

```sql
-- Set orders cursor to a specific event ID
UPDATE connection_cursors
SET cursor_value = 'specific-event-id',
    updated_at = NOW()
WHERE connection_id = 'your-connection-id'
  AND cursor_key = 'allegro.orders.lastEventId';

-- Set offers cursor to a specific event ID
UPDATE connection_cursors
SET cursor_value = 'specific-event-id',
    updated_at = NOW()
WHERE connection_id = 'your-connection-id'
  AND cursor_key = 'allegro.offers.lastEventId';
```

### Verify Cursor Reset

```bash
# Check orders cursor value
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/cursors?cursorKey=allegro.orders.lastEventId

# Check offers cursor value
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/cursors?cursorKey=allegro.offers.lastEventId
```

**Response**:
```json
{
  "cursors": [
    {
      "cursorKey": "allegro.orders.lastEventId",
      "value": null
    }
  ]
}
```

A `null` value means the next sync run starts from the beginning of the respective event journal.

## Diagnose Rate Limiting

Allegro API has rate limits. When exceeded, requests return HTTP 429 (Too Many Requests).

### Symptoms

- Jobs failing with `AllegroRateLimitException`
- HTTP 429 errors in logs
- Slow or intermittent API responses

### Check Rate Limit Status

**Option 1: Check job errors**

```bash
# Get failed jobs for a connection
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands?status=failed
```

**Option 2: Check application logs**

```bash
# Search for rate limit errors
grep "Rate limit" logs/worker.log
```

### Solutions

1. **Reduce Polling Frequency**: Increase the interval between `marketplace.orders.poll` jobs
2. **Respect Retry-After Header**: The integration automatically respects `Retry-After` headers
3. **Batch Operations**: Reduce the number of API calls by batching operations
4. **Contact Allegro Support**: If rate limits are consistently hit, consider requesting a higher limit

### Monitor Rate Limits

```bash
# Count rate limit errors in the last hour
SELECT COUNT(*) 
FROM sync_jobs 
WHERE connection_id = 'your-connection-id'
  AND last_error LIKE '%Rate limit%'
  AND updated_at > NOW() - INTERVAL '1 hour';
```

## View Failed Commands

Quantity update commands can fail for various reasons. Failed commands are persisted in the `allegro_quantity_commands` table.

### List Failed Commands

```bash
# Get all failed commands for a connection
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands/failed
```

**Response**:
```json
[
  {
    "commandId": "cmd-123",
    "connectionId": "conn-456",
    "offerId": "offer-789",
    "quantity": 10,
    "status": "failed",
    "error": "Offer not found",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:01:00Z"
  }
]
```

### Get Specific Command

```bash
# Get command by ID
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands/{commandId}
```

### Query Failed Commands in Database

```sql
-- Get all failed commands
SELECT 
  command_id,
  connection_id,
  offer_id,
  quantity,
  status,
  error,
  created_at,
  updated_at
FROM allegro_quantity_commands
WHERE status = 'failed'
  AND connection_id = 'your-connection-id'
ORDER BY updated_at DESC;
```

### Common Failure Reasons

1. **Offer Not Found**: The offer ID doesn't exist in Allegro
2. **Invalid Quantity**: Quantity is negative or exceeds maximum
3. **Authentication Error**: OAuth token expired or invalid
4. **Rate Limit**: Too many requests (see [Diagnose Rate Limiting](#diagnose-rate-limiting))

### Retry Failed Commands

Failed commands are not automatically retried. To retry:

1. Identify the failed command
2. Check the error message
3. Fix the underlying issue (e.g., update offer mapping)
4. Re-trigger inventory sync for the affected product

## Offer↔Product Mappings

Offer mappings link Allegro offers to internal OpenLinker products and variants. These mappings are required for inventory synchronization.

### Create Mapping

```bash
curl -X POST http://localhost:3000/integrations/offer-mappings \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "your-connection-id",
    "platformType": "allegro",
    "offerId": "allegro-offer-123",
    "internalProductId": "internal-product-456",
    "variantId": "internal-variant-789"
  }'
```

**Response**:
```json
{
  "id": "mapping-id",
  "connectionId": "your-connection-id",
  "platformType": "allegro",
  "offerId": "allegro-offer-123",
  "internalProductId": "internal-product-456",
  "variantId": "internal-variant-789",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### List Mappings

```bash
# List mappings for a connection
curl http://localhost:3000/integrations/offer-mappings?connectionId={connectionId}

# List mappings for a product
curl http://localhost:3000/integrations/offer-mappings?productId={productId}
```

### Update Mapping

```bash
curl -X PATCH http://localhost:3000/integrations/offer-mappings/{mappingId} \
  -H "Content-Type: application/json" \
  -d '{
    "internalProductId": "new-product-id",
    "variantId": "new-variant-id"
  }'
```

### Delete Mapping

```bash
curl -X DELETE http://localhost:3000/integrations/offer-mappings/{mappingId}
```

### Query Mappings in Database

```sql
-- Get all offer mappings for a connection (offers are stored in identifier_mappings)
SELECT 
  id,
  "connectionId",
  "platformType",
  "entityType",
  "externalId" AS "offerId",
  "internalId" AS "internalProductId",
  "createdAt",
  "updatedAt"
FROM identifier_mappings
WHERE "connectionId" = 'your-connection-id'
  AND "entityType" = 'Offer'
ORDER BY "createdAt" DESC;
```

## Troubleshoot Order Sync Failures

Order sync can fail at various stages. Use this guide to diagnose and fix issues.

### Check Order Sync Jobs

```sql
-- Get failed order sync jobs
SELECT 
  id,
  job_type,
  connection_id,
  status,
  last_error,
  attempts,
  created_at,
  updated_at
FROM sync_jobs
WHERE connection_id = 'your-connection-id'
  AND job_type IN ('marketplace.orders.poll', 'marketplace.order.sync')
  AND status = 'failed'
ORDER BY updated_at DESC;
```

### Common Issues

#### 1. Authentication Errors

**Symptom**: Jobs failing with `AllegroAuthenticationException`

**Solution**:
1. Check if OAuth token expired
2. Re-run OAuth flow to refresh tokens
3. Verify credentials in `integration_credentials` table

```sql
-- Check credentials
SELECT 
  ref,
  platform_type,
  credentials_json,
  updated_at
FROM integration_credentials
WHERE platform_type = 'allegro'
ORDER BY updated_at DESC;
```

#### 2. Order Not Found

**Symptom**: `marketplace.order.sync` jobs failing with "Order not found"

**Solution**:
1. Verify the checkout form ID is correct
2. Check if the order was deleted in Allegro
3. Verify the connection has access to the order

#### 3. Missing Product Mappings

**Symptom**: Orders synced but products not found

**Solution**:
1. Create offer↔product mappings (see [Offer↔Product Mappings](#offerproduct-mappings))
2. Verify product IDs exist in OpenLinker
3. Check identifier mappings

#### 4. Cursor Issues

**Symptom**: Orders not being polled or duplicate orders

**Solution**:
1. Check cursor value (see [Reset Cursor](#reset-cursor))
2. Verify cursor is advancing correctly
3. Reset cursor if needed

### Debug Order Sync

**Step 1: Check poll job status**

```bash
# Get poll jobs
curl http://localhost:3000/sync/jobs?connectionId={connectionId}&jobType=marketplace.orders.poll
```

**Step 2: Check order sync jobs**

```bash
# Get order sync jobs
curl http://localhost:3000/sync/jobs?connectionId={connectionId}&jobType=marketplace.order.sync
```

**Step 3: Check application logs**

```bash
# Search for order sync errors
grep "Allegro order sync" logs/worker.log | tail -20
```

## Monitor Command Status

Quantity update commands go through several states: `queued`, `accepted`, `rejected`, `failed`.

### Check Command Status

```bash
# Get all commands for a connection
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands

# Get commands by status
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands?status=queued
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands?status=accepted
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands?status=failed
```

### Command Status Meanings

- **queued**: Command submitted to Allegro, waiting for processing
- **accepted**: Command accepted by Allegro, will be processed
- **rejected**: Command rejected by Allegro (permanent failure)
- **failed**: Command failed due to error (may be retryable)

### Monitor Command Progress

```sql
-- Get command status distribution
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as first_command,
  MAX(updated_at) as last_update
FROM allegro_quantity_commands
WHERE connection_id = 'your-connection-id'
GROUP BY status
ORDER BY count DESC;
```

### Track Command Execution Time

```sql
-- Get average command processing time
SELECT 
  status,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_seconds,
  MIN(EXTRACT(EPOCH FROM (updated_at - created_at))) as min_seconds,
  MAX(EXTRACT(EPOCH FROM (updated_at - created_at))) as max_seconds
FROM allegro_quantity_commands
WHERE connection_id = 'your-connection-id'
  AND status IN ('accepted', 'rejected', 'failed')
GROUP BY status;
```

### Set Up Alerts

Monitor for:
- High failure rate: `status = 'failed'` > 10% of commands
- Stuck commands: `status = 'queued'` for > 1 hour
- Rejected commands: `status = 'rejected'` (requires investigation)

## Additional Resources

- [Setup Guide](./setup-guide.md) - Initial setup and configuration
- [Manual Testing Guide](./manual-testing-guide.md) - Step-by-step manual testing procedures
- [Allegro API Documentation](https://developer.allegro.pl/documentation/)
- [OpenLinker Architecture Overview](../../architecture-overview.md)
- [Testing Guide](../../testing-guide.md)

