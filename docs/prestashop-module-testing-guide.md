# PrestaShop Module Testing Guide

## Quick Start Testing

This guide walks you through testing the PrestaShop webhook module end-to-end.

## Quick Reference

**TL;DR - Fastest Path to First Test**:

```bash
# 1. Start services
pnpm start:dev                    # OpenLinker API (host)
docker compose up -d prestashop  # PrestaShop (Docker)

# 2. Delete install folder (required for module installation)
docker compose exec prestashop rm -rf /var/www/html/install

# 3. Disable demo mode (required for module installation)
docker compose exec prestashop sed -i "s/define('_PS_MODE_DEMO_', true);/define('_PS_MODE_DEMO_', false);/g" /var/www/html/config/defines.inc.php

# 4. Install module
# → http://localhost:8080/admin → Modules → Module Manager → Install "OpenLinker Webhooks"

# 5. Set up credentials (see Step 3 in full guide)
# → Set CREDENTIALS_TEST_CREDENTIALS_REF='{"webserviceApiKey":"YOUR_API_KEY"}'
# → Create connection: POST /connections with credentialsRef

# 6. Configure module
# → Base URL: http://host.docker.internal:3000
# → Connection ID: <your-connection-uuid>
# → Webhook Secret: <your-secret>
# → Click "Test Connection"

# 7. Test product event
# → Save a product in PrestaShop admin
# → Click "Run delivery now" in module config
# → Verify event delivered in OpenLinker logs
```

**Full step-by-step guide below** ⬇️

## Prerequisites

1. **OpenLinker API running** (via `pnpm start:dev` on host)
2. **PrestaShop in Docker** (via `docker compose up -d prestashop`)
3. **Module bind-mounted** (already configured in `docker-compose.yml`)

## Step 1: Start Services

### Start OpenLinker API

```bash
# From project root
pnpm start:dev
```

**Verify**: API should be running on `http://localhost:3000`

**Important**: Ensure API binds to `0.0.0.0` (not just `127.0.0.1`) so Docker containers can reach it. Check `apps/api/src/main.ts`:

```typescript
await app.listen(3000, '0.0.0.0'); // ✅ Accessible from Docker
```

### Start PrestaShop

```bash
# From project root
docker compose up -d prestashop mysql
```

**Verify**: PrestaShop should be accessible at `http://localhost:8080`

**Wait**: PrestaShop takes 1-2 minutes to initialize on first run.

**Verify Installation Complete**:
- Check that PrestaShop core tables exist (note: prefix may differ from `ps_`):
  ```bash
  docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_module';"
  ```
- Should return a table like `ps_module` or `usesj_module` (prefix may vary)
- If no `*_module` table exists, PrestaShop is still installing - wait and check again
- You can also check PrestaShop logs: `docker logs openlinker-prestashop`
- **Note**: The table prefix in your database may differ from `ps_` (e.g., `usesj_`) - this is normal and depends on how PrestaShop was installed

### Delete Install Folder (Required for Module Installation)

**Important**: PrestaShop disables module installation if the `/install` folder exists. You must delete it before installing modules:

```bash
docker compose exec prestashop rm -rf /var/www/html/install
```

**Verify**: The folder should be deleted:
```bash
docker compose exec prestashop ls -la /var/www/html/ | grep install
# Should return nothing (folder deleted)
```

> **Note**: PrestaShop will show a security warning in the admin panel until this folder is deleted. This is expected and normal.

### Disable Demo Mode (Required for Module Installation)

**Important**: If PrestaShop is running in demo mode (`PS_DEMO_MODE: 1` in docker-compose.yml), module installation will be disabled. You must disable demo mode:

```bash
# Disable demo mode in configuration file
docker compose exec prestashop sed -i "s/define('_PS_MODE_DEMO_', true);/define('_PS_MODE_DEMO_', false);/g" /var/www/html/config/defines.inc.php
```

**Verify**: Check that demo mode is disabled:
```bash
docker compose exec prestashop grep "_PS_MODE_DEMO_" /var/www/html/config/defines.inc.php
# Should show: define('_PS_MODE_DEMO_', false);
```

**Alternative**: Remove `PS_DEMO_MODE: 1` from `docker-compose.yml` and restart:
```bash
# Edit docker-compose.yml: remove or change PS_DEMO_MODE: 1 to PS_DEMO_MODE: 0
docker compose down prestashop
docker compose up -d prestashop
```

After disabling demo mode, clear cache and refresh the module manager page.

## Step 2: Install Module

1. **Access PrestaShop Backoffice**:
   - URL: `http://localhost:8080/admin`
   - Default credentials (if demo mode): Check PrestaShop logs or use installer

2. **Navigate to Modules**:
   - Go to: **Modules → Module Manager**

3. **Find Module**:
   - Search for "OpenLinker Webhooks"
   - If not visible, clear cache: **Advanced Parameters → Performance → Clear cache**

4. **Install Module**:
   - Click **"Install"** on OpenLinker Webhooks module
   - Verify installation success (no errors)
   
   > **Troubleshooting**: If you see "This functionality has been disabled", ensure you've deleted the `/install` folder (see step above).

5. **Verify Outbox Table**:
   ```sql
   -- Connect to MySQL
   docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop
   
   -- Find your table prefix first (may be 'ps_' or different like 'usesj_')
   SHOW TABLES LIKE '%_openlinker_webhook_outbox';
   
   -- Check table exists (replace PREFIX_ with your actual prefix, e.g., 'usesj_' or 'ps_')
   SHOW TABLES LIKE 'PREFIX_openlinker_webhook_outbox';
   
   -- Check table structure (replace PREFIX_ with your actual prefix)
   DESCRIBE PREFIX_openlinker_webhook_outbox;
   ```
   
   **Note**: All SQL examples in this guide use `ps_` as the table prefix. If your PrestaShop uses a different prefix (like `usesj_`), replace `ps_` with your actual prefix in all SQL queries.

## Step 3: Configure Credentials Reference

Before creating a connection, you need to set up credentials storage. The `credentialsRef` is a reference string that points to where your credentials are stored (credentials are never stored directly in the database for security).

### How credentialsRef Works

1. **credentialsRef** is a string identifier you choose (e.g., `"test-credentials-ref"`, `"prestashop-store-1"`)
2. Credentials are stored in **environment variables** using the pattern: `CREDENTIALS_{credentialsRef}`
3. The system converts your `credentialsRef` to uppercase and replaces special characters with underscores
4. For PrestaShop, credentials must be JSON with a `webserviceApiKey` field

### Setting Up Credentials

**Step 1: Choose a credentialsRef**

Choose any string identifier, for example:
- `test-credentials-ref`
- `prestashop-store-1`
- `my-prestashop-connection`

**Step 2: Set the environment variable**

The environment variable name is automatically generated from your `credentialsRef`:
- `credentialsRef: "test-credentials-ref"` → env var: `CREDENTIALS_TEST_CREDENTIALS_REF`
- `credentialsRef: "prestashop-store-1"` → env var: `CREDENTIALS_PRESTASHOP_STORE_1`

Set the environment variable with JSON-encoded PrestaShop credentials:

```bash
# Example: For credentialsRef "test-credentials-ref"
export CREDENTIALS_TEST_CREDENTIALS_REF='{"webserviceApiKey":"YOUR_PRESTASHOP_WEBSERVICE_API_KEY"}'

# Or add to your .env file:
# CREDENTIALS_TEST_CREDENTIALS_REF={"webserviceApiKey":"YOUR_PRESTASHOP_WEBSERVICE_API_KEY"}
```

**Where to get PrestaShop WebService API Key:**
1. Log in to PrestaShop admin: `http://localhost:8080/admin`
2. Go to: **Advanced Parameters → Web Service**
3. Generate or copy an existing API key
4. Use that key as the `webserviceApiKey` value

**Step 3: Restart OpenLinker API** (if running) after setting the environment variable.

### Example

```bash
# Set credentials for credentialsRef "my-prestashop-store"
export CREDENTIALS_MY_PRESTASHOP_STORE='{"webserviceApiKey":"ABCD1234EFGH5678IJKL9012MNOP3456"}'

# Restart API (if needed)
pnpm start:dev
```

## Step 4: Create OpenLinker Connection

Now create a connection in OpenLinker using the `credentialsRef` you configured:

```bash
# Create connection (use the credentialsRef you set up above)
curl -X POST http://localhost:3000/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test PrestaShop Store",
    "platformType": "prestashop",
    "adapterKey": "prestashop.webservice.v1",
    "credentialsRef": "test-credentials-ref",
    "config": {
      "baseUrl": "https://shop.example.com",
      "shopId": 1,
      "langId": 1
    }
  }'
```

**Important Notes**: 
- The `status` field is automatically set to `'active'` by the service and should not be included in the request
- The `credentialsRef` must match the one you used when setting the environment variable (case-insensitive, but special characters are normalized)
- The `config` object should contain PrestaShop-specific configuration (adjust `baseUrl`, `shopId`, and `langId` to match your store)
- Authentication is currently not required for this endpoint (JWT token not needed)

**Save the `connectionId` from the response** (UUID format).

## Step 5: Configure Webhook Secret in OpenLinker

Set the webhook secret as an environment variable. The connection ID must be **uppercase with dashes**:

```bash
# Connection-specific (recommended)
# Format: OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__<CONNECTION_ID_UPPERCASE>
# Example for connection ID: 59f4129e-a827-4650-b69b-fc2302b9ecb7
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__59F4129E-A827-4650-B69B-FC2302B9ECB7=test-secret-key-12345

# Or provider-level (fallback - works for all PrestaShop connections)
export OPENLINKER_WEBHOOK_SECRET__PRESTASHOP=test-secret-key-12345
```

**Important Notes**:
- Replace `<CONNECTION_ID_UPPERCASE>` with your actual connection ID converted to **uppercase with dashes**
- Example: `59f4129e-a827-4650-b69b-fc2302b9ecb7` → `59F4129E-A827-4650-B69B-FC2302B9ECB7`
- The webhook secret must match exactly what you configure in the PrestaShop module
- You can also add this to your `.env` file in `apps/api/.env`:
  ```env
  OPENLINKER_WEBHOOK_SECRET__PRESTASHOP__59F4129E-A827-4650-B69B-FC2302B9ECB7=test-secret-key-12345
  ```

**Restart OpenLinker API** after setting the environment variable (or if using `.env`, restart the API to reload environment variables).

## Step 6: Configure Module

1. **Navigate to Module Configuration**:
   - Go to: **Modules → Module Manager → OpenLinker Webhooks → Configure**

2. **Fill Required Settings**:
   - **Base URL**: `http://host.docker.internal:3000`
     - This allows PrestaShop (in Docker) to reach OpenLinker (on host)
   - **Connection ID**: Your connection UUID from Step 4
     - **Important**: UUIDs can be in uppercase or lowercase - both are accepted
     - If you see a validation error, ensure the UUID format is correct (8-4-4-4-12 hex characters)
   - **Webhook Secret**: `test-secret-key-12345` (must match OpenLinker env var)
   - **Cron Token**: Use the auto-generated token (or regenerate)

3. **Enable Event Types**:
   - ✅ Enable Product Events
   - ✅ Enable Stock Events
   - ✅ Enable Order Events

4. **Click "Save"** (important: save before testing connection)

   **Note**: If you see an error "Connection ID not configured" when clicking "Test Connection", it means the configuration hasn't been saved yet. Click "Save" first, then test the connection.

## Step 7: Test Connection

1. **In module configuration page**, click **"Test Connection"** button

2. **Expected Result**:
   - Success message: "Test connection successful! Event delivered to OpenLinker."
   - Check OpenLinker API logs for webhook receipt
   - Check diagnostics: pending count should decrease, delivered count should increase

3. **If Failed**:
   - Check OpenLinker API is running: `curl http://localhost:3000/health`
   - Check network connectivity: `docker exec openlinker-prestashop curl -v http://host.docker.internal:3000`
   - Verify webhook secret matches exactly
   - Check OpenLinker logs for signature verification errors

## Step 8: Test Product Events

1. **Create/Update a Product**:
   - Go to: **Catalog → Products → Add new product**
   - Fill in product details (name, price, etc.)
   - Click **"Save"**

2. **Verify Event Enqueued**:
   ```sql
   -- Check outbox table (replace usesj_ with your actual table prefix)
   SELECT * FROM usesj_openlinker_webhook_outbox 
   WHERE event_type = 'product.saved' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```
   - Should see event with `status='pending'` (or `status='processing'` if currently being processed)
   - `external_id` should match product ID
   
   **Note**: If you see `status='processing'` and it's been stuck for more than 15 minutes, it's a stale row. The "Run Delivery Now" button should automatically requeue it. If not, manually requeue:
   ```sql
   -- Manually requeue stuck processing event (replace usesj_ with your prefix and adjust ID)
   UPDATE usesj_openlinker_webhook_outbox 
   SET status='pending', 
       processing_owner=NULL, 
       processing_started_at=NULL,
       last_error='Manually requeued',
       updated_at=NOW()
   WHERE status='processing' 
   AND id=10;  -- Replace 10 with your event ID
   ```

3. **Trigger Delivery** (choose one):
   - **Option A**: Wait for cron (if set up)
   - **Option B**: Use "Run delivery now" button in module config
   - **Option C**: Manual cron call:
     ```bash
     curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN"
     ```

4. **Verify Delivery**:
   - Check OpenLinker API logs for webhook receipt
   - Check outbox: `SELECT status FROM ps_openlinker_webhook_outbox WHERE event_type = 'product.saved' ORDER BY created_at DESC LIMIT 1;`
   - Should be `status='delivered'`

## Step 9: Test Order Events

1. **Place a Test Order**:
   - Go to PrestaShop frontend: `http://localhost:8080`
   - Add product to cart
   - Complete checkout (or create order via admin)

2. **Verify `order.created` Event**:
   ```sql
   SELECT * FROM ps_openlinker_webhook_outbox 
   WHERE event_type = 'order.created' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

3. **Change Order Status**:
   - Go to: **Orders → Orders**
   - Open the test order
   - Change order status
   - Save

4. **Verify `order.status_changed` Event**:
   ```sql
   SELECT * FROM ps_openlinker_webhook_outbox 
   WHERE event_type = 'order.status_changed' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

5. **Trigger Delivery** and verify events are delivered

## Step 10: Test Stock Events

1. **Update Stock**:
   - Go to: **Catalog → Products**
   - Edit a product
   - Change stock quantity
   - Save

2. **Verify `stock.changed` Event**:
   ```sql
   SELECT * FROM ps_openlinker_webhook_outbox 
   WHERE event_type = 'stock.changed' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

3. **Trigger Delivery** and verify event is delivered

## Step 11: Test Retry Behavior

1. **Stop OpenLinker API**:
   ```bash
   # Stop the API (Ctrl+C or kill process)
   ```

2. **Trigger an Event**:
   - Save a product in PrestaShop admin

3. **Trigger Cron** (while API is down):
   ```bash
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN"
   ```

4. **Verify Retry Scheduled**:
   ```sql
   SELECT id, event_type, status, attempts, next_attempt_at, last_error 
   FROM ps_openlinker_webhook_outbox 
   WHERE event_type = 'product.saved' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```
   - Should be `status='pending'` (not 'processing')
   - `attempts` should be 1
   - `next_attempt_at` should be set (exponential backoff)

5. **Start OpenLinker API**:
   ```bash
   pnpm start:dev
   ```

6. **Wait for Next Attempt** (or manually trigger cron again):
   ```bash
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN"
   ```

7. **Verify Event Delivered**:
   - Check outbox: `status='delivered'`
   - Check OpenLinker logs for webhook receipt

## Step 12: Test Idempotency

1. **Deliver an Event Successfully**:
   - Trigger a product save
   - Verify event delivered

2. **Manually Requeue Event** (for testing):
   ```sql
   UPDATE ps_openlinker_webhook_outbox 
   SET status='pending', attempts=0, next_attempt_at=NULL 
   WHERE event_type = 'product.saved' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

3. **Trigger Cron Again**:
   ```bash
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN"
   ```

4. **Verify Idempotency**:
   - Check OpenLinker logs: should accept duplicate (202 response)
   - Check outbox: event marked as delivered
   - Verify same `event_id` used for both attempts:
     ```sql
     SELECT event_id, attempts, delivered_at 
     FROM ps_openlinker_webhook_outbox 
     WHERE event_type = 'product.saved' 
     ORDER BY created_at DESC 
     LIMIT 1;
     ```

## Step 13: Test Security

1. **Test Cron Endpoint Without Token**:
   ```bash
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron"
   ```
   - Expected: `403 Forbidden`

2. **Test Cron Endpoint With Wrong Token**:
   ```bash
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=wrong-token"
   ```
   - Expected: `403 Forbidden`

3. **Test Cron Endpoint With Correct Token**:
   ```bash
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN"
   ```
   - Expected: `200 OK` with JSON response

4. **Test Signature Verification** (wrong secret):
   - Temporarily change webhook secret in module config to wrong value
   - Trigger test connection
   - Expected: Failure (OpenLinker rejects with 401)
   - Restore correct secret

## Step 14: Test Diagnostics

1. **Check Diagnostics in Module Config**:
   - Go to: **Modules → Module Manager → OpenLinker Webhooks → Configure**
   - Scroll to **Diagnostics** section
   - Verify statistics are displayed:
     - Pending events count
     - Processing events count
     - Failed events count
     - Delivered events (last 24h)
     - Last delivery time
     - Last error message (if any)

2. **Test "Run Delivery Now" Button**:
   - Click **"Run Delivery Now"** button
   - Verify success message with statistics
   - Check diagnostics updated

## Step 15: Test Concurrency Safety

1. **Trigger Two Cron Runs Simultaneously**:
   ```bash
   # Run two cron calls in parallel
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN" &
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN" &
   wait
   ```

2. **Verify No Duplicate Deliveries**:
   ```sql
   -- Check processing_owner values (should be different runIds)
   SELECT id, event_id, processing_owner, status 
   FROM ps_openlinker_webhook_outbox 
   WHERE status IN ('processing', 'delivered') 
   ORDER BY updated_at DESC 
   LIMIT 10;
   ```
   - Each event should be processed only once
   - Different `processing_owner` values indicate different cron runs

## Step 16: Test Stale Row Recovery

1. **Manually Create Stale Processing Row** (for testing):
   ```sql
   UPDATE ps_openlinker_webhook_outbox 
   SET status='processing', 
       processing_owner='test_stale', 
       processing_started_at=NOW() - INTERVAL 20 MINUTE 
   WHERE status='pending' 
   LIMIT 1;
   ```

2. **Trigger Cron**:
   ```bash
   curl "http://localhost:8080/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=YOUR_CRON_TOKEN"
   ```

3. **Verify Stale Row Requeued**:
   ```sql
   SELECT id, status, processing_owner, last_error 
   FROM ps_openlinker_webhook_outbox 
   WHERE processing_owner='test_stale';
   ```
   - Should be `status='pending'`
   - `processing_owner` should be NULL
   - `last_error` should contain "Stale processing row requeued"

## Monitoring During Testing

### PrestaShop Logs

```bash
# View PrestaShop logs
docker logs -f openlinker-prestashop

# Or check PrestaShop backoffice: Advanced Parameters → Logs
```

### OpenLinker API Logs

Check terminal where `pnpm start:dev` is running for:
- Webhook receipt logs
- Signature verification logs
- Event processing logs

### Database Queries

**Important**: Replace `ps_` with your actual table prefix (e.g., `usesj_`) in all SQL queries below. Find your prefix with:
```bash
docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_openlinker_webhook_outbox';"
```

```sql
# Connect to MySQL
docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop

# Check outbox status summary (replace ps_ with your prefix)
SELECT status, COUNT(*) as count 
FROM ps_openlinker_webhook_outbox 
GROUP BY status;

# Check recent events
SELECT id, event_type, external_id, status, attempts, created_at, delivered_at 
FROM ps_openlinker_webhook_outbox 
ORDER BY created_at DESC 
LIMIT 20;

# Check failed events
SELECT id, event_type, external_id, attempts, last_error, updated_at 
FROM ps_openlinker_webhook_outbox 
WHERE status = 'failed' 
ORDER BY updated_at DESC 
LIMIT 10;
```

## Troubleshooting

### Module Installation Disabled ("This functionality has been disabled")

**Error**: When clicking "Install" on a module, you see: "This functionality has been disabled"

**Common Causes & Solutions**:

1. **PrestaShop Demo Mode Enabled** (most common cause):
   - PrestaShop disables module installation when demo mode is active
   - Check if demo mode is enabled in `docker-compose.yml`: `PS_DEMO_MODE: 1`
   - **Solution**: Disable demo mode by editing the configuration file:
     ```bash
     # Edit defines.inc.php to disable demo mode
     docker compose exec prestashop sed -i "s/define('_PS_MODE_DEMO_', true);/define('_PS_MODE_DEMO_', false);/g" /var/www/html/config/defines.inc.php
     ```
   - Or manually edit the file:
     ```bash
     docker compose exec prestashop vi /var/www/html/config/defines.inc.php
     # Find: define('_PS_MODE_DEMO_', true);
     # Change to: define('_PS_MODE_DEMO_', false);
     ```
   - **Alternative**: Remove `PS_DEMO_MODE: 1` from `docker-compose.yml` and restart PrestaShop:
     ```bash
     # Edit docker-compose.yml: remove or set PS_DEMO_MODE: 0
     docker compose down prestashop
     docker compose up -d prestashop
     ```
   - After disabling demo mode, clear cache and refresh the module manager page

2. **PrestaShop not fully installed** (check this first if demo mode is already disabled):
   - Find the actual table prefix (may differ from `ps_`):
     ```bash
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_module';"
     ```
   - Should return a table like `ps_module` or `usesj_module` (prefix may vary)
   - If no `*_module` table exists, PrestaShop installation is incomplete
   - **Solution**: Wait for PrestaShop to finish installation (can take 1-2 minutes on first run)
   - Check PrestaShop logs: `docker logs openlinker-prestashop`
   - Access PrestaShop frontend: `http://localhost:8080` - if you see installer, let it complete
   - After installation completes, delete install folder (see #2 below)
   - **Note**: If tables exist with a different prefix (e.g., `usesj_` instead of `ps_`), PrestaShop IS installed - proceed to other solutions below

3. **Install folder exists** (most common after installation):
   ```bash
   docker compose exec prestashop rm -rf /var/www/html/install
   docker compose exec prestashop ls -la /var/www/html/ | grep install
   # Should return nothing
   ```

4. **File permissions issue** (if install folder already deleted):
   ```bash
   # Fix module directory permissions
   docker compose exec prestashop chown -R www-data:www-data /var/www/html/modules/openlinkerwebhooks
   docker compose exec prestashop chmod -R 755 /var/www/html/modules/openlinkerwebhooks
   ```

5. **PrestaShop cache needs clearing**:
   - Go to: **Advanced Parameters → Performance → Clear cache**
   - Or via command line:
     ```bash
     docker compose exec prestashop rm -rf /var/www/html/var/cache/*
     ```

6. **Module already partially installed**:
   - First, find your table prefix:
     ```bash
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_module';" | head -1
     ```
   - Extract the prefix (e.g., if table is `usesj_module`, prefix is `usesj_`)
   - Check if module exists (replace `PREFIX_` with your actual prefix):
     ```sql
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SELECT * FROM PREFIX_module WHERE name='openlinkerwebhooks';"
     ```
   - Example with `usesj_` prefix:
     ```sql
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SELECT * FROM usesj_module WHERE name='openlinkerwebhooks';"
     ```
   - If found but not working, try uninstalling first:
     - Go to: **Modules → Module Manager → OpenLinker Webhooks → Uninstall**
     - Then try installing again

7. **Try uploading as ZIP instead of bind-mount**:
   - Create ZIP: `cd apps/prestashop-module && zip -r openlinkerwebhooks.zip openlinkerwebhooks/`
   - In PrestaShop: **Modules → Module Manager → Upload a module**
   - Upload the ZIP file
   - Then install from the uploaded module

After trying these solutions, refresh the module manager page and try installing again.

### Module Not Appearing

- Clear PrestaShop cache: **Advanced Parameters → Performance → Clear cache**
- Check module directory exists: `docker exec openlinker-prestashop ls -la /var/www/html/modules/openlinkerwebhooks`
- Check PrestaShop logs for installation errors

### Configuration Page Error ("Oops... looks like an unexpected error occurred")

**Error**: When clicking "Configure" on the module, you see: "Oops... looks like an unexpected error occurred"

**Common Causes & Solutions**:

1. **Missing template variables** (most common):
   - The module code may be missing required Smarty template variables
   - **Solution**: Ensure you have the latest version of the module code
   - Check PrestaShop error logs: `docker logs openlinker-prestashop 2>&1 | grep -i error`
   - Or check PrestaShop backoffice: **Advanced Parameters → Logs**

2. **Class autoloading issues**:
   - Classes in `classes/` directory may not be autoloaded properly
   - **Solution**: Clear PrestaShop cache:
     ```bash
     docker compose exec prestashop rm -rf /var/www/html/var/cache/*
     ```
   - Or clear via backoffice: **Advanced Parameters → Performance → Clear cache**

3. **Missing outbox table**:
   - The outbox table may not have been created during installation
   - **Solution**: Check if table exists:
     ```sql
     -- Find your table prefix first
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_openlinker_webhook_outbox';"
     ```
   - If table doesn't exist, reinstall the module:
     - Go to: **Modules → Module Manager → OpenLinker Webhooks → Uninstall**
     - Then: **Modules → Module Manager → OpenLinker Webhooks → Install**

4. **File permissions**:
   - Module files may not have correct permissions
   - **Solution**: Fix permissions:
     ```bash
     docker compose exec prestashop chown -R www-data:www-data /var/www/html/modules/openlinkerwebhooks
     docker compose exec prestashop chmod -R 755 /var/www/html/modules/openlinkerwebhooks
     ```

5. **PHP errors**:
   - Check PrestaShop error logs for PHP fatal errors
   - **Solution**: View logs:
     ```bash
     docker logs openlinker-prestashop 2>&1 | tail -50
     ```
   - Or check PrestaShop backoffice: **Advanced Parameters → Logs**
   - Look for PHP errors, missing classes, or syntax errors

6. **Template file missing**:
   - The template file may not exist or be in wrong location
   - **Solution**: Verify template exists:
     ```bash
     docker compose exec prestashop ls -la /var/www/html/modules/openlinkerwebhooks/views/templates/admin/configure.tpl
     ```
   - Should show the file exists

**After fixing**: Clear cache and refresh the configuration page.

### Events Not Enqueued

- Verify hooks registered: **Modules → Module Manager → OpenLinker Webhooks → Hooks**
- Check event type toggles enabled in configuration
- Check PrestaShop logs for hook errors
- Verify connection ID is configured

### Events Not Delivered

- Check cron is running (or trigger manually)
- Verify OpenLinker API is reachable: `docker exec openlinker-prestashop curl -v http://host.docker.internal:3000`
- Check webhook secret matches OpenLinker configuration
- Check outbox table for stuck events
- Check OpenLinker API logs for errors

### Signature Verification Failures

- Verify webhook secret matches exactly (no extra spaces)
- Check OpenLinker API logs for signature verification errors
- Test with "Test Connection" button in module config

### Test Connection PHP Error

**Error**: When clicking "Test Connection", you see: "Oops... looks like an unexpected error occurred"

**Common Causes & Solutions**:

1. **Missing classes** (most common):
   - Required classes may not be loaded: `EventIdGenerator`, `OutboxEvent`, `OutboxRepository`, `WebhookSender`
   - **Solution**: Clear PrestaShop cache:
     ```bash
     docker compose exec prestashop rm -rf /var/www/html/var/cache/*
     ```
   - Or clear via backoffice: **Advanced Parameters → Performance → Clear cache**

2. **Missing outbox table**:
   - The outbox table may not have been created during installation
   - **Solution**: Check if table exists:
     ```sql
     -- Find your table prefix first
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_openlinker_webhook_outbox';"
     ```
   - If table doesn't exist, reinstall the module:
     - Go to: **Modules → Module Manager → OpenLinker Webhooks → Uninstall**
     - Then: **Modules → Module Manager → OpenLinker Webhooks → Install**

3. **Check PrestaShop error logs**:
   - View logs to see the actual PHP error:
     ```bash
     docker logs openlinker-prestashop 2>&1 | tail -100 | grep -i error
     ```
   - Or check PrestaShop backoffice: **Advanced Parameters → Logs**
   - Look for PHP errors, missing classes, or database errors

4. **Database connection issues**:
   - PrestaShop may not be able to connect to MySQL
   - **Solution**: Check MySQL is running:
     ```bash
     docker compose ps mysql
     ```
   - Check PrestaShop can connect:
     ```bash
     docker compose exec prestashop php -r "echo 'DB OK';"
     ```

5. **Configuration missing**:
   - Base URL, Connection ID, or Webhook Secret may not be configured
   - **Solution**: Ensure all required fields are filled and saved before testing

**After fixing**: Clear cache and try the test connection again.

### Product Save PHP Error

**Error**: When saving a product in PrestaShop admin (Catalog → Products → Add new product), you see a PHP error page

**Common Causes & Solutions**:

1. **Missing classes** (most common):
   - Required classes may not be loaded: `EventIdGenerator`, `OutboxRepository`
   - **Solution**: Clear PrestaShop cache:
     ```bash
     docker compose exec prestashop rm -rf /var/www/html/var/cache/*
     ```
   - Or clear via backoffice: **Advanced Parameters → Performance → Clear cache**

2. **Missing outbox table**:
   - The outbox table may not have been created during installation
   - **Solution**: Check if table exists:
     ```sql
     -- Find your table prefix first
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_openlinker_webhook_outbox';"
     ```
   - If table doesn't exist, reinstall the module:
     - Go to: **Modules → Module Manager → OpenLinker Webhooks → Uninstall**
     - Then: **Modules → Module Manager → OpenLinker Webhooks → Install**

3. **Check PrestaShop error logs**:
   - View logs to see the actual PHP error:
     ```bash
     docker logs openlinker-prestashop 2>&1 | tail -100 | grep -i "openlinker\|error\|fatal"
     ```
   - Or check PrestaShop backoffice: **Advanced Parameters → Logs**
   - Look for PHP errors, missing classes, or database errors

4. **Module not configured**:
   - Connection ID may not be set
   - **Solution**: Ensure module is configured with Connection ID before using hooks
   - Go to: **Modules → Module Manager → OpenLinker Webhooks → Configure**
   - Fill in Connection ID and save

5. **Product events disabled**:
   - Product events may be disabled in module configuration
   - **Solution**: Check module configuration:
     - Go to: **Modules → Module Manager → OpenLinker Webhooks → Configure**
     - Ensure "Enable Product Events" checkbox is checked
     - Click "Save"

**Note**: The hooks are designed to be non-fatal - even if they fail, they should log errors but not break PrestaShop functionality. If you're seeing a PHP error page, it means there's a fatal error (likely missing class or database issue).

**After fixing**: Clear cache and try saving a product again.

### Multiple Events Created for Single Product Save

**Issue**: When saving a product, you see 6 (or more) events created in the outbox table instead of 1.

**Root Cause**: This is **expected PrestaShop behavior**. The `actionProductSave` hook fires multiple times during a single product save operation because PrestaShop:
- Saves products in multiple phases (main record, languages, shops, attributes, stock, images, SEO)
- Calls the hook from multiple places in core code
- Processes multiple languages/shops if configured

**Solution**: The module implements **automatic deduplication** to prevent duplicate events:

1. **Deterministic Event IDs**: Event IDs are generated based on product ID + event type + time window (same minute)
2. **Database-Level Deduplication**: Uses `INSERT IGNORE` with unique constraint on `event_id`
3. **Result**: Only 1 event is created even if the hook fires 6+ times

**Verification**: Check that deduplication is working:

```sql
-- Should return 0 rows (no duplicates)
SELECT event_id, COUNT(*) as count
FROM ps_openlinker_webhook_outbox
GROUP BY event_id
HAVING count > 1;

-- Should see only 1 event per product save (within same minute)
SELECT id, event_type, external_id, created_at
FROM ps_openlinker_webhook_outbox
WHERE external_id = '23' AND event_type = 'product.saved'
ORDER BY created_at DESC;
```

**If you still see duplicates**:
1. Check `event_id` column has unique constraint: `SHOW CREATE TABLE ps_openlinker_webhook_outbox;`
2. Verify `EventIdGenerator::generateEventId()` uses deterministic logic (not random UUIDs)
3. Verify `OutboxRepository::enqueueEvent()` uses `INSERT IGNORE`

**Note**: Events created in different minutes are correctly treated as separate events (this is expected behavior).

### Events Stuck in Processing State

**Error**: Events show `status='processing'` in database but don't appear in diagnostics, and "Run Delivery Now" fails with SQL error

**Common Causes & Solutions**:

1. **SQL syntax error in stale row recovery** (most common):
   - The `requeueStaleProcessingRows()` method had incorrect SQL syntax
   - **Solution**: Ensure you have the latest module code with the fix
   - Clear PrestaShop cache:
     ```bash
     docker compose exec prestashop rm -rf /var/www/html/var/cache/*
     ```

2. **Stale processing rows**:
   - Events stuck in "processing" for more than 15 minutes
   - **Solution**: The "Run Delivery Now" button should automatically requeue them
   - If not working, manually requeue:
     ```sql
     -- Find your table prefix first
     docker exec -it openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SHOW TABLES LIKE '%_openlinker_webhook_outbox';"
     
     -- Manually requeue all stale processing rows (replace PREFIX_ with your actual prefix)
     UPDATE PREFIX_openlinker_webhook_outbox 
     SET status='pending', 
         processing_owner=NULL, 
         processing_started_at=NULL,
         last_error='Manually requeued (stale row)',
         updated_at=NOW()
     WHERE status='processing' 
     AND processing_started_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE);
     ```

3. **Diagnostics not showing processing events**:
   - Processing events should appear in diagnostics
   - **Solution**: Check if `getStatistics()` is working:
     - Go to: **Modules → Module Manager → OpenLinker Webhooks → Configure**
     - Check if "Processing Events" count is displayed
     - If showing 0 but database has processing events, check PrestaShop logs

4. **SQL syntax errors**:
   - Check PrestaShop error logs for SQL syntax errors
   - **Solution**: View logs:
     ```bash
     docker logs openlinker-prestashop 2>&1 | tail -100 | grep -i "sql\|error\|fatal"
     ```
   - Or check PrestaShop backoffice: **Advanced Parameters → Logs**

**After fixing**: Clear cache and try "Run Delivery Now" again. Stale processing rows should be automatically requeued.

### Understanding Event Statuses

**What the diagnostics mean**:
- **Pending Events**: Events waiting to be delivered (ready to process)
- **Processing Events**: Events currently being delivered (should be temporary)
- **Failed Events**: Events that reached max retry attempts
- **Delivered (Last 24h)**: Successfully delivered events in the last 24 hours

**Why you might see many "Processing Events"**:
- Events were claimed for delivery but the HTTP request timed out or failed
- The delivery process crashed before completing
- Events are stuck in "processing" state and need to be requeued

**To check what's happening with processing events**:
```sql
-- Check processing events (replace usesj_ with your prefix)
SELECT id, event_type, external_id, processing_owner, processing_started_at, 
       TIMESTAMPDIFF(MINUTE, processing_started_at, NOW()) as minutes_stuck,
       attempts, last_error
FROM usesj_openlinker_webhook_outbox 
WHERE status = 'processing'
ORDER BY processing_started_at ASC;
```

**To manually requeue all processing events**:
```sql
-- Requeue all processing events (replace usesj_ with your prefix)
UPDATE usesj_openlinker_webhook_outbox 
SET status='pending', 
    processing_owner=NULL, 
    processing_started_at=NULL,
    last_error='Manually requeued (stuck in processing)',
    updated_at=NOW()
WHERE status='processing';
```

**Note**: The "Run Delivery Now" button should automatically requeue all processing events before claiming new ones. If you still see processing events after clicking it, there may be an issue with the HTTP delivery (timeout, connection error, etc.).

## Quick Test Script

Here's a quick script to test the full flow:

```bash
#!/bin/bash

# Configuration
PRESTASHOP_URL="http://localhost:8080"
CRON_TOKEN="your-cron-token-here"
OPENLINKER_URL="http://localhost:3000"

echo "1. Testing cron endpoint..."
curl -s "${PRESTASHOP_URL}/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=${CRON_TOKEN}" | jq .

echo ""
echo "2. Checking outbox status..."
docker exec openlinker-mysql mysql -u prestashop -pprestashop prestashop -e "SELECT status, COUNT(*) as count FROM ps_openlinker_webhook_outbox GROUP BY status;"

echo ""
echo "3. Checking OpenLinker health..."
curl -s "${OPENLINKER_URL}/health" | jq .

echo ""
echo "Test complete!"
```

## Next Steps

After successful testing:

1. **Set up production cron**: Configure system cron for regular delivery
2. **Monitor diagnostics**: Check module diagnostics page regularly
3. **Review logs**: Monitor PrestaShop and OpenLinker logs for issues
4. **Scale testing**: Test with higher event volumes
5. **Production deployment**: Follow production deployment checklist

## Related Documentation

- [Module README](../../apps/prestashop-module/openlinkerwebhooks/README.md) - Complete module documentation
- [Implementation Plan](../prestashop-module-implementation-plan.md) - Architecture and design decisions
- [Webhook Overview](./webhooks/overview.md) - OpenLinker webhook ingestion system

