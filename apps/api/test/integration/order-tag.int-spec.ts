/**
 * Order tags — workspace limit and assignment upsert integration test (#3532)
 *
 * The workspace limit (D34) is enforced by `OrderTagService.create` reading
 * `repository.count()` — a unit spec proves the service logic, but only a
 * real Postgres proves `count()` reflects rows actually committed by
 * `create()`, and that `UQ_order_tags_name` really refuses a duplicate name.
 * The assignment "upsert" (assigning twice is a no-op, never a duplicate
 * row) is `UQ_order_tag_assignments_tag_order`, likewise only provable
 * against a real unique index.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { OrderTagRepositoryPort } from '@openlinker/core/orders';
import { ORDER_TAG_REPOSITORY_TOKEN, ORDER_TAG_WORKSPACE_LIMIT } from '@openlinker/core/orders';

const ORDER_A = 'ol_order_tag_test_a';
const ORDER_B = 'ol_order_tag_test_b';
const USER_ID = '44444444-4444-4444-8444-444444444444';

describe('order tags — workspace limit, assignment upsert (integration, #3532)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderTagRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderTagRepositoryPort>(ORDER_TAG_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('refuses a duplicate tag name at the unique index', async () => {
    await repository.create({ name: 'VIP', color: 'violet' });
    await expect(repository.create({ name: 'VIP', color: 'blue' })).rejects.toThrow();
  });

  it('count() reflects committed rows, up to the workspace limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await repository.create({ name: `Tag ${i}`, color: 'grey' });
    }
    expect(await repository.count()).toBe(5);
    // The service enforces ORDER_TAG_WORKSPACE_LIMIT against this same count;
    // this spec asserts only that the repository's count is trustworthy —
    // the limit-refusal behaviour itself is the unit spec's job.
    expect(ORDER_TAG_WORKSPACE_LIMIT).toBeGreaterThan(5);
  });

  it('assigning the same tag to the same order twice is idempotent — no duplicate row, no throw', async () => {
    const tag = await repository.create({ name: 'Gift wrap', color: 'pink' });

    await repository.assign(tag.id, ORDER_A, USER_ID);
    await repository.assign(tag.id, ORDER_A, USER_ID);

    const tagIds = await repository.findTagIdsForOrder(ORDER_A);
    expect(tagIds).toEqual([tag.id]);
  });

  it('bulk-assign reports added vs alreadyTagged', async () => {
    const tag = await repository.create({ name: 'B2B', color: 'blue' });
    await repository.assign(tag.id, ORDER_A, USER_ID);

    const result = await repository.bulkAssign(tag.id, [ORDER_A, ORDER_B], USER_ID);

    expect(result.alreadyTagged).toBe(1);
    expect(result.added).toBe(1);
    expect(await repository.findTagIdsForOrder(ORDER_B)).toEqual([tag.id]);
  });

  it('deleting a tag removes every assignment naming it', async () => {
    const tag = await repository.create({ name: 'Temporary', color: 'orange' });
    await repository.assign(tag.id, ORDER_A, USER_ID);

    await repository.delete(tag.id);

    expect(await repository.findById(tag.id)).toBeNull();
    // The port's own delete() is documented to also clean up assignments —
    // asserted here against the real join table rather than trusted.
    const byOrders = await repository.findTagIdsForOrders([ORDER_A]);
    expect(byOrders.get(ORDER_A) ?? []).not.toContain(tag.id);
  });
});
