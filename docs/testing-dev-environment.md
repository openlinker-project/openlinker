# Testing the Development Environment

This guide provides step-by-step instructions for testing the development environment setup.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ and pnpm 9+ installed
- Ports 3000, 5432, 6379, 3306, and 8080 available

## Step 1: Install Dependencies

```bash
# Install all dependencies (including @nestjs/axios)
pnpm install
```

**Expected output**: Dependencies should install without errors.

## Step 2: Start the Development Stack

```bash
# Start all services (PostgreSQL, Redis, MySQL, PrestaShop)
pnpm dev:stack:up
```

**Expected output**:
```
[+] Running 4/4
 ✔ Container openlinker-postgres    Started
 ✔ Container openlinker-redis       Started
 ✔ Container openlinker-mysql       Started
 ✔ Container openlinker-prestashop   Started
```

**Wait time**: PrestaShop installation takes 2-3 minutes on first startup.

## Step 3: Verify Services Are Running

```bash
# Check container status
docker compose ps
```

**Expected output**: All services should show `Up` status:
```
NAME                    STATUS
openlinker-postgres     Up (healthy)
openlinker-redis        Up (healthy)
openlinker-mysql        Up (healthy)
openlinker-prestashop   Up (healthy)
```

If PrestaShop shows `Up (starting)` or `Up (unhealthy)`, wait a bit longer (up to 3 minutes for first-time installation).

## Step 4: Check Service Logs

```bash
# View all logs
pnpm dev:stack:logs

# Or view specific service logs
docker compose logs -f prestashop
docker compose logs -f mysql
```

**What to look for**:
- **PrestaShop**: Should show installation progress, then "Installation complete"
- **MySQL**: Should show "ready for connections"
- **PostgreSQL**: Should show "database system is ready to accept connections"
- **Redis**: Should show "Ready to accept connections"

## Step 5: Test Internal Health Endpoint

```bash
# Test the internal health endpoint (PostgreSQL + Redis only)
curl http://localhost:3000/health
```

**Expected response**:
```json
{
  "status": "ok"
}
```

**Note**: This endpoint should work even if PrestaShop is down (it only checks internal dependencies).

## Step 6: Test Dev Stack Health Endpoint

```bash
# Test the dev stack health endpoint (includes PrestaShop)
pnpm dev:health

# Or manually:
curl http://localhost:3000/health/dev-stack
```

**Expected response** (all services healthy):
```json
{
  "status": "ok",
  "services": {
    "postgres": { "status": "ok" },
    "redis": { "status": "ok" },
    "prestashop": { "status": "ok" }
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Expected response** (PrestaShop down - degraded status):
```json
{
  "status": "degraded",
  "services": {
    "postgres": { "status": "ok" },
    "redis": { "status": "ok" },
    "prestashop": { 
      "status": "error", 
      "message": "PrestaShop is unreachable" 
    }
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

## Step 7: Verify PrestaShop is Accessible

```bash
# Open in browser or use curl
curl -I http://localhost:8080
```

**Expected response**: HTTP 200 OK or HTTP 302 (redirect to login)

**Browser test**: Open `http://localhost:8080` in your browser. You should see the PrestaShop storefront.

## Step 8: Test Degraded Status Scenario

Test that the API correctly reports `degraded` status when PrestaShop is down:

```bash
# Stop PrestaShop
docker compose stop prestashop

# Check health (should show degraded)
pnpm dev:health

# Verify internal health still works
curl http://localhost:3000/health

# Restart PrestaShop
docker compose start prestashop
```

**Expected behavior**:
- `/health` should still return `{ "status": "ok" }` (internal services are up)
- `/health/dev-stack` should return `{ "status": "degraded" }` (external service is down)

## Step 9: Test Error Status Scenario

Test that the API correctly reports `error` status when internal services are down:

```bash
# Stop PostgreSQL
docker compose stop postgres

# Check health (should show error)
pnpm dev:health

# Restart PostgreSQL
docker compose start postgres
```

**Expected behavior**:
- `/health` should return `{ "status": "ok" }` only after PostgreSQL is back up
- `/health/dev-stack` should return `{ "status": "error" }` when PostgreSQL is down

## Step 10: Verify PrestaShop Demo Data

```bash
# Check PrestaShop admin panel (if you have admin credentials)
# Or verify via API health check that PrestaShop is responding
curl http://localhost:8080
```

**Expected**: PrestaShop should be accessible and show demo products.

## Step 11: Test API Startup Without PrestaShop

Verify that the API can start even if PrestaShop is not running:

```bash
# Stop PrestaShop
docker compose stop prestashop

# Restart API (if running in Docker)
docker compose restart api

# Or start API locally
pnpm start:dev

# Check health
pnpm dev:health
```

**Expected**: API should start successfully, and health check should show `degraded` status.

## Step 12: Test Redis Streams Health Check

The health check tests Redis Streams functionality. Verify it's working:

```bash
# Check Redis directly
docker compose exec redis redis-cli ping

# Check if healthcheck stream exists
docker compose exec redis redis-cli XINFO STREAM healthcheck
```

**Expected**: Stream should exist and have recent entries (capped at 1 entry due to MAXLEN).

## Troubleshooting

### PrestaShop Not Starting

**Symptoms**: Container keeps restarting or shows unhealthy status

**Solutions**:
1. Check logs: `docker compose logs -f prestashop`
2. Verify MySQL is healthy: `docker compose ps mysql`
3. Wait longer (first installation takes 2-3 minutes)
4. Reset installation:
   ```bash
   docker compose down
   docker volume rm openlinker_prestashop_data openlinker_mysql_data
   pnpm dev:stack:up
   ```

### Health Check Timeout

**Symptoms**: Health check takes too long or times out

**Solutions**:
1. Check service logs for errors
2. Verify network connectivity between containers
3. Increase timeout in `dev-stack-health.service.ts` if needed (default: 5 seconds)

### Port Conflicts

**Symptoms**: Services fail to start with "port already in use" error

**Solutions**:
1. Check what's using the port:
   ```bash
   # macOS/Linux
   lsof -i :8080
   
   # Or
   docker ps
   ```
2. Stop conflicting services or change ports in `docker-compose.yml`

### API Cannot Connect to Services

**Symptoms**: Health check shows errors for PostgreSQL or Redis

**Solutions**:
1. Verify services are running: `docker compose ps`
2. Check environment variables in `apps/api/.env`
3. Verify network: `docker compose exec api ping postgres`
4. Check service logs: `docker compose logs postgres redis`

## Automated Testing Script

You can create a simple test script:

```bash
#!/bin/bash
# test-dev-stack.sh

echo "Starting dev stack..."
pnpm dev:stack:up

echo "Waiting for services to be ready..."
sleep 30

echo "Testing internal health..."
curl -s http://localhost:3000/health | jq .

echo "Testing dev stack health..."
pnpm dev:health

echo "Testing PrestaShop accessibility..."
curl -I http://localhost:8080

echo "Done!"
```

## Next Steps

After successful testing:

1. **Configure PrestaShop Webservice API** (see `docs/dev-environment.md`)
2. **Start developing** adapters or features
3. **Run tests**: `pnpm test`
4. **Review architecture**: Read `docs/architecture-overview.md`

## Related Documentation

- [Development Environment Guide](./dev-environment.md) - Full setup instructions
- [Architecture Overview](./architecture-overview.md) - System architecture
- [Engineering Standards](./engineering-standards.md) - Coding standards

