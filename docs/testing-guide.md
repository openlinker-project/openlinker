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

See [Integration Test Organization](./integration-test-organization.md) for detailed rationale.

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
- **[Integration Test Strategy](./integration-test-strategy.md)** - Detailed integration test approach
- **[Integration Test Organization](./integration-test-organization.md)** - Why tests are separated
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

