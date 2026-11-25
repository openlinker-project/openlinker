/**
 * Release center persistence (#4141)
 *
 * Proves on real Postgres what a mock cannot: the partial-index `ON CONFLICT`
 * predicates, the cursor's row comparison, the per-user row limit under
 * concurrency, and eviction. The harness schema is `synchronize`-built, so FK
 * behaviour is covered by `fulfillment-work-migration-parity.int-spec.ts`.
 *
 * @module apps/api/test/integration
 */
import {
  parseReleaseVersion,
  RELEASE_CENTER_CURSOR_REPOSITORY_TOKEN,
  RELEASE_CENTER_ITEM_STATE_REPOSITORY_TOKEN,
  ReleaseStateLimitExceededError,
  type ParsedReleaseVersion,
  type ReleaseCursorRepositoryPort,
  type ReleaseItemStateRepositoryPort,
} from '@openlinker/core/release-center';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333';
const GONE_CONNECTION = '44444444-4444-4444-8444-444444444444';

function version(text: string): ParsedReleaseVersion {
  const parsed = parseReleaseVersion(text);
  if (!parsed) throw new Error(`bad version ${text}`);
  return parsed;
}

describe('Release center persistence', () => {
  let harness: IntegrationTestHarness;
  let cursors: ReleaseCursorRepositoryPort;
  let items: ReleaseItemStateRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    cursors = harness.getApp().get(RELEASE_CENTER_CURSOR_REPOSITORY_TOKEN);
    items = harness.getApp().get(RELEASE_CENTER_ITEM_STATE_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('cursor', () => {
    it('should accept the first write when no state exists', async () => {
      expect(await cursors.findByUserId(USER)).toBeNull();
      const result = await cursors.advanceCursor(USER, version('0.9.0'));
      expect(result.applied).toBe(true);
      expect(result.state.version?.text).toBe('0.9.0');
    });

    it('should reject an equal write and return the current state', async () => {
      await cursors.advanceCursor(USER, version('1.0.0'));
      const result = await cursors.advanceCursor(USER, version('1.0.0'));
      expect(result.applied).toBe(false);
      expect(result.state.version?.text).toBe('1.0.0');
    });

    it('should reject an older write and return the current state', async () => {
      await cursors.advanceCursor(USER, version('1.2.0'));
      const result = await cursors.advanceCursor(USER, version('1.1.9'));
      expect(result.applied).toBe(false);
      expect(result.state.version?.text).toBe('1.2.0');
    });

    it('should rank 0.12.0 after 0.9.0 numerically, not as text', async () => {
      await cursors.advanceCursor(USER, version('0.9.0'));
      const result = await cursors.advanceCursor(USER, version('0.12.0'));
      expect(result.applied).toBe(true);
      expect(result.state.version?.text).toBe('0.12.0');
    });

    it('should rank rc.10 after rc.2 and the final release after its rc', async () => {
      await cursors.advanceCursor(USER, version('1.0.0-rc.2'));
      expect((await cursors.advanceCursor(USER, version('1.0.0-rc.10'))).applied).toBe(true);
      expect((await cursors.advanceCursor(USER, version('1.0.0-rc.9'))).applied).toBe(false);
      expect((await cursors.advanceCursor(USER, version('1.0.0'))).applied).toBe(true);
      expect((await cursors.advanceCursor(USER, version('1.0.0-rc.11'))).applied).toBe(false);
    });

    it('should leave the cursor on the highest version when writes race', async () => {
      await cursors.advanceCursor(USER, version('0.1.0'));
      const versions = ['0.2.0', '0.9.0', '0.5.0', '0.12.0', '0.3.0', '0.11.0', '0.10.0'];
      await Promise.all(versions.map((v) => cursors.advanceCursor(USER, version(v))));
      expect((await cursors.findByUserId(USER))?.version?.text).toBe('0.12.0');
    });

    it('should create the row on skipDialog before any cursor write, leaving the version empty', async () => {
      const state = await cursors.setSkipDialog(USER, true);
      expect(state.skipDialog).toBe(true);
      expect(state.version).toBeNull();
      const advanced = await cursors.advanceCursor(USER, version('1.0.0'));
      expect(advanced.applied).toBe(true);
      expect(advanced.state.skipDialog).toBe(true);
    });
  });

  describe('item states', () => {
    it('should allow the same key in installation and user scope without colliding', async () => {
      await items.upsertInstallationStates(null, [{ itemKey: 'step-a', status: 'done' }], 2000);
      await items.upsertUserStates(USER, [{ itemKey: 'step-a', status: 'archived' }], 500);
      await items.upsertUserStates(OTHER_USER, [{ itemKey: 'step-a', status: 'open' }], 500);

      expect(await items.listInstallation()).toHaveLength(1);
      expect((await items.listForUser(USER))[0].status).toBe('archived');
      expect((await items.listForUser(OTHER_USER))[0].status).toBe('open');
    });

    it('should update in place on a repeated key instead of inserting', async () => {
      await items.upsertUserStates(USER, [{ itemKey: 'k1', status: 'open' }], 500);
      await items.upsertUserStates(USER, [{ itemKey: 'k1', status: 'deleted' }], 500);
      const rows = await items.listForUser(USER);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('deleted');
    });

    it('should converge parallel writes of one key into a single row', async () => {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          items.upsertUserStates(
            USER,
            [{ itemKey: 'same', status: i % 2 === 0 ? 'open' : 'archived' }],
            500
          )
        )
      );
      expect(await items.listForUser(USER)).toHaveLength(1);
    });

    it('should create the user state row on the first write', async () => {
      await items.upsertUserStates(USER, [{ itemKey: 'k1', status: 'open' }], 500);
      expect(await cursors.findByUserId(USER)).not.toBeNull();
      expect((await cursors.findByUserId(USER))?.version).toBeNull();
    });

    it('should stamp the acting user and doneVia on installation rows', async () => {
      const [row] = await items.upsertInstallationStates(
        USER,
        [{ itemKey: 'step-b', status: 'done', doneVia: 'manual' }],
        2000
      );
      expect(row.actedByUserId).toBe(USER);
      expect(row.doneVia).toBe('manual');
      expect(row.userId).toBeNull();
    });

    it('should evict the oldest deleted rows before refusing at the limit', async () => {
      const limit = 5;
      for (let i = 0; i < limit; i += 1) {
        await items.upsertUserStates(
          USER,
          [{ itemKey: `item-${i}`, status: i < 2 ? 'deleted' : 'open' }],
          limit
        );
      }
      await items.upsertUserStates(USER, [{ itemKey: 'item-new', status: 'open' }], limit);

      const keys = (await items.listForUser(USER)).map((r) => r.itemKey);
      expect(keys).toHaveLength(limit);
      expect(keys).not.toContain('item-0');
      expect(keys).toContain('item-1');
      expect(keys).toContain('item-new');
    });

    it('should refuse with the limit error when nothing is evictable', async () => {
      const limit = 3;
      for (let i = 0; i < limit; i += 1) {
        await items.upsertUserStates(USER, [{ itemKey: `open-${i}`, status: 'open' }], limit);
      }
      await expect(
        items.upsertUserStates(USER, [{ itemKey: 'one-too-many', status: 'open' }], limit)
      ).rejects.toBeInstanceOf(ReleaseStateLimitExceededError);
      expect(await items.listForUser(USER)).toHaveLength(limit);
    });

    it('should still allow updating an existing key at the limit', async () => {
      const limit = 2;
      await items.upsertUserStates(USER, [{ itemKey: 'a', status: 'open' }], limit);
      await items.upsertUserStates(USER, [{ itemKey: 'b', status: 'open' }], limit);
      const [row] = await items.upsertUserStates(
        USER,
        [{ itemKey: 'a', status: 'archived' }],
        limit
      );
      expect(row.status).toBe('archived');
    });

    it('should not exceed the limit when concurrent batches race', async () => {
      const limit = 4;
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          items.upsertUserStates(USER, [{ itemKey: `race-${i}`, status: 'open' }], limit)
        )
      );
      expect(await items.listForUser(USER)).toHaveLength(limit);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(limit);
    });

    it('should refuse installation writes past the installation limit', async () => {
      await items.upsertInstallationStates(null, [{ itemKey: 'i-1', status: 'done' }], 1);
      await expect(
        items.upsertInstallationStates(null, [{ itemKey: 'i-2', status: 'done' }], 1)
      ).rejects.toBeInstanceOf(ReleaseStateLimitExceededError);
    });

    it('should purge installation steps whose connection no longer exists', async () => {
      await items.upsertInstallationStates(
        null,
        [
          { itemKey: 'plain-step', status: 'done' },
          { itemKey: `connect:${CONNECTION}`, status: 'done' },
          { itemKey: `connect:${GONE_CONNECTION}`, status: 'done' },
        ],
        2000
      );
      const removed = await items.pruneInstallationConnectionStates([CONNECTION]);
      expect(removed).toBe(1);
      const keys = (await items.listInstallation()).map((r) => r.itemKey).sort();
      expect(keys).toEqual([`connect:${CONNECTION}`, 'plain-step']);
    });
  });
});
