# Development Environment Setup

This guide explains how to set up and use the local development environment for OpenLinker, including PrestaShop, PostgreSQL, Redis, and MySQL services.

## Quick Start

1. **Start the development stack:**
   ```bash
   pnpm dev:stack:up
   ```

2. **Check health status:**
   ```bash
   pnpm dev:health
   ```

3. **View logs:**
   ```bash
   pnpm dev:stack:logs
   ```

4. **Stop the stack:**
   ```bash
   pnpm dev:stack:down
   ```

## Service URLs and Ports

| Service | URL/Port | Description |
|---------|----------|-------------|
| PostgreSQL | `localhost:5432` | Main database for OpenLinker |
| Redis | `localhost:6379` | Event bus and caching |
| MySQL | `localhost:3306` | Database for PrestaShop |
| phpMyAdmin | `http://localhost:8081` | Web-based MySQL administration tool |
| PrestaShop | `http://localhost:8080` | E-commerce platform (external dependency) |
| API | `http://localhost:3000` | OpenLinker API |

## Default Credentials

### PostgreSQL
- **Host**: `localhost:5432`
- **Username**: `postgres`
- **Password**: `postgres`
- **Database**: `openlinker`

> ⚠️ **Warning**: These credentials are for development only. Never use them in production.

### PrestaShop
- **URL**: `http://localhost:8080`
- **Admin Panel**: `http://localhost:8080/admin-dev/`
- **Admin Credentials**: Set in `docker-compose.yml` and seeded by the post-install scripts (see [Getting Started](./getting-started.md))
- **Note**: PrestaShop's installer initially creates a randomized admin folder for security. The post-install wrapper (`docker/prestashop/post-install/10-rename-admin.sh`) renames it to the stable `/admin-dev/` path so dev URLs and bookmarks don't drift between fresh installs.
- **Database**: 
  - **Host**: `mysql` (internal Docker network) or `localhost:3306` (external)
  - **Database**: `prestashop`
  - **Username**: `prestashop`
  - **Password**: `prestashop`

### MySQL
- **Host**: `localhost:3306`
- **Root Password**: `root`
- **Database**: `prestashop`
- **Username**: `prestashop`
- **Password**: `prestashop`

### phpMyAdmin
- **URL**: `http://localhost:8081`
- **Server**: `mysql` (or use `localhost:3306` from host)
- **Username**: `root` (or `prestashop`)
- **Password**: `root` (or `prestashop`)
- **Note**: Pre-configured to connect to the MySQL service in the Docker network

## Running the Stack

### Start Services

```bash
# Start all services (PostgreSQL, Redis, MySQL, phpMyAdmin, PrestaShop)
pnpm dev:stack:up

# Or using docker compose directly
docker compose up -d postgres redis mysql phpmyadmin prestashop
```

### Stop Services

```bash
# Stop all services
pnpm dev:stack:down

# Or using docker compose directly
docker compose down
```

### View Logs

```bash
# View all logs
pnpm dev:stack:logs

# View logs for specific service
docker compose logs -f prestashop
docker compose logs -f mysql
docker compose logs -f phpmyadmin
docker compose logs -f postgres
docker compose logs -f redis
```

### Reset Services

To reset PrestaShop to a fresh installation with demo data:

```bash
# Stop services
docker compose down

# Remove volumes (⚠️ This deletes all data)
docker volume rm openlinker_prestashop_data openlinker_mysql_data

# Start services again
pnpm dev:stack:up
```

## Health Verification

### Health Check Endpoints

OpenLinker provides two health check endpoints:

1. **`GET /health`** - Internal dependencies only
   - Checks: PostgreSQL, Redis
   - Used by: Monitoring, PM2, Kubernetes
   - Returns: `{ status: 'ok' }` when internal services are healthy

2. **`GET /health/dev-stack`** - Development stack (internal + external)
   - Checks: PostgreSQL, Redis, PrestaShop
   - Used by: Local development troubleshooting
   - Returns: Detailed status for each service

### Using Health Checks

```bash
# Check internal health
curl http://localhost:3000/health

# Check dev stack health (with PrestaShop)
pnpm dev:health

# Or manually
curl http://localhost:3000/health/dev-stack
```

### Expected Responses

**Internal Health (`/health`):**
```json
{
  "status": "ok"
}
```

**Dev Stack Health (`/health/dev-stack`):**
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

**Degraded Status (PrestaShop down):**
```json
{
  "status": "degraded",
  "services": {
    "postgres": { "status": "ok" },
    "redis": { "status": "ok" },
    "prestashop": { "status": "error", "message": "PrestaShop is unreachable" }
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

> **Note**: PrestaShop is treated as an external dependency. If it's unreachable, the status is `degraded` (not `error`), allowing OpenLinker to continue operating.

## PrestaShop Setup

### Initial Installation

PrestaShop is configured to auto-install on first startup using environment variables in `docker-compose.yml`. The installation includes:

- Demo data enabled (`PS_DEMO_MODE=1`)
- Default language: English (US)
- Admin folder: renamed to stable `/admin-dev/` by `docker/prestashop/post-install/10-rename-admin.sh` (PrestaShop's installer generates a random folder for security; the wrapper renames it to a known path so dev URLs are stable)

### Accessing PrestaShop

1. **Frontend**: `http://localhost:8080`
2. **Admin Panel**: `http://localhost:8080/admin-dev/login`

### Post-Installation Security Step

**Important**: After installation, you must delete the `/install` folder before accessing the admin panel:

```bash
docker compose exec prestashop rm -rf /var/www/html/install
```

PrestaShop will show a security warning until this folder is deleted.

### PrestaShop Webservice API Setup

To use PrestaShop adapters (future work), you need to enable and configure the Webservice API:

1. **Log in to PrestaShop Admin Panel**
   - Navigate to `http://localhost:8080/admin`
   - Use the admin credentials set during installation

2. **Enable Webservice**
   - Go to **Advanced Parameters** → **Webservice**
   - Enable "Enable PrestaShop Webservice"
   - Save

3. **Generate API Key**
   - Click **Add new key**
   - Set permissions (minimum: Products, Stock, Orders)
   - Generate key
   - Copy the generated API key

4. **Store API Key**
   - Add to `apps/api/.env`:
     ```env
     PRESTASHOP_API_KEY=your-generated-api-key-here
     ```
   - Or store in `Connection` entity (for connection-specific config)

### Verifying Demo Data

After PrestaShop installation, verify demo data is present:

1. **Check Products**
   - Navigate to `http://localhost:8080`
   - You should see sample products in the catalog

2. **Check Admin Panel**
   - Navigate to `http://localhost:8080/admin`
   - Go to **Catalog** → **Products**
   - You should see multiple demo products with stock

3. **Check Stock Levels**
   - In admin panel, go to **Stock** → **Stock**
   - Verify products have non-zero stock levels

## Common Issues

### Port Conflicts

**Problem**: Port already in use (5432, 6379, 3306, 8080)

**Solution**:
1. Check what's using the port:
   ```bash
   # macOS/Linux
   lsof -i :8080
   
   # Or using docker
   docker ps
   ```
2. Stop the conflicting service or change the port in `docker-compose.yml`

### Container Startup Failures

**Problem**: Services fail to start

**Solution**:
1. Check logs:
   ```bash
   docker compose logs [service-name]
   ```
2. Verify Docker is running
3. Check available disk space: `docker system df`
4. Try restarting: `docker compose restart [service-name]`

### Database Connection Issues

**Problem**: API cannot connect to PostgreSQL/Redis

**Solution**:
1. Verify services are running: `docker compose ps`
2. Check health: `pnpm dev:health`
3. Verify environment variables in `apps/api/.env`
4. Check network connectivity: `docker compose exec api ping postgres`

### PrestaShop Installation Problems

**Problem**: PrestaShop fails to install or doesn't load

**Solution**:
1. Check PrestaShop logs:
   ```bash
   docker compose logs -f prestashop
   ```
2. Verify MySQL is healthy: `docker compose ps mysql`
3. Check PrestaShop health check:
   ```bash
   docker compose exec prestashop curl -f http://localhost:80/
   ```
4. Reset installation (see Reset Services above)

### PrestaShop Not Accessible

**Problem**: Cannot access `http://localhost:8080`

**Solution**:
1. Verify container is running: `docker compose ps prestashop`
2. Check port mapping: `docker compose ps` (should show `0.0.0.0:8080->80/tcp`)
3. Wait for installation to complete (can take 2-3 minutes on first start)
4. Check health: `pnpm dev:health`

## Fixtures

### Demo Data

PrestaShop is configured with demo data enabled (`PS_DEMO_MODE=1`). This provides:

- Sample products with stock
- Product categories
- Product variants (if available in demo data)
- Sample customers and orders

### Resetting Demo Data

To reset to fresh demo data:

```bash
# Stop services
docker compose down

# Remove PrestaShop and MySQL volumes
docker volume rm openlinker_prestashop_data openlinker_mysql_data

# Start services (PrestaShop will reinstall with demo data)
pnpm dev:stack:up
```

> **Note**: This will delete all PrestaShop data, including any custom products or configurations.

## Environment Variables

### API Configuration

Update `apps/api/.env` with PrestaShop settings:

```env
# PrestaShop Configuration
PRESTASHOP_BASE_URL=http://localhost:8080
PRESTASHOP_API_KEY=your-prestashop-webservice-api-key
PRESTASHOP_WEBHOOK_SECRET=your-webhook-secret-optional
```

> **Note**: These settings are placeholders for development. Future adapters will use the `Connection` entity to store connection-specific configuration.

## Troubleshooting

### Service Dependencies

- **API** depends on: PostgreSQL, Redis (must be healthy)
- **PrestaShop** depends on: MySQL (must be healthy)
- **API** can boot even if PrestaShop is down (external dependency)

### Health Check Statuses

- **`ok`**: All services (including PrestaShop) are healthy
- **`degraded`**: Internal services (PostgreSQL, Redis) are healthy, but PrestaShop is unreachable
- **`error`**: One or more internal services (PostgreSQL or Redis) are down

### Getting Help

If you encounter issues not covered here:

1. Check service logs: `docker compose logs -f [service]`
2. Verify health status: `pnpm dev:health`
3. Review [Architecture Overview](./architecture-overview.md)
4. Check [Engineering Standards](./engineering-standards.md)
5. Open an issue on GitHub

## Related Documentation

- [Testing Guide](./testing-guide.md) - **Comprehensive testing documentation** (unit tests, integration tests, Testcontainers)
- [Architecture Overview](./architecture-overview.md) - System architecture
- [Engineering Standards](./engineering-standards.md) - Coding standards
- [AI Coding Assistant Guide](./ai-coding-assistant.md) - Behaviour, reasoning expectations and guardrails for AI coding assistants
- [Database Migrations](./migrations.md) - Migration workflow

