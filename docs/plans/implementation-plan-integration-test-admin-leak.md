# Implementation plan — Integration test admin-user leak (#278)

**Issue:** https://github.com/openlinker-project/openlinker/issues/278
**Layer:** Backend test infrastructure only (no production code, no migration)

## Goal

`pnpm test:integration` fails with 7 suites erroring on the first `loginAsAdmin` call. Fix so every run returns zero failures, and running it twice back-to-back on the same Docker state still returns zero failures.

## Root cause (corrected after audit)

The issue body hypothesised between-suite data leakage: admin rows from one suite surviving into the next. The repro walk proves a different cause.

**Root cause: `BootstrapAdminService.onApplicationBootstrap()` seeds an `admin` user on every Nest app boot.**

`apps/api/src/auth/bootstrap-admin.service.ts`:

```ts
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  async onApplicationBootstrap(): Promise<void> { await this.bootstrap(); }

  async bootstrap(): Promise<void> {
    const enabled = this.configService.get<string>('OL_BOOTSTRAP_ADMIN_ENABLED', 'true');
    if (enabled.trim().toLowerCase() !== 'true') return;

    const username = this.configService.get<string>('OL_BOOTSTRAP_ADMIN_USERNAME', 'admin');
    // ... inserts a user row with username='admin' if not present
  }
}
```

Sequence for a failing suite:
1. `beforeAll` → `getTestHarness()` → `app.init()` → `onApplicationBootstrap` → **insert `admin`**.
2. First `it` → `loginAsAdmin(http, dataSource)` → `INSERT INTO users (username='admin', ...)` → **`users.username` unique-constraint violation** → test fails here.
3. `afterEach(resetTestHarness)` → truncates users → both the bootstrap row and any partial insert are gone.
4. Second `it` → `loginAsAdmin` → clean insert → passes.

That matches the observed failure shape perfectly: every failing suite has exactly one failure (always the first test), and it's always the same constraint. The candidate "between-suite leak" theory in the issue body was wrong — the admin row isn't leaking across suites, it's being re-seeded on every app boot.

### Audit results

Grep-audit from tech-review:

| Mechanism (from earlier plan) | Result |
|---|---|
| (a) Suite missing `afterEach(resetTestHarness)` | **Ruled out** — all 10 suites have it wired. |
| (b) Double `loginAsAdmin` in a single `it` with the same username | **Ruled out** — zero matches across all failing suites. |
| (c) App boot re-seeds admin | **Confirmed** — `BootstrapAdminService.onApplicationBootstrap` in `apps/api/src/auth/bootstrap-admin.service.ts` is the active seeder. |

Failing set from live repro (matches the issue body except for one filename drift — `sync-jobs-read.int-spec.ts`, not `sync-jobs-crud.int-spec.ts`, and `orders-read.int-spec.ts` is in the failing set too; `webhook-ingestion.int-spec.ts` passes now despite being listed as failing in the issue body):

- `connection-capabilities.int-spec.ts`
- `connection-credentials.int-spec.ts`
- `connection-crud.int-spec.ts`
- `connection-diagnostics.int-spec.ts`
- `inventory-read.int-spec.ts`
- `sync-jobs-read.int-spec.ts`
- `orders-read.int-spec.ts`

Every failing suite calls `loginAsAdmin('admin', ...)` in its first `it`. Every passing suite either doesn't use `loginAsAdmin` (app-boot, webhook-ingestion) or uses a distinct username via `seedUser('testuser', ...)` (auth).

## Non-goals

- A blanket harness-level truncate in `setup()`. I considered this in the first draft and rejected it: disabling the specific production behaviour that causes the conflict (bootstrap seeding) is narrower and more correct than papering over whatever the app boots with.
- Redesigning the harness / container strategy.
- Fixing the dead `globalTeardown` wiring (`jest-integration.cjs` doesn't reference `teardown.ts`). Worth a follow-up but out of scope.
- Making `loginAsAdmin` idempotent via `ON CONFLICT`. Per the issue, that hides leaks.

## Design decision

**Disable `BootstrapAdminService` in the integration harness via `OL_BOOTSTRAP_ADMIN_ENABLED=false`.**

- The service already reads that env var and exits early when it's set to anything other than `"true"`.
- Integration tests seed users explicitly through `loginAsAdmin` / `seedUser`. The bootstrap seed adds nothing — it only collides.
- One line in `harness.ts` where the existing test-only disable flags already live (`OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false`, `OL_PRODUCT_SYNC_ENABLED=false`, etc.). Matches the established pattern.
- No production change. No new abstraction. Surgical fix.

**Rejected alternatives:**

- *Harness-level `await this.reset()` in `setup()`* — fixes the symptom but doesn't explain *why* truncation is needed. Every future reader has to reason "the app must be seeding something somehow." Disabling the seeder is self-documenting.
- *`loginAsAdmin` with `ON CONFLICT (username) DO NOTHING`* — the issue explicitly rejects this because it would mask future leaks, and on reflection the real issue is that the seeder shouldn't run in tests at all.

## Change set

### 1. `apps/api/test/integration/harness.ts::startHarness()`

Add `OL_BOOTSTRAP_ADMIN_ENABLED=false` alongside the existing scheduler-disable env vars. Group it with the other test-only disables and comment why.

Before (lines ~68-71):
```ts
  process.env.OL_ALLEGRO_POLL_SCHEDULER_ENABLED = 'false';
  process.env.OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED = 'false';
  process.env.OL_INVENTORY_SYNC_ENABLED = 'false';
  process.env.OL_PRODUCT_SYNC_ENABLED = 'false';
```

After:
```ts
  process.env.OL_ALLEGRO_POLL_SCHEDULER_ENABLED = 'false';
  process.env.OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED = 'false';
  process.env.OL_INVENTORY_SYNC_ENABLED = 'false';
  process.env.OL_PRODUCT_SYNC_ENABLED = 'false';

  // Integration tests seed users explicitly via loginAsAdmin / seedUser
  // helpers. Letting BootstrapAdminService also insert a default `admin`
  // user on app.init() causes the first `loginAsAdmin('admin')` call in
  // every suite to collide on the users.username unique constraint. See #278.
  process.env.OL_BOOTSTRAP_ADMIN_ENABLED = 'false';
```

### 2. Regression guard — new `bootstrap-admin-disabled.int-spec.ts`

Small, focused test that pins the contract at the integration level: booting the harness and calling `resetTestHarness` immediately gives an empty users table (i.e., the bootstrap didn't seed one). Keeps the documented guarantee testable without touching any of the existing suites' semantics.

```ts
// test/integration/bootstrap-admin-disabled.int-spec.ts
import { getTestHarness, resetTestHarness, teardownTestHarness, IntegrationTestHarness } from './setup';

describe('Bootstrap admin disabled in integration harness (#278)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('leaves the users table empty after app boot', async () => {
    const result = await harness
      .getDataSource()
      .query<{ count: string }[]>('SELECT COUNT(*)::text AS count FROM users');
    expect(result[0].count).toBe('0');
  });
});
```

If someone later re-enables the bootstrap in `harness.ts` or adds a new seeding `OnApplicationBootstrap`, this test flags it immediately.

### 3. No production code changes

No `src/` files touched. No migration. No API change.

## Quality gate

- `pnpm --filter @openlinker/api test:integration` — **must** return `Test Suites: 11 passed, 11 total` / `Tests: 68 passed, 68 total` (one new test added).
- Run it a second time immediately after the first run completes — both runs still pass. This validates the "same Docker state" criterion from the issue.
- `pnpm lint` — clean.
- `pnpm type-check` — clean.
- `pnpm test` — backend unit tests unchanged (still have the pre-existing `libs/core` failures that predate this issue; we do not regress them).

## Risks / open questions

- **Bootstrap service behaviour in non-test contexts** — unchanged. `OL_BOOTSTRAP_ADMIN_ENABLED` defaults to `true`; only the integration harness overrides it. Unit tests for the bootstrap service itself (`bootstrap-admin.service.spec.ts`) continue to cover the enabled-by-default path.
- **"Run twice back-to-back" verification** — will be empirical. Testcontainers' process-exit hooks may or may not fire under Jest's `forceExit: true`; if they don't, containers from run 1 persist and run 2 re-uses them. Either way, our fix handles both cases — a fresh container boots without admin seeded, a re-used container gets truncated by the next `afterEach` between tests. Will confirm by running the suite twice during implementation.
- **If the env var check in `BootstrapAdminService` ever changes** — e.g. the default flips to `"false"` or the string comparison tightens — our disable no longer works. Covered by the new regression test; it fails if `users` has any rows on boot.

## Out of scope / follow-ups

- Wire `globalTeardown: './test/integration/teardown.ts'` in `jest-integration.cjs` so containers stop explicitly and we can drop `forceExit: true`. Worth a separate issue.
- Consider replacing `TRUNCATE ... CASCADE` with a programmatic enumeration of `public` schema tables so new tables are picked up automatically. Defer.
