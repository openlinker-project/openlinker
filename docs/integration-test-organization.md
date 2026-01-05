# Integration Test Organization: Should `pnpm test` Run Integration Tests?

**Date**: 2025-12-28  
**Decision**: ❌ **NO** - Integration tests should **NOT** run with `pnpm test`

## Current Setup

### Test Commands

- **`pnpm test`** → Runs `jest` (uses `jest.config.js`)
  - Matches: `.*\\.spec\\.ts$` (unit tests only)
  - Location: `src/**/*.spec.ts`
  - Fast execution (~seconds)

- **`pnpm test:integration`** → Runs `jest --config ./test/jest-integration.js`
  - Matches: `test/integration/**/*.int-spec.ts` (integration tests only)
  - Location: `test/integration/**/*.int-spec.ts`
  - Slower execution (~10+ seconds, requires Docker)

### Test Separation

| Test Type | Pattern | Config | Command | Speed | Requirements |
|-----------|---------|--------|---------|-------|--------------|
| **Unit Tests** | `*.spec.ts` | `jest.config.js` | `pnpm test` | Fast (~seconds) | None |
| **Integration Tests** | `*.int-spec.ts` | `jest-integration.js` | `pnpm test:integration` | Slow (~10+ sec) | Docker, Testcontainers |

## Recommendation: Keep Them Separate

### ✅ Why Integration Tests Should NOT Run with `pnpm test`

#### 1. **Speed & Developer Experience**

- **Unit tests**: Execute in milliseconds/seconds, providing instant feedback
- **Integration tests**: Require 10+ seconds (container startup, app boot, migrations)
- **Impact**: Running integration tests on every `pnpm test` would slow down the development feedback loop significantly

**Example**:
```bash
# Current (unit tests only)
$ pnpm test
✓ 50 tests passed in 2.3s

# If integration tests included
$ pnpm test
✓ 50 unit tests passed in 2.3s
✓ 10 integration tests passed in 12.5s
Total: 14.8s  # 6x slower!
```

#### 2. **Resource Requirements**

Integration tests require:
- ✅ **Docker** must be running
- ✅ **Testcontainers** to spin up PostgreSQL and Redis
- ✅ **More memory** (containers + full app boot)
- ✅ **Network access** (for container management)

**Problem**: Developers may not have Docker running during normal development, causing `pnpm test` to fail unnecessarily.

#### 3. **Different Purposes**

- **Unit tests** (`pnpm test`): Quick feedback during development, TDD, catching logic errors
- **Integration tests** (`pnpm test:integration`): Full stack validation, catching integration issues, CI/CD gates

**Best Practice**: Keep fast feedback loops separate from comprehensive validation.

#### 4. **CI/CD Best Practices**

Industry standard pattern:
- **PR checks**: Run unit tests (fast, no external dependencies)
- **Merge/Deploy**: Run integration tests (slower, but comprehensive)

**Example CI/CD pipeline**:
```yaml
# Fast feedback (runs on every commit)
unit-tests:
  script: pnpm test
  timeout: 5 minutes

# Comprehensive validation (runs on PR merge)
integration-tests:
  script: pnpm test:integration
  timeout: 15 minutes
  needs: [unit-tests]  # Only run if unit tests pass
```

#### 5. **Test Isolation**

- **Unit tests**: Isolated, can run in parallel, no shared state
- **Integration tests**: Require serial execution (`maxWorkers: 1`), shared database state

**Problem**: Mixing them would force all tests to run serially, making unit tests slower.

#### 6. **Failure Isolation**

When `pnpm test` fails, developers know it's a unit test issue (fast to debug).  
When `pnpm test:integration` fails, developers know it's an integration issue (may require Docker, database state, etc.).

**Benefit**: Clear separation of concerns and faster debugging.

---

### ❌ Why You Might Want Them Together (Not Recommended)

#### Arguments FOR running together:

1. **"Catch all issues at once"**
   - **Counter**: Slows down development feedback loop, violates "fail fast" principle

2. **"Ensure everything works"**
   - **Counter**: That's what CI/CD is for. Local `pnpm test` should be fast.

3. **"Simpler - one command"**
   - **Counter**: Two commands (`test` vs `test:integration`) is clearer and follows industry standards

---

## Recommended Workflow

### For Developers

```bash
# During development (fast feedback)
pnpm test              # Unit tests only - runs in seconds

# Before committing (comprehensive)
pnpm test:integration  # Integration tests - runs in ~10 seconds

# Full test suite (before PR)
pnpm test && pnpm test:integration
```

### For CI/CD

```yaml
# .github/workflows/test.yml or similar
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
      # Fast, runs on every PR

  integration-tests:
    runs-on: ubuntu-latest
    services:
      docker:
        image: docker:latest
    steps:
      - run: pnpm test:integration
      # Slower, runs on PR merge or nightly
```

---

## Current Implementation Status

✅ **Correctly configured**:
- `jest.config.js` → Only matches `*.spec.ts` (unit tests)
- `jest-integration.js` → Only matches `*.int-spec.ts` (integration tests)
- Separate commands: `test` vs `test:integration`

✅ **No changes needed** - The current setup follows best practices.

---

## Alternative: Optional Combined Command

If you want a "run everything" command for CI/CD, add it as a separate script:

```json
// apps/api/package.json
{
  "scripts": {
    "test": "jest",                    // Unit tests only (fast)
    "test:integration": "jest --config ./test/jest-integration.js",
    "test:all": "pnpm test && pnpm test:integration"  // Both (for CI)
  }
}
```

**But keep `pnpm test` as unit tests only** for fast developer feedback.

---

## Conclusion

**Keep integration tests separate from `pnpm test`** because:

1. ✅ **Speed**: Unit tests provide instant feedback
2. ✅ **Resource efficiency**: No Docker requirement for basic testing
3. ✅ **Clear separation**: Different purposes, different execution models
4. ✅ **Industry standard**: Matches best practices (Jest, NestJS, most projects)
5. ✅ **CI/CD friendly**: Allows staged test execution

The current setup is **correct and should not be changed**.

---

## References

- [Jest: Configuration](https://jestjs.io/docs/configuration)
- [Testcontainers: Best Practices](https://www.testcontainers.org/)
- [Testing Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
- [OpenLinker Integration Test Strategy](./integration-test-strategy.md)




