/**
 * Stream Dead Letter Repository Integration Test (#2301, D48)
 *
 * Proves the two properties that only exist against a real database:
 *
 *   - the `upsert` raw SQL really is an insert-on-first-write /
 *     update-on-later-write, and `first_seen_at` is the one column that
 *     genuinely never moves on the later write — a mocked query builder
 *     cannot distinguish "the SET clause omits the column" from "the SET
 *     clause writes the same value back", but a real re-write with a
 *     later `now` can;
 *   - the unique index on `(stream, consumer_group, entry_id)` is what
 *     makes a repeated write of the SAME poisoned entry idempotent rather
 *     than a growing pile of rows — the retry path this table exists to
 *     support (a failed XACK after a successful insert) depends on it.
 *
 * @module apps/api/test/integration/events
 */
import { StreamDeadLetterOrmEntity } from '@openlinker/core/events/orm-entities';
// Deep import of the infrastructure repository (host-only test seam): the
// repository class is intentionally NOT on the bounded-context public
// barrel, so it is reached via the `@openlinker/core/*` wildcard, the same
// way the orm-entities sub-barrel is consumed (the fiscalization precedent).
import { StreamDeadLetterRepository } from '@openlinker/core/events/infrastructure/persistence/repositories/stream-dead-letter.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const STREAM = 'jobs.sync';
const GROUP = 'job-intake';

describe('stream_dead_letters persistence (integration)', () => {
  let harness: IntegrationTestHarness;
  let repo: Repository<StreamDeadLetterOrmEntity>;
  let repository: StreamDeadLetterRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    repo = harness.getDataSource().getRepository(StreamDeadLetterOrmEntity);
    repository = new StreamDeadLetterRepository(repo);
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('upsert', () => {
    it('inserts a new row on first write', async () => {
      const result = await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '1-0',
        rawFields: { jobType: 'a', connectionId: 'conn-1' },
        attempts: 10,
        lastError: 'handler blew up',
      });

      expect(result.stream).toBe(STREAM);
      expect(result.consumerGroup).toBe(GROUP);
      expect(result.entryId).toBe('1-0');
      expect(result.rawFields).toEqual({ jobType: 'a', connectionId: 'conn-1' });
      expect(result.attempts).toBe(10);
      expect(result.lastError).toBe('handler blew up');

      const rows = await repo.find();
      expect(rows).toHaveLength(1);
    });

    it('updates the existing row on a later write for the same (stream, group, entry) — never a second row', async () => {
      await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '1-0',
        rawFields: { jobType: 'a' },
        attempts: 10,
        lastError: 'first failure',
      });

      const second = await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '1-0',
        rawFields: { jobType: 'a', extra: 'field' },
        attempts: 11,
        lastError: 'second failure',
      });

      const rows = await repo.find();
      expect(rows).toHaveLength(1);
      expect(second.attempts).toBe(11);
      expect(second.lastError).toBe('second failure');
      expect(second.rawFields).toEqual({ jobType: 'a', extra: 'field' });
    });

    it('never moves first_seen_at on a later write, even though last_seen_at does', async () => {
      // This is the property the whole raw-SQL upsert exists for: a retried
      // dead-letter write (failed XACK after a successful insert) must not
      // reset when the entry was first seen.
      const first = await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '1-0',
        rawFields: {},
        attempts: 10,
        lastError: 'first failure',
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const second = await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '1-0',
        rawFields: {},
        attempts: 11,
        lastError: 'second failure',
      });

      expect(second.firstSeenAt.getTime()).toBe(first.firstSeenAt.getTime());
      expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
    });

    it('stores rawFields as an exact, untyped jsonb copy — not a projection', async () => {
      const rawFields = {
        jobType: 'master.product.syncByExternalId',
        connectionId: 'conn-1',
        payloadJson: JSON.stringify({ externalId: '9', objectType: 'Product' }),
        idempotencyKey: 'test-key-123',
      };

      const result = await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '5-0',
        rawFields,
        attempts: 10,
        lastError: 'boom',
      });

      expect(result.rawFields).toEqual(rawFields);
    });

    it('allows the same entryId across two different streams — the unique key is composite', async () => {
      await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '1-0',
        rawFields: {},
        attempts: 10,
        lastError: 'boom',
      });

      await repository.upsert({
        stream: 'events.master.deletion',
        consumerGroup: 'master-deletion-offer-pause',
        entryId: '1-0',
        rawFields: {},
        attempts: 10,
        lastError: 'boom',
      });

      const rows = await repo.find();
      expect(rows).toHaveLength(2);
    });
  });

  describe('findMany / count', () => {
    beforeEach(async () => {
      await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '1-0',
        rawFields: {},
        attempts: 10,
        lastError: 'boom-1',
      });
      await repository.upsert({
        stream: STREAM,
        consumerGroup: GROUP,
        entryId: '2-0',
        rawFields: {},
        attempts: 10,
        lastError: 'boom-2',
      });
      await repository.upsert({
        stream: 'events.master.deletion',
        consumerGroup: 'master-deletion-offer-pause',
        entryId: '3-0',
        rawFields: {},
        attempts: 10,
        lastError: 'boom-3',
      });
    });

    it('paginates across every stream when no filter is given', async () => {
      const page = await repository.findMany({}, { limit: 2, offset: 0 });

      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(2);
    });

    it('filters by stream', async () => {
      const page = await repository.findMany({ stream: STREAM }, { limit: 10, offset: 0 });

      expect(page.total).toBe(2);
      expect(page.items.every((item) => item.stream === STREAM)).toBe(true);
    });

    it('counts independently of pagination', async () => {
      await expect(repository.count({})).resolves.toBe(3);
      await expect(repository.count({ stream: STREAM })).resolves.toBe(2);
    });

    it('orders newest-last-seen first', async () => {
      const page = await repository.findMany({}, { limit: 10, offset: 0 });

      const timestamps = page.items.map((item) => item.lastSeenAt.getTime());
      const sorted = [...timestamps].sort((a, b) => b - a);
      expect(timestamps).toEqual(sorted);
    });
  });
});
