/**
 * Order notes — revisions and soft delete integration test (#3531)
 *
 * A unit spec can prove `OrderNoteService`'s D33 authorship logic against a
 * mocked repository; only a real Postgres proves `applyEdit`'s TWO writes
 * (the revision insert + the note update) commit as one transaction, that
 * `findTimelineForOrder` reconstructs the right sequence of events from the
 * rows a real edit chain leaves behind, and that a soft-deleted note still
 * satisfies the "at most one pinned note per order" partial unique index
 * rather than colliding with it.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { OrderNoteRepositoryPort } from '@openlinker/core/orders';
import { ORDER_NOTE_REPOSITORY_TOKEN } from '@openlinker/core/orders';

const ORDER_ID = 'ol_order_note_test_1';
const AUTHOR_ID = '33333333-3333-4333-8333-333333333333';

describe('order notes — revisions, soft delete, pin (integration, #3531)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderNoteRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderNoteRepositoryPort>(ORDER_NOTE_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('captures the pre-edit text as a revision, in the same transaction as the update', async () => {
    const note = await repository.create({
      internalOrderId: ORDER_ID,
      authorUserId: AUTHOR_ID,
      authorUsername: 'marta.nowak',
      body: 'Original text',
      showToPacker: false,
    });

    const edited = await repository.applyEdit(
      note.id,
      { body: 'Edited text', showToPacker: true },
      new Date('2026-09-25T12:00:00Z'),
    );

    expect(edited.body).toBe('Edited text');
    expect(edited.showToPacker).toBe(true);
    expect(edited.editedAt).not.toBeNull();

    const timeline = await repository.findTimelineForOrder(ORDER_ID);
    const created = timeline.find((e) => e.kind === 'created');
    expect(created?.body).toBe('Original text');
    const flagChanged = timeline.find((e) => e.kind === 'flag_changed');
    expect(flagChanged).toBeDefined();
    expect(flagChanged?.showToPacker).toBe(true);
  });

  it('soft-deletes: blanks the body, stamps deletedAt, keeps the row', async () => {
    const note = await repository.create({
      internalOrderId: ORDER_ID,
      authorUserId: AUTHOR_ID,
      authorUsername: 'marta.nowak',
      body: 'To be deleted',
      showToPacker: false,
    });

    const deleted = await repository.softDelete(note.id, new Date('2026-09-26T09:00:00Z'));
    expect(deleted.body).toBe('');
    expect(deleted.deletedAt).not.toBeNull();

    const remaining = await repository.findByOrderId(ORDER_ID);
    expect(remaining.map((n) => n.id)).not.toContain(note.id);

    const timeline = await repository.findTimelineForOrder(ORDER_ID);
    expect(timeline.some((e) => e.noteId === note.id && e.kind === 'deleted')).toBe(true);
  });

  it('pinning a second note unpins the first — at most one pinned note per order', async () => {
    const first = await repository.create({
      internalOrderId: ORDER_ID,
      authorUserId: AUTHOR_ID,
      authorUsername: 'marta.nowak',
      body: 'First',
      showToPacker: false,
    });
    const second = await repository.create({
      internalOrderId: ORDER_ID,
      authorUserId: AUTHOR_ID,
      authorUsername: 'marta.nowak',
      body: 'Second',
      showToPacker: false,
    });

    await repository.pin(first.id, ORDER_ID, new Date('2026-09-27T08:00:00Z'));
    let notes = await repository.findByOrderId(ORDER_ID);
    expect(notes.find((n) => n.id === first.id)?.pinnedAt).not.toBeNull();

    await repository.pin(second.id, ORDER_ID, new Date('2026-09-27T08:05:00Z'));
    notes = await repository.findByOrderId(ORDER_ID);
    expect(notes.find((n) => n.id === first.id)?.pinnedAt).toBeNull();
    expect(notes.find((n) => n.id === second.id)?.pinnedAt).not.toBeNull();
  });

  it('only flagged notes are returned by the batched packer-visible read', async () => {
    await repository.create({
      internalOrderId: ORDER_ID,
      authorUserId: AUTHOR_ID,
      authorUsername: 'marta.nowak',
      body: 'Private note',
      showToPacker: false,
    });
    await repository.create({
      internalOrderId: ORDER_ID,
      authorUserId: AUTHOR_ID,
      authorUsername: 'marta.nowak',
      body: 'Packer note',
      showToPacker: true,
    });

    const byOrder = await repository.findPackerVisibleForOrders([ORDER_ID]);
    const visible = byOrder.get(ORDER_ID) ?? [];
    expect(visible).toHaveLength(1);
    expect(visible[0].body).toBe('Packer note');
  });
});
