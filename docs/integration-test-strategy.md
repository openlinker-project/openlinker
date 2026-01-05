# OpenLinker Integration Test Strategy

## Executive Summary

**Current Status**: ✅ Comprehensive unit test coverage, ❌ No integration tests

**Strategy**: Adopt a **test pyramid** where integration tests mean:
- ✅ **Real infrastructure** (Postgres/Redis via Testcontainers)
- ✅ **Real Nest module wiring** (DI, validation pipes, config loading)
- ✅ **Real persistence** (TypeORM repositories, migrations)
- ❌ **Mocked external platforms** (Allegro/PrestaShop via adapter ports)

**Approach**: Start **now** with minimal harness + 1-2 smoke/vertical-slice tests to avoid slowing MVP velocity.

**Reference**: [NestJS Integration Testing with Testcontainers](https://www.blockydevs.com/blog/nestjs-integration-testing-with-testcontainers)

---

## Test Pyramid

```
                    ┌─────────────┐
                    │   E2E Tests │  (Future: Real external APIs in nightly suite)
                    │  (Optional) │
                    └─────────────┘
                 ┌───────────────────┐
                 │ Integration Tests  │  Real Postgres/Redis + Nest wiring
                 │ (Testcontainers)   │  Mocked external adapters
                 └───────────────────┘
              ┌─────────────────────────┐
              │   Unit Tests             │  Pure domain logic, mocked dependencies
              │   (Comprehensive)       │
              └─────────────────────────┘
```

### Test Layers

1. **Unit Tests** (Current: ✅ Comprehensive)
   - Pure domain logic
   - Mocked dependencies
   - Fast execution
   - Location: `**/*.spec.ts`

2. **Integration Tests** (Target: Start with minimal harness)
   - Real Postgres + Redis (Testcontainers)
   - Real Nest modules, DI, validation
   - Real TypeORM repositories, migrations
   - Mocked external adapters (PrestaShop/Allegro)
   - Location: `**/*.int-spec.ts`

3. **Contract Tests** (Future: Per-plugin)
   - Mock HTTP responses (fixtures)
   - Validate mapping/transformation
   - Validate rate-limit/backoff logic
   - Location: `libs/integrations/*/test/contract/*.spec.ts`

4. **E2E Tests** (Future: Optional nightly)
   - Real external systems in containers
   - Full end-to-end workflows
   - Keep out of PR pipeline (too flaky/slow)

---

## Integration Test Definition

### What Integration Tests Validate

**Goal**: Validate that OpenLinker's modules work together end-to-end *inside our boundary*:

✅ **Real Infrastructure**:
- Postgres + Redis via Testcontainers
- Dynamic container host/port injection into config
- Automatic migrations (`migrationsRun: true`)

✅ **Real Nest Application**:
- Module imports, DI tokens, providers
- Validation pipes, interceptors, guards
- Config loading from environment
- Full request/response cycle via Supertest

✅ **Real Persistence**:
- TypeORM entity mappings
- Database constraints, indexes
- Migration execution
- Transaction handling

✅ **Real Job Execution** (Future):
- Sync Manager / Job Runner in-process
- Job state persistence
- Idempotency guarantees

❌ **Mocked External Systems**:
- PrestaShop/Allegro/Shopify APIs → Mocked via adapter ports
- Keep external API calls out of PR pipeline (too flaky/slow)

---

## Foundation: Shared Integration Test Harness

### Harness Responsibilities

The harness provides a reusable foundation for all integration tests:

1. **Container Management**:
   - Start Postgres + Redis via Testcontainers
   - Dynamically inject container host/ports into config
   - Wait for containers to be healthy
   - Clean teardown on test completion

2. **Nest Application Bootstrap**:
   - Boot `INestApplication` with real modules
   - Override config to point to container DSNs
   - Run migrations automatically (`migrationsRun: true`)
   - Provide Supertest HTTP client

3. **Database Management**:
   - Run migrations before tests
   - Provide `reset()` helper to clear DB between tests
   - Provide `db()` access for direct assertions/cleanup
   - Clean teardown (`DataSource.destroy()`)

4. **Redis Management**:
   - Provide `cache()` access for assertions/cleanup
   - `reset()` clears cache between tests
   - Clean teardown

5. **Test Utilities**:
   - `getHttp()` → Supertest client
   - `getApp()` → Nest application instance
   - `reset()` → Clear DB + cache between tests
   - `teardown()` → Clean shutdown

### Harness Implementation Pattern

Following the [BlockyDevs article](https://www.blockydevs.com/blog/nestjs-integration-testing-with-testcontainers):

```typescript
// test/integration/setup.ts
export class IntegrationTestHarness {
  private postgresContainer: PostgreSqlContainer;
  private redisContainer: RedisContainer;
  private app: INestApplication;
  private dataSource: DataSource;

  async setup(): Promise<void> {
    // 1. Start containers
    this.postgresContainer = await new PostgreSqlContainer().start();
    this.redisContainer = await new RedisContainer().start();

    // 2. Override config with container DSNs
    process.env.DB_HOST = this.postgresContainer.getHost();
    process.env.DB_PORT = String(this.postgresContainer.getPort());
    process.env.REDIS_HOST = this.redisContainer.getHost();
    process.env.REDIS_PORT = String(this.redisContainer.getPort());

    // 3. Boot Nest app
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    this.app = moduleRef.createNestApplication();
    await this.app.init();

    // 4. Get DataSource for migrations/cleanup
    this.dataSource = moduleRef.get(DataSource);
  }

  async reset(): Promise<void> {
    // Clear DB tables
    await this.dataSource.query('TRUNCATE TABLE ...');
    // Clear Redis
    const cacheManager = this.app.get(CACHE_MANAGER);
    await cacheManager.reset();
  }

  async teardown(): Promise<void> {
    await this.app.close();
    await this.dataSource.destroy();
    await this.postgresContainer.stop();
    await this.redisContainer.stop();
  }

  getHttp(): request.SuperTest<request.Test> {
    return request(this.app.getHttpServer());
  }
}
```

---

## What to Test First (MVP)

Start with **2 tests** that catch the most expensive failures early:

### 1. "App Boots" Smoke Test

**Location**: `apps/api/test/integration/app-boot.int-spec.ts`

**Purpose**: Verify the entire application wiring works correctly.

**Test**:
```typescript
describe('App Boot Integration', () => {
  it('should boot Nest application and connect to database', async () => {
    // Given: Testcontainers started
    // When: App boots
    // Then: Health endpoint returns 200
    // And: Database connection is healthy
    // And: Redis connection is healthy
  });
});
```

**Value**: Catches module import errors, DI token mismatches, config loading issues, database connection problems.

---

### 2. First Vertical Slice Test

**Location**: `apps/api/test/integration/connection-crud.int-spec.ts`

**Purpose**: Verify full HTTP → Controller → Service → Repository → DB flow.

**Test**:
```typescript
describe('Connection CRUD Integration', () => {
  it('should create connection and persist to database', async () => {
    // Given: Clean database
    // When: POST /connections with PrestaShop config
    // Then: Connection persisted in DB
    // And: All fields stored correctly (JSONB config, timestamps)
    // And: Response matches DB data
  });

  it('should retrieve connection from database', async () => {
    // Given: Connection exists in DB
    // When: GET /connections/:id
    // Then: Response matches DB data
  });
});
```

**Value**: Validates full request/response cycle, TypeORM mappings, database schema, JSONB handling.

---

## Test Structure

```
apps/api/
├── test/
│   ├── integration/
│   │   ├── setup.ts                    # IntegrationTestHarness class
│   │   ├── teardown.ts                 # Global teardown hooks
│   │   ├── fixtures/                   # Shared test data
│   │   │   └── connection.fixtures.ts
│   │   ├── helpers/                    # Test utilities
│   │   │   ├── test-database.helper.ts # DB cleanup utilities
│   │   │   └── test-connection.helper.ts # Connection creation helpers
│   │   ├── app-boot.int-spec.ts        # Smoke test
│   │   └── connection-crud.int-spec.ts # First vertical slice
│   └── jest-integration.json           # Dedicated Jest config
```

**Naming Convention**: `*.int-spec.ts` for integration tests (allows running only integration tests when needed).

---

## Configuration

### Jest Integration Config

**Location**: `apps/api/test/jest-integration.json`

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testRegex": ".*\\.int-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "testEnvironment": "node",
  "setupFilesAfterEnv": ["<rootDir>/integration/setup.ts"],
  "globalTeardown": "<rootDir>/integration/teardown.ts",
  "testTimeout": 60000,
  "maxWorkers": 1
}
```

**Key Settings**:
- `testTimeout: 60000` - Containers take time to start
- `maxWorkers: 1` - Prevent container port conflicts
- `setupFilesAfterEnv` - Initialize harness before tests
- `globalTeardown` - Clean shutdown after all tests

### Environment Configuration

**Location**: `.env.integration` (optional, for local overrides)

```env
# Testcontainers will override these at runtime
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=openlinker_test
REDIS_HOST=localhost
REDIS_PORT=6379
```

**Note**: Testcontainers dynamically inject container host/ports, so these are fallbacks only.

---

## Test Execution

### Running Integration Tests

```bash
# Run all integration tests
pnpm --filter @openlinker/api test:integration

# Run specific integration test
pnpm --filter @openlinker/api test:integration app-boot.int-spec.ts

# Run with coverage (optional)
pnpm --filter @openlinker/api test:integration --coverage
```

### Package.json Script

**Location**: `apps/api/package.json`

```json
{
  "scripts": {
    "test:integration": "jest --config ./test/jest-integration.json"
  }
}
```

---

## Where Tests Should Live

### Integration Tests in `apps/api` (Recommended Baseline)

**Purpose**: Catch issues that *only appear when everything is wired together*:
- Module imports, DI tokens, env/config
- Interceptors, pipes, auth guards
- Full HTTP → DB flow
- Multi-component interactions

**Location**: `apps/api/test/integration/*.int-spec.ts`

**Priority**: **High** - Best ROI early because OpenLinker is composition-heavy.

---

### Integration Tests in `libs/*` (Selective, Not Everywhere)

**Add them when a lib has real infrastructure coupling**:

- ✅ **TypeORM repositories** → Test real DB operations
- ✅ **Redis caching** → Test cache behavior
- ✅ **Outbox/event persistence** → Test event guarantees
- ✅ **Identifier mapping persistence** → Test mapping guarantees

**Avoid duplicating** what `apps/api` already covers. Use libs integration tests when you want **fast, focused** infra verification without booting the whole API.

**Location**: `libs/**/test/integration/*.int-spec.ts`

**Example**: `libs/core/src/identifier-mapping/test/integration/identifier-mapping-persistence.int-spec.ts`

---

### Plugins / Integrations (`libs/integrations/*`)

**Default to contract tests** (no containers):

- Mock HTTP responses (fixtures)
- Validate mapping/transformation rules
- Validate rate-limit/backoff logic deterministically

**Location**: `libs/integrations/*/test/contract/*.spec.ts`

**Optional**: Add a **nightly** "external-system integration" suite later (e.g., run PrestaShop + MySQL containers), but keep that out of the main PR gate.

---

## Implementation Plan

### Phase 1: Test Infrastructure Setup (MVP)

**Goal**: Create shared harness + 1 smoke test + 1 vertical slice test.

**Tasks**:

1. **Install Dependencies**
   ```bash
   pnpm add -D @testcontainers/postgresql @testcontainers/redis
   pnpm add -D @types/supertest supertest
   ```

2. **Create Integration Test Harness**
   - `apps/api/test/integration/setup.ts` - Harness class
   - `apps/api/test/integration/teardown.ts` - Global teardown
   - `apps/api/test/integration/helpers/test-database.helper.ts` - DB utilities
   - `apps/api/test/integration/helpers/test-connection.helper.ts` - Connection helpers

3. **Create Jest Integration Config**
   - `apps/api/test/jest-integration.json`

4. **Create Smoke Test**
   - `apps/api/test/integration/app-boot.int-spec.ts`

5. **Create First Vertical Slice Test**
   - `apps/api/test/integration/connection-crud.int-spec.ts` (2-3 basic CRUD tests)

6. **Add Package.json Script**
   - `test:integration` script

**Estimated Time**: 4-6 hours

**Acceptance Criteria**:
- ✅ `pnpm test:integration` boots API and hits one endpoint
- ✅ Testcontainers start Postgres + Redis automatically
- ✅ Migrations run automatically
- ✅ DB + cache cleanup between tests works
- ✅ Tests pass in CI

---

### Phase 2: Core Integration Tests (Post-MVP)

**Priority 1 (High Value)**:

1. **Connection CRUD Integration Tests** (Complete)
   - Create, Read, Update, Delete
   - Filtering by platformType, status
   - Status transitions (active → disabled)

2. **Adapter Resolution Integration Tests**
   - Resolve adapter for connection from DB
   - Validate capability support
   - List adapters supporting capability
   - Exclude disabled connections

**Priority 2 (Medium Value)**:

3. **Multi-Connection Integration Tests**
   - Multiple connections per platform
   - Multiple adapters per capability
   - Filtering by platformType

4. **Database Schema Tests**
   - Unique constraints
   - JSONB config field
   - Nullable fields
   - Timestamps
   - Indexes

**Estimated Time**: 6-8 hours

---

### Phase 3: Advanced Integration Tests (Future)

**Optional Enhancements**:

- End-to-end workflow tests (create connection → resolve adapter → use adapter)
- Job execution integration tests (Sync Manager vertical slices)
- Performance tests (query performance with indexes)
- Concurrent operation tests

---

## Benefits Summary

### What Integration Tests Add

✅ **Database Validation**: Verify TypeORM mappings, migrations, constraints work correctly  
✅ **End-to-End Flows**: Test complete request/response cycles  
✅ **Real-World Scenarios**: Test with actual database, not mocks  
✅ **Integration Bugs**: Catch issues that only appear when components interact  
✅ **Confidence**: Higher confidence in production readiness  
✅ **Wiring Validation**: Catch DI token mismatches, module import errors early

### What Unit Tests Already Cover

✅ **Component Logic**: Individual components work correctly  
✅ **Error Handling**: All error scenarios tested  
✅ **Edge Cases**: Null/undefined handling, invalid inputs  
✅ **Fast Execution**: Quick feedback during development

---

## Why Start Now (Not Later)

**If you wait**:
- You'll ship more features with hidden wiring assumptions
- Adding containers/migrations/test harness later becomes a refactor tax
- Practical needs (increased Jest timeout, environment overrides) are easier to bake in early

**Rule of thumb for MVP**:
- One harness + 1 smoke test + 1 vertical-slice test per epic is enough
- Keep it tiny to avoid slowing velocity
- Expand incrementally as you discover integration bugs

---

## Next Steps

1. ✅ **Review this strategy** with team
2. ✅ **Approve integration test plan**
3. ✅ **Implement Phase 1** (harness + smoke test + 1 vertical slice)
4. ✅ **Wire into CI** as separate job (fast fail)
5. ✅ **Add one vertical-slice test per epic** (highest ROI)
6. ✅ **After 2-3 slices**, decide if selective libs integration tests needed

---

## References

- [Engineering Standards - Testing](./engineering-standards.md#testing-standards)
- [NestJS Integration Testing with Testcontainers](https://www.blockydevs.com/blog/nestjs-integration-testing-with-testcontainers)
- [Test Analysis & Recommendations](./test-analysis-and-recommendations.md)
- [Docker Compose Setup](./dev-environment.md)




