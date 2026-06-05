# OpenLinker Testing Guide

**Date**: 2025-12-28  
**Status**: ✅ Active

This guide explains OpenLinker's testing approach, covering unit tests, integration tests, Testcontainers, and best practices.

---

## Table of Contents

1. [Overview](#overview)
2. [Test Types](#test-types)
3. [Testcontainers Explained](#testcontainers-explained)
4. [Running Tests](#running-tests)
5. [Test Organization](#test-organization)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)
8. [Related Documentation](#related-documentation)

---

## Overview

OpenLinker follows the **Test Pyramid** approach, with comprehensive unit tests and targeted integration tests:

```
                    ┌─────────────┐
                    │   E2E Tests │  (Future: Optional nightly suite)
                    │  (Optional) │
                    └─────────────┘
                 ┌───────────────────┐
                 │ Integration Tests │  Real Postgres/Redis + Nest wiring
                 │ (Testcontainers)   │  Mocked external adapters
                 └───────────────────┘
              ┌─────────────────────────┐
              │   Unit Tests             │  Pure domain logic, mocked dependencies
              │   (Comprehensive)       │
              └─────────────────────────┘
```

### Quick Reference

| Test Type | Command | Speed | Requirements | Location |
|-----------|--------|-------|---------------|----------|
| **Unit Tests** | `pnpm test` | Fast (~2-3s) | None | `src/**/*.spec.ts` |
| **Integration Tests** | `pnpm test:integration` | Slow (~10-15s) | Docker | `test/integration/**/*.int-spec.ts` |

---

## Test Types

### Unit Tests

**Purpose**: Test individual components in isolation with mocked dependencies.

**Characteristics**:
- ✅ **Fast**: Execute in milliseconds/seconds
- ✅ **Isolated**: No external dependencies
- ✅ **Parallel**: Can run concurrently
- ✅ **Comprehensive**: Cover all business logic, edge cases, error handling

**What They Test**:
- Domain logic (entities, value objects, services)
- Business rules and validations
- Data transformations (mappers)
- Error handling
- Edge cases (null, undefined, invalid inputs)

**Example**:
```typescript
// src/integrations/application/services/connection.service.spec.ts
describe('ConnectionService', () => {
  it('should create connection with valid data', async () => {
    const mockRepository = createMockConnectionRepository();
    const service = new ConnectionService(mockRepository);
    
    const result = await service.create(validConnectionDto);
    
    expect(result).toBeDefined();
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
```

**Location**: `src/**/*.spec.ts`  
**Command**: `pnpm test`

---

### Integration Tests

**Purpose**: Test multiple components working together with real infrastructure.

**Characteristics**:
- ⏱️ **Slower**: Require container startup, app boot, migrations (~10-15s)
- 🐳 **Requires Docker**: Uses Testcontainers for PostgreSQL and Redis
- 🔄 **Serial Execution**: Must run sequentially (`maxWorkers: 1`)
- 🎯 **Targeted**: Focus on critical vertical slices

**What They Test**:
- Full HTTP → Controller → Service → Repository → Database flow
- Real database operations (TypeORM, migrations, constraints)
- NestJS module wiring (DI, validation pipes, interceptors)
- End-to-end request/response cycles
- Multi-component interactions

**Example**:
```typescript
// test/integration/connection-crud.int-spec.ts
describe('Connection CRUD Integration', () => {
  it('should create connection and persist to database', async () => {
    const createDto = createPrestashopConnectionDto();
    
    const response = await harness.getHttp()
      .post('/connections')
      .send(createDto)
      .expect(201);
    
    // Verify HTTP response
    expect(response.body.name).toBe(createDto.name);
    
    // Verify database persistence
    const dbConnection = await getConnectionById(
      harness.getDataSource(),
      response.body.id
    );
    expect(dbConnection).toBeDefined();
  });
});
```

**Location**: `test/integration/**/*.int-spec.ts`  
**Command**: `pnpm test:integration`

---

## Testcontainers Explained

### What is Testcontainers?

[Testcontainers](https://www.testcontainers.org/) is a Java library that provides lightweight, throwaway instances of common databases, Selenium web browsers, or anything else that can run in a Docker container. For Node.js, we use `@testcontainers/postgresql` and `@testcontainers/redis`.

### Why Use Testcontainers?

**Problem**: Integration tests need real databases, but:
- ❌ Shared databases cause test interference
- ❌ Manual database setup is error-prone
- ❌ CI/CD environments need isolated databases
- ❌ Different developers have different database versions

**Solution**: Testcontainers spins up **ephemeral Docker containers** for each test run:
- ✅ **Isolated**: Each test run gets a fresh database
- ✅ **Automatic**: No manual setup required
- ✅ **Consistent**: Same database version across all environments
- ✅ **Clean**: Containers are destroyed after tests complete

### How It Works

```typescript
// test/integration/setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

async setup(): Promise<void> {
  // 1. Start PostgreSQL container
  this.postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('openlinker_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  // 2. Start Redis container
  this.redisContainer = await new RedisContainer('redis:7-alpine').start();

  // 3. Override environment variables with container ports
  process.env.DB_HOST = this.postgresContainer.getHost();
  process.env.DB_PORT = String(this.postgresContainer.getPort());
  process.env.REDIS_HOST = this.redisContainer.getHost();
  process.env.REDIS_PORT = String(this.redisContainer.getPort());

  // 4. Boot NestJS app (connects to containers)
  this.app = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // 5. Run migrations
  await this.dataSource.runMigrations();
}
```

### Testcontainers Lifecycle

1. **Before Tests**: Containers start, database is initialized, migrations run
2. **During Tests**: Each test uses the same containers (shared harness)
3. **Between Tests**: Database is reset (truncated), Redis is flushed
4. **After Tests**: Containers are stopped and removed

### Benefits

| Benefit | Description |
|---------|-------------|
| **Isolation** | Each test run gets a fresh database, no interference |
| **Reproducibility** | Same database version (PostgreSQL 16) across all environments |
| **No Manual Setup** | No need to install PostgreSQL/Redis locally |
| **CI/CD Ready** | Works identically in local and CI environments |
| **Fast Cleanup** | Containers are destroyed automatically after tests |

### Requirements

- ✅ **Docker** must be installed and running
- ✅ **Docker Compose** (optional, for dev stack)
- ✅ **Sufficient resources**: ~500MB RAM per container

### Container Images

- **PostgreSQL**: `postgres:16-alpine` (lightweight, production-like)
- **Redis**: `redis:7-alpine` (lightweight, production-like)

---

## PrestaShop Testcontainer Pattern (#506)

A second, **opt-in** Testcontainer pattern lives in
`apps/api/test/integration/helpers/prestashop-container.helper.ts`. It boots a
real PrestaShop 9.0.x instance (PS image + MySQL 8.4 companion) and seeds the
minimum DB state the carrier-mapping vertical-slice int-spec needs (#506).

### When to use it

Use this harness when an int-spec needs to verify behaviour that depends on
PrestaShop's actual response — typically because a unit test asserts request
*shape* but not what PS does with that shape. The current motivating bugs
(#503 cart `id_carrier`, #505 customer-group provisioning, #467 zone-zero
shipping) all surface this way.

For everything else, prefer mocking `OrderProcessorManagerPort` /
`ProductMasterPort` / etc. The PS Testcontainer is **not** a replacement for
adapter unit tests — it's a backstop for the small set of behaviours where PS
is the source of truth.

### How to opt in

```typescript
import {
  startPrestashopContainer,
  PrestashopTestContainer,
} from '../helpers/prestashop-container.helper';

describe('My PS-dependent int-spec', () => {
  let prestashop: PrestashopTestContainer;

  beforeAll(async () => {
    prestashop = await startPrestashopContainer();
    // prestashop.baseUrl, prestashop.webserviceApiKey,
    // prestashop.olDynamicCarrierId, prestashop.plnCurrencyId
  }, 15 * 60_000); // long timeout — first-run image pull is slow

  afterAll(async () => {
    if (prestashop) await prestashop.cleanup();
  });

  // ... tests ...
});
```

The harness is **suite-scoped** — one boot per int-spec file, NOT global. The
existing `getTestHarness()` (Postgres + Redis) is unaffected; you can use both
in the same spec.

### Boot-time budget

| Cache state | Realistic boot time |
|---|---|
| Warm Docker image cache (developer laptop, CI re-runs) | 60-90 s |
| Cold cache (CI first run, image pull + auto-install) | 5-10 min |

The wait strategy polls MySQL for `ps_configuration.PS_VERSION_DB`; PS writes
that row only at the very end of auto-install, so it's the most reliable
completion signal (HTTP probes race the install). Default deadline is 12 min.

### What gets seeded

`startPrestashopContainer` runs an opt-in install phase plus an always-on
fixture phase against a fresh PS install:

**Phase 1 (opt-in) — `installOpenLinkerModuleIntoContainer` (#692, closes #513):**
Triggered only when the caller passes `{ installOlModule: true }`. The real
OpenLinker PrestaShop module is copied into the container at
`/var/www/html/modules/openlinker` (via testcontainers' post-start
`copyDirectoriesToContainer`) and installed via `php bin/console prestashop:module install openlinker`,
followed by an `uninstall + install` cycle to dodge the PS 9.0.2 Symfony-installer
flake where the legacy `install()` hook is skipped on first invocation. After
install, the helper SQL-upserts `OPENLINKER_WEBHOOK_SECRET` into
`ps_configuration` (the module's `setDefaultConfiguration()` reset it to
empty string), then verifies the carrier row + sidecar table + secret all
landed. This is what makes the `writeCartShipping` → `cartshipping.php` HMAC
round-trip exercise-able from S-3.

**When NOT to opt in**: specs that don't exercise the OL Dynamic carrier
round-trip should leave `installOlModule` at its `false` default — keeps boot
fast AND avoids the install path's known CI failure mode (works on macOS
Docker-Desktop, currently flakes on the self-hosted Linux runner — root cause
TBD). Today only `allegro-prestashop-carrier-mapping.int-spec.ts` opts in;
`prestashop-harness-smoke.int-spec.ts` and `prestashop-webhook-provisioning.int-spec.ts`
do not.

**CI gate**: specs that need the OL module today gate on `process.env.CI !== 'true'`
(see `INSTALL_OL_MODULE` in `allegro-prestashop-carrier-mapping.int-spec.ts`).
In CI mode the test that exercises the module path (S-3 today) is reported
as `it.skip` instead of failing. Other scenarios in the same spec (S-1, S-2)
still run because they don't need the module. Three overrides:

- `OL_SKIP_PS_MODULE_INSTALL=true` — force-skip the install (developers
  reproducing the CI behavior locally).
- `OL_FORCE_PS_MODULE_INSTALL=true` — force-enable the install even in
  CI. Used for **diagnostic CI runs** that intentionally exercise the
  failing install path to root-cause it. S-3 will still likely fail under
  this flag — the goal is to capture data via the in-container log dumps,
  not to pass.

When the install-in-CI root cause is fixed, drop the gate and re-enable
S-3 in CI.

**Diagnostic dumps on PS startup failure** (`prestashop-container.helper.ts`):
when `verifyApacheUp` fails, the catch block emits the following via
`console.error` (captured by GitHub Actions):

- testcontainers' streaming log buffer for both PS and MySQL.
- `docker logs --tail 200` + `docker inspect` for both containers
  (status, exit code, OOM flag).
- Body of the last failed `/api/carriers` probe (Symfony renders its
  exception stack trace inline in 500 bodies).
- An in-container `sh -c` dump of `/var/log/apache2/error.log`,
  `/var/log/apache2/access.log`, `/var/www/html/var/logs/*.log`,
  `/var/www/html/cache/log/*.log`, and `ls -la /var/www/html/modules/openlinker`.

Additionally, when `CI=true`, `runExecOrThrow` emits `stdout` and `stderr`
from every `prestashop:module install/uninstall` invocation on the
success path too (not just on non-zero exit), so the install cycle's
output is visible even when each individual `bin/console` call succeeds
but leaves PS in a broken state.

**Phase 2 (always) — `applyPrestashopFixture` inserts:**

1. A **WS API key** (random per run) granted CRUD on the resources our
   adapters touch (carriers, carts, orders, customers, addresses, products,
   currencies, languages, …).
2. The **OpenLinker Dynamic carrier** — `seedOlDynamicCarrier` early-returns
   when it finds the module-installed row from Phase 1 (matched by
   `external_module_name='openlinker'`), so the helper acts as a no-op when
   the real module is present. The function retains its SQL-stub branch for
   diagnostic resilience: if a future PS-version regression breaks the module
   install path, the stub provides enough of a row for `discoverDynamicCarrierId()`
   to succeed and surface a more actionable downstream failure. Source of
   truth for the real install hook (carrier metadata, zones, logo, config key)
   is `apps/prestashop-module/openlinker/openlinker.php`'s
   `installDynamicCarrier()` method.
3. The **PLN currency** (PS install with `PS_COUNTRY=us|en` defaults to
   USD/EUR; the spec mirrors an Allegro-PL order). Seeded with
   `conversion_rate = 1.0` to keep `total_shipping == 12.50` literal in the
   order currency — a realistic 4.5 PLN/EUR rate would scale shop-currency
   delivery prices through to PLN and break the spec's value assertions.
   Specs that need realistic FX behaviour should override this in their
   own setup.

### Pinned versions

- PrestaShop: `prestashop/prestashop:9.0.2-2.0-classic-8.4` (matches dev-stack)
- MySQL: `mysql:8.4`

When the dev-stack PS image is bumped, this helper must follow — keep the
two pins aligned to avoid version-drift bugs that would only surface in CI.

### File placement

PS-Testcontainer int-specs live under `apps/api/test/integration/prestashop/`.
The carrier-mapping smoke spec at `apps/api/test/integration/orders/` predates
this convention and stays where it is for now (it's an orders-flow assertion
that happens to use the harness); new specs whose primary subject is the PS
adapter belong under `prestashop/`.

### Vertical-slice example: carrier mapping (#535)

`apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts`
is the reference example of layering a vertical slice on top of this harness.
It exercises `OrderIngestionService.syncOrderFromSource` end-to-end with a
stubbed Allegro source (registered via the public
`AdapterRegistryService` + `AdapterFactoryResolverService` seams) and a real
PrestaShop destination. The S-1 / S-2 split covers the two practical branches
of the #516 carrier-resolution chain (mapped vs `defaultCarrierId` fallback).
When adding a new vertical-slice spec, copy the structure: one suite-scoped
PS container in `beforeAll`, fixtures + helpers under
`apps/api/test/integration/{fixtures,helpers}/`, and assertions via the same
PS WS endpoints the production adapter uses (no direct MySQL reads from the
test body).

---

## Running Tests

### Unit Tests

```bash
# Run all unit tests
pnpm test

# Run in watch mode (auto-rerun on file changes)
pnpm test:watch

# Run with coverage
pnpm test:cov

# Run specific test file
pnpm test connection.service.spec.ts

# Run tests matching pattern
pnpm test --testNamePattern="should create connection"
```

**Expected Output**:
```
PASS  src/integrations/application/services/connection.service.spec.ts
  ConnectionService
    ✓ should create connection with valid data (5ms)
    ✓ should throw error for invalid data (3ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Time:        2.345 s
```

---

### Integration Tests

```bash
# Run all integration tests
pnpm test:integration

# Run specific integration test file
pnpm test:integration connection-crud.int-spec.ts

# Run with verbose output
pnpm test:integration --verbose
```

**Prerequisites**:
- ✅ Docker must be running
- ✅ Sufficient disk space (~1GB for container images)

**Expected Output**:
```
PASS  test/integration/connection-crud.int-spec.ts
  Connection CRUD Integration
    POST /connections
      ✓ should create connection and persist to database (1234ms)
      ✓ should return 400 for invalid input (456ms)
    GET /connections
      ✓ should retrieve all connections from database (789ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Time:        12.456 s
```

**First Run**: May take longer (~30s) as Docker downloads container images.

---

### Running Both Test Suites

```bash
# Run unit tests, then integration tests
pnpm test && pnpm test:integration

# Or create a combined script (optional)
# In package.json:
# "test:all": "pnpm test && pnpm test:integration"
```

**Note**: Integration tests are **not** included in `pnpm test` by design. See [Test Organization](#test-organization) for rationale.

---

## Test Organization

> **Plugin authors**: the integration-test harness is published as
> `@openlinker/test-kit` (#600). For wiring it into a plugin package's own
> `*.int-spec.ts` files, see
> [`docs/plugin-author-guide.md § Step 10 — Tests § Integration tests`](./plugin-author-guide.md#integration-tests-int-spects).

### File Naming Conventions

| Test Type | Pattern | Example |
|-----------|---------|---------|
| **Unit Tests** | `*.spec.ts` | `connection.service.spec.ts` |
| **Integration Tests** | `*.int-spec.ts` | `connection-crud.int-spec.ts` |

### Directory Structure

```
apps/api/
├── src/
│   ├── integrations/
│   │   ├── application/
│   │   │   └── services/
│   │   │       ├── connection.service.ts
│   │   │       └── connection.service.spec.ts  ← Unit test
│   │   └── http/
│   │       ├── connection.controller.ts
│   │       └── connection.controller.spec.ts  ← Unit test
│   └── ...
└── test/
    └── integration/
        ├── setup.ts                    ← Test harness
        ├── teardown.ts                 ← Global teardown
        ├── app-boot.int-spec.ts        ← Integration test
        ├── connection-crud.int-spec.ts ← Integration test
        ├── helpers/
        │   ├── test-database.helper.ts
        │   └── test-connection.helper.ts
        └── fixtures/
            └── connection.fixtures.ts
```

### Why Separate Commands?

**`pnpm test`** (unit tests only):
- ✅ **Fast feedback**: Developers get instant results during development
- ✅ **No dependencies**: Works without Docker
- ✅ **Parallel execution**: Faster overall
- ✅ **TDD-friendly**: Quick iteration cycle

**`pnpm test:integration`** (integration tests only):
- ✅ **Comprehensive validation**: Full stack testing
- ✅ **CI/CD gates**: Run on PR merge, not every commit
- ✅ **Resource isolation**: Requires Docker, slower execution
- ✅ **Clear separation**: Different purposes, different execution models

### jest-integration `moduleNameMapper` guard (#917)

Each host app's `test/jest-integration.cjs` hand-maintains a `moduleNameMapper`
that **source-maps** every `@openlinker/*` workspace package its Nest module
graph imports — so a *fresh, un-built* worktree resolves them via `src/` instead
of a missing `dist/`. This list silently drifts: adding a plugin to
`apps/<app>/src/plugins.ts` without the matching mapper entry breaks **every**
integration test in a fresh worktree with `Cannot find module
'@openlinker/integrations-…' from 'src/plugins.ts'` (CI masks it because the
integration job builds `dist` first). This bit #916 (api missing `inpost`) and
#786 (worker missing `integrations-ai`).

`scripts/check-jest-integration-mappers.mjs` (run from `pnpm lint` via
`pnpm check:invariants`) guards it: for `apps/api` and `apps/worker`, every
`@openlinker/integrations-*` package imported in `plugins.ts` — plus the base set
`@openlinker/core` / `@openlinker/shared` / `@openlinker/plugin-sdk` — must have
**both** a `^<pkg>$` and a `^<pkg>/(.*)$` entry in that app's
`jest-integration.cjs`, and the bare entry's target file must exist (catches a
typo'd `src` path). A failure names the app, the package, and the fix (the exact
two lines to paste for a missing entry).

**When you add a plugin to `plugins.ts`**, add its two mapper lines to the same
app's `test/jest-integration.cjs` (the guard prints them for you). Source of
truth is `plugins.ts`, not the app's `package.json` — in this pnpm monorepo apps
under-declare their `@openlinker/*` deps.

---

## Best Practices

### Unit Tests

1. **Test Behavior, Not Implementation**
   ```typescript
   // ❌ Bad: Tests implementation details
   it('should call repository.save', () => {
     service.create(dto);
     expect(mockRepository.save).toHaveBeenCalled();
   });

   // ✅ Good: Tests business behavior
   it('should create connection with valid data', async () => {
     const result = await service.create(validDto);
     expect(result.id).toBeDefined();
     expect(result.name).toBe(validDto.name);
   });
   ```

2. **Use Descriptive Test Names**
   ```typescript
   // ❌ Bad
   it('works', () => { ... });

   // ✅ Good
   it('should throw ConnectionNotFoundException when connection does not exist', () => { ... });
   ```

3. **Arrange-Act-Assert Pattern**
   ```typescript
   it('should create connection', async () => {
     // Arrange
     const dto = createPrestashopConnectionDto();
     const mockRepository = createMockConnectionRepository();

     // Act
     const result = await service.create(dto);

     // Assert
     expect(result).toBeDefined();
     expect(result.name).toBe(dto.name);
   });
   ```

4. **Test Edge Cases**
   - Null/undefined inputs
   - Empty strings/arrays
   - Invalid formats
   - Boundary values

5. **Mock External Dependencies**
   - HTTP clients
   - Database repositories
   - External services
   - File system operations

---

### Integration Tests

1. **Use the Test Harness**
   ```typescript
   import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

   describe('Connection CRUD', () => {
     let harness: IntegrationTestHarness;

     beforeAll(async () => {
       harness = await getTestHarness(); // Shared harness
     });

     afterEach(async () => {
       await resetTestHarness(); // Clean database between tests
     });

     afterAll(async () => {
       await teardownTestHarness(); // Cleanup containers
     });
   });
   ```

2. **Test Vertical Slices**
   - Focus on complete user workflows
   - Test HTTP → Database flow
   - Verify persistence and retrieval

3. **Use Helper Functions**
   ```typescript
   // ✅ Good: Reusable helpers
   const connection = await createTestConnection(harness, {
     name: 'Test Store',
   });

   // ❌ Bad: Duplicated setup code
   const response = await harness.getHttp()
     .post('/connections')
     .send({ name: 'Test Store', ... });
   ```

4. **Verify Both HTTP and Database**
   ```typescript
   it('should create connection', async () => {
     // HTTP response
     const response = await harness.getHttp()
       .post('/connections')
       .send(dto)
       .expect(201);

     // Database persistence
     const dbEntity = await getConnectionById(
       harness.getDataSource(),
       response.body.id
     );
     expect(dbEntity).toBeDefined();
   });
   ```

5. **Keep Tests Independent**
   - Each test should work in isolation
   - Use `resetTestHarness()` between tests
   - Don't rely on test execution order

---

### General Guidelines

1. **Fast Unit Tests, Slower Integration Tests**
   - Unit tests: < 100ms per test
   - Integration tests: < 5s per test

2. **High Unit Test Coverage, Targeted Integration Tests**
   - Unit tests: Aim for 80%+ coverage
   - Integration tests: Focus on critical paths

3. **Clear Test Names**
   - Use `should [expected behavior] when [condition]` format
   - Example: `should throw error when connection ID is invalid`

4. **Avoid Test Interdependencies**
   - Tests should not depend on each other
   - Each test should be runnable in isolation

5. **Use Fixtures for Test Data**
   ```typescript
   // ✅ Good: Reusable fixtures
   const connection = createPrestashopConnectionDto({
     name: 'Custom Store',
   });

   // ❌ Bad: Hardcoded test data
   const connection = {
     name: 'Test Store',
     platformType: 'prestashop',
     // ... 20 more lines
   };
   ```

---

## Troubleshooting

### Unit Tests

#### Tests Fail After Code Changes

**Problem**: Tests fail after refactoring.

**Solution**:
1. Update mocks to match new interfaces
2. Update test expectations to match new behavior
3. Verify test data matches new validation rules

#### Slow Unit Tests

**Problem**: Unit tests take too long (> 5s total).

**Solution**:
1. Check for real network calls (should be mocked)
2. Verify no real database connections
3. Use `jest.useFakeTimers()` for time-dependent tests
4. Check for unnecessary async operations

#### Red suite with `SIGKILL` / "worker terminated" (OOM, not a test failure) (#976)

**Problem**: A package's `test` run (especially under the full-suite `pnpm -r test` / `pnpm test:ci`) goes red with **zero failed assertions** — a Jest worker is killed by the OS:

```
● Test suite failed to run
  A jest worker process (pid=…) was terminated by another process:
  signal=SIGKILL, exitCode=null
Test Suites: 1 failed, 23 passed, 24 total
Tests:       339 passed, 339 total          ← zero test failures
```

`signal=SIGKILL` / `exitCode=null` is an **OS OOM-kill**, not an assertion failure. `pnpm -r test` runs every package's Jest concurrently and each defaults to ~`cores − 1` workers, so on a memory-constrained (self-hosted) runner the combined fan-out can exhaust RAM. **Do not reflexively re-run** — a green re-run hides the real cause, which is exactly how a genuine regression eventually slips through unnoticed.

**Solution** (already applied to the heavy `prestashop` + `allegro` packages):
1. **Per-package worker + memory caps** — `maxWorkers: 2` and `workerIdleMemoryLimit: '512MB'`, spread into the package's `jest.config.mjs` from the shared `jest.ci-stability.mjs` at the repo root (one source for every heavy package). The memory limit recycles a worker before the OS kills it; the absolute worker cap (not `'50%'`, which scales with unknown runner cores) bounds peak memory deterministically. Tune the ceiling down (e.g. `256MB`) if the runner is tight.
2. **Cross-package fan-out bound** — `test:ci` runs `pnpm -r --workspace-concurrency=2 test`. pnpm's default `workspace-concurrency` is **4**, so the bound must be set *below* 4 to actually throttle how many packages' Jests run at once.
3. **Split oversized spec files** — a single multi-thousand-line spec pins all its state in one worker. Splitting per method/area (sharing setup via a `__tests__/mocks/*.factory.ts`) lowers peak per-worker memory and improves parallelism. Keep the total test count unchanged when splitting.

To confirm it's OOM (not a leak), run with `--logHeapUsage` and watch for monotonic per-worker growth; the runner's `dmesg` / container OOM log is the definitive signal.

---

### Integration Tests

#### Docker Not Running

**Error**: `Error: connect ECONNREFUSED 127.0.0.1:xxxx`

**Solution**:
```bash
# Check Docker status
docker ps

# Start Docker Desktop (macOS/Windows)
# Or start Docker daemon (Linux)
sudo systemctl start docker
```

#### Container Startup Timeout

**Error**: `Timeout waiting for container to start`

**Solution**:
1. Check Docker has sufficient resources (RAM, disk)
2. Verify Docker images are downloaded:
   ```bash
   docker images | grep postgres
   docker images | grep redis
   ```
3. Increase test timeout in `jest-integration.js`:
   ```javascript
   testTimeout: 120000, // 2 minutes
   ```

#### Port Conflicts

**Error**: `Port xxxx is already in use`

**Solution**:
1. Testcontainers uses random ports, but if conflicts occur:
   ```bash
   # Find process using port
   lsof -i :5432
   
   # Stop conflicting service
   docker compose down
   ```

#### Database Migration Errors

**Error**: `QueryFailedError: relation "xxx" already exists`

**Solution**:
- This is handled automatically by the test harness
- If it persists, check `setup.ts` migration logic

#### Tests Hang or Timeout

**Problem**: Tests don't complete.

**Solution**:
1. Check Docker containers are running:
   ```bash
   docker ps
   ```
2. Verify `maxWorkers: 1` in `jest-integration.js` (prevents parallel execution conflicts)
3. Check for infinite loops or unresolved promises in test code
4. Increase timeout:
   ```javascript
   testTimeout: 60000, // 60 seconds
   ```

#### "Cannot find module" Errors

**Error**: `Cannot find module '@openlinker/core/...'`

**Solution**:
1. Ensure packages are built:
   ```bash
   pnpm build
   ```
2. Verify `moduleNameMapper` in `jest-integration.js` is correct
3. Check workspace package resolution

---

## Related Documentation

- **[Development Environment Setup](./dev-environment.md)** - Local development stack (PostgreSQL, Redis, PrestaShop) - **Note**: Integration tests use Testcontainers (ephemeral containers), separate from the dev stack
- **[Engineering Standards](./engineering-standards.md)** - Coding and testing standards
- **[Architecture Overview](./architecture-overview.md)** - System architecture

---

## Quick Reference

### Commands

```bash
# Unit tests (fast, no Docker required)
pnpm test

# Integration tests (slower, requires Docker)
pnpm test:integration

# Both test suites
pnpm test && pnpm test:integration
```

### Test Locations

- **Unit Tests**: `src/**/*.spec.ts`
- **Integration Tests**: `test/integration/**/*.int-spec.ts`

### Testcontainers

- **PostgreSQL**: `postgres:16-alpine` (ephemeral container)
- **Redis**: `redis:7-alpine` (ephemeral container)
- **Lifecycle**: Auto-started before tests, auto-stopped after tests

---

## Next Steps

1. **Write Unit Tests**: Start with domain logic, services, controllers
2. **Write Integration Tests**: Focus on critical vertical slices (Connection CRUD, etc.)
3. **Run Tests Regularly**: `pnpm test` during development, `pnpm test:integration` before commits
4. **Review Coverage**: Aim for 80%+ unit test coverage
5. **CI/CD Integration**: Add `test:integration` to CI pipeline

---

**Last Updated**: 2025-12-28  
**Maintained By**: OpenLinker Team

