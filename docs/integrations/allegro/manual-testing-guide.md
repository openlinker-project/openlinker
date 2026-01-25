# Allegro Integration Manual Testing Guide

Quick reference guide for manually testing the Allegro integration end-to-end.

## Prerequisites

- OpenLinker API running (default: `http://localhost:3000`)
- PostgreSQL database accessible
- Redis running
- Allegro Developer Account (sandbox recommended)
- API client (curl, Postman, or similar)

## 1. Create Allegro Connection

### Step 1: Initiate OAuth Flow

```bash
curl -X POST http://localhost:3000/integrations/allegro/oauth/connect \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "redirectUri": "http://localhost:3000/integrations/allegro/oauth/callback",
    "environment": "sandbox",
    "connectionName": "Test Connection"
  }'
```

**Expected**: Returns `authorizationUrl` and `state`

### Step 2: Complete OAuth

1. Open `authorizationUrl` in browser
2. Log in to Allegro (sandbox account)
3. Authorize the application
4. You'll be redirected to callback URL with `code` parameter

**Expected**: Returns `connectionId` and `connectionName`

### Step 3: Validate Connection

```bash
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/validate
```

**Expected**: `{ "valid": true, "errors": [] }`

## 2. Test Order Sync

### Step 1: Trigger Order Poll

Enqueue a poll job (or wait for scheduled poll):

```bash
# Via job enqueue API (if available)
curl -X POST http://localhost:3000/sync/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "marketplace.orders.poll",
    "connectionId": "{connectionId}",
    "payload": {
      "cursorKey": "allegro.orders.lastEventId",
      "limit": 10
    },
    "idempotencyKey": "test-poll-1"
  }'
```

**Expected**: Job ID returned

### Step 2: Verify Poll Job Executed

Check job status in database:

```sql
SELECT id, job_type, status, last_error, attempts
FROM sync_jobs
WHERE connection_id = '{connectionId}'
  AND job_type = 'marketplace.orders.poll'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected**: `status = 'succeeded'` or `status = 'queued'` (if worker hasn't processed yet)

### Step 3: Verify Order Sync Jobs Created

```sql
SELECT id, job_type, status, payload_json
FROM sync_jobs
WHERE connection_id = '{connectionId}'
  AND job_type = 'marketplace.order.sync'
ORDER BY created_at DESC;
```

**Expected**: One or more order sync jobs created

### Step 4: Verify Order Processed

Check if order was routed to OrderProcessorManager:

```sql
-- Check for order creation in destination system
-- (This depends on your OrderProcessorManager implementation)
SELECT * FROM orders WHERE source_connection_id = '{connectionId}';
```

### Step 5: Verify Cursor Updated

```bash
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/cursors?cursorKey=allegro.orders.lastEventId
```

**Expected**: Cursor value is set (not null)

## 3. Test Offer Quantity Update

### Step 1: Create Offer Mapping

```bash
curl -X POST http://localhost:3000/integrations/offer-mappings \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "{connectionId}",
    "platformType": "allegro",
    "offerId": "test-offer-123",
    "internalProductId": "internal-product-456"
  }'
```

**Expected**: Mapping created with ID

### Step 2: Trigger Inventory Sync

Enqueue inventory propagation job:

```bash
curl -X POST http://localhost:3000/sync/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "inventory.propagateToMarketplaces",
    "connectionId": "{connectionId}",
    "payload": {
      "productId": "internal-product-456",
      "quantity": 50
    },
    "idempotencyKey": "test-inventory-1"
  }'
```

**Expected**: Job ID returned

### Step 3: Verify Offer Quantity Update Job

```sql
SELECT id, job_type, status, payload_json
FROM sync_jobs
WHERE connection_id = '{connectionId}'
  AND job_type = 'marketplace.offerQuantity.update'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected**: Job with `offerId` and `quantity` in payload

### Step 4: Verify Command Status

```bash
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands
```

**Expected**: Command with `status = 'queued'` or `status = 'accepted'`

### Step 5: Check Command Details

```bash
# Get command ID from previous response, then:
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/commands/{commandId}
```

**Expected**: Command details with `offerId`, `quantity`, and `status`

## 4. Test Error Scenarios

### Test 1: Invalid Connection

```bash
curl http://localhost:3000/integrations/allegro/connections/invalid-id/validate
```

**Expected**: 404 Not Found

### Test 2: Missing Offer Mapping

Try to sync inventory for unmapped product:

```bash
curl -X POST http://localhost:3000/sync/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "inventory.propagateToMarketplaces",
    "connectionId": "{connectionId}",
    "payload": {
      "productId": "unmapped-product",
      "quantity": 10
    },
    "idempotencyKey": "test-unmapped-1"
  }'
```

**Expected**: Job may fail or skip (depends on handler implementation)

### Test 3: Invalid OAuth State

```bash
curl "http://localhost:3000/integrations/allegro/oauth/callback?code=test-code&state=invalid-state"
```

**Expected**: 400 Bad Request with "Invalid or expired OAuth state parameter"

## 5. Verify Data Persistence

### Check Credentials Stored

```sql
SELECT ref, platform_type, encrypted, created_at
FROM integration_credentials
WHERE platform_type = 'allegro'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected**: Credential record with `ref` starting with `allegro_`

### Check Connection Created

```sql
SELECT id, platform_type, name, status, credentials_ref, config
FROM connections
WHERE platform_type = 'allegro'
  AND id = '{connectionId}';
```

**Expected**: Connection with `status = 'active'` and `credentialsRef` like `db:allegro_...`

### Check Cursor Persisted

```sql
SELECT connection_id, cursor_key, cursor_value, updated_at
FROM connection_cursors
WHERE connection_id = '{connectionId}'
  AND cursor_key = 'allegro.orders.lastEventId';
```

**Expected**: Cursor record with non-null `cursor_value`

### Check Commands Persisted

```sql
SELECT command_id, offer_id, quantity, status, error, created_at
FROM allegro_quantity_commands
WHERE connection_id = '{connectionId}'
ORDER BY created_at DESC;
```

**Expected**: Command records with various statuses

## 6. Quick Verification Checklist

- [ ] OAuth flow completes successfully
- [ ] Connection created and validated
- [ ] Credentials stored in database
- [ ] Order poll job executes
- [ ] Order sync jobs created
- [ ] Orders routed to OrderProcessorManager
- [ ] Cursor advances after poll
- [ ] Offer mapping created
- [ ] Inventory sync triggers offer quantity update
- [ ] Command status persisted
- [ ] Failed commands visible via API
- [ ] Error scenarios handled gracefully

## 7. Common Issues

### Issue: OAuth callback fails

**Check**:
- Redirect URI matches Allegro app configuration exactly
- State parameter not expired (10 minute TTL)
- Client ID and secret are correct

### Issue: Orders not syncing

**Check**:
- Connection status is `active`
- Credentials are valid (not expired)
- Poll jobs are being enqueued
- Worker is processing jobs
- Cursor is advancing

### Issue: Commands failing

**Check**:
- Offer ID exists in Allegro
- Quantity is valid (positive, within limits)
- Offer mapping exists
- Connection has proper permissions

## 8. Test Data

### Sandbox Test Accounts

- Use Allegro sandbox environment for testing
- Create test offers in sandbox
- Use test orders from sandbox

### Sample Test Data

- **Offer ID**: Use a real offer ID from your Allegro sandbox account
- **Product ID**: Use an existing product ID from OpenLinker
- **Quantity**: Use reasonable values (e.g., 10, 50, 100)

## 9. Performance Testing

### Test Poll Frequency

- Enqueue multiple poll jobs rapidly
- Verify cursor advances correctly
- Check for duplicate order sync jobs

### Test Concurrent Updates

- Trigger multiple inventory syncs simultaneously
- Verify all commands are processed
- Check command statuses

## 10. Cleanup

After testing, you may want to clean up:

```sql
-- Delete test connection (cascades to cursors, jobs, etc.)
DELETE FROM connections WHERE id = '{connectionId}';

-- Delete test credentials
DELETE FROM integration_credentials WHERE ref LIKE 'allegro_%';

-- Delete test offer mappings (offers are stored in identifier_mappings)
DELETE FROM identifier_mappings
WHERE "connectionId" = '{connectionId}'
  AND "entityType" = 'Offer';
```

**Note**: Be careful with cleanup in shared environments!



