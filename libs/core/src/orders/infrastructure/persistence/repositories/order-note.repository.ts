/**
 * Order Note Repository (#3531)
 *
 * TypeORM implementation of `OrderNoteRepositoryPort`.
 *
 * `applyEdit` writes the pre-edit revision and the note update in ONE
 * transaction: a revision with no corresponding edit, or an edit that lost
 * its prior text, would both be a partial write the AC ("each edit is an
 * Activity timeline entry keeping the previous text") forbids.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { OrderNoteOrmEntity } from '../entities/order-note.orm-entity';
import { OrderNoteRevisionOrmEntity } from '../entities/order-note-revision.orm-entity';
import type { OrderNoteRepositoryPort } from '../../../domain/ports/order-note-repository.port';
import type {
  CreateOrderNoteInput,
  OrderNote,
  OrderNoteTimelineEntry,
  UpdateOrderNoteInput,
} from '../../../domain/types/order-note.types';

@Injectable()
export class OrderNoteRepository implements OrderNoteRepositoryPort {
  constructor(
    @InjectRepository(OrderNoteOrmEntity)
    private readonly notes: Repository<OrderNoteOrmEntity>,
    @InjectRepository(OrderNoteRevisionOrmEntity)
    private readonly revisions: Repository<OrderNoteRevisionOrmEntity>,
    private readonly dataSource: DataSource
  ) {}

  async findByOrderId(internalOrderId: string): Promise<OrderNote[]> {
    const entities = await this.notes.find({
      where: { internalOrderId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findById(id: string): Promise<OrderNote | null> {
    const entity = await this.notes.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async create(input: CreateOrderNoteInput): Promise<OrderNote> {
    const entity = new OrderNoteOrmEntity();
    entity.internalOrderId = input.internalOrderId;
    entity.authorUserId = input.authorUserId;
    entity.authorUsername = input.authorUsername;
    entity.body = input.body;
    entity.showToPacker = input.showToPacker;
    entity.editedAt = null;
    entity.deletedAt = null;
    entity.pinnedAt = null;
    const saved = await this.notes.save(entity);
    return this.toDomain(saved);
  }

  async applyEdit(id: string, patch: UpdateOrderNoteInput, editedAt: Date): Promise<OrderNote> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(OrderNoteOrmEntity, { where: { id } });
      if (!existing) {
        throw new Error(`OrderNote ${id} not found`);
      }

      // The revision captures the state BEFORE this edit — the text this edit
      // is about to overwrite — so it stays readable after the overwrite.
      const revision = new OrderNoteRevisionOrmEntity();
      revision.noteId = id;
      revision.body = existing.body;
      revision.showToPacker = existing.showToPacker;
      revision.supersededAt = editedAt;
      await manager.save(revision);

      if (patch.body !== undefined) existing.body = patch.body;
      if (patch.showToPacker !== undefined) existing.showToPacker = patch.showToPacker;
      existing.editedAt = editedAt;
      const saved = await manager.save(existing);
      return this.toDomain(saved);
    });
  }

  async softDelete(id: string, deletedAt: Date): Promise<OrderNote> {
    await this.notes.update({ id }, { deletedAt, body: '' });
    const updated = await this.notes.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`OrderNote ${id} vanished during delete`);
    }
    return this.toDomain(updated);
  }

  async pin(id: string, internalOrderId: string, pinnedAt: Date): Promise<OrderNote> {
    return this.dataSource.transaction(async (manager) => {
      // Unpin whichever note currently holds this order's pin (if any) BEFORE
      // setting the new one — both in one transaction, or the partial unique
      // index refuses the second write while the first is still holding it.
      await manager.update(
        OrderNoteOrmEntity,
        { internalOrderId, pinnedAt: Not(IsNull()) },
        { pinnedAt: null }
      );
      await manager.update(OrderNoteOrmEntity, { id }, { pinnedAt });
      const updated = await manager.findOne(OrderNoteOrmEntity, { where: { id } });
      if (!updated) {
        throw new Error(`OrderNote ${id} vanished during pin`);
      }
      return this.toDomain(updated);
    });
  }

  async unpin(id: string): Promise<OrderNote> {
    await this.notes.update({ id }, { pinnedAt: null });
    const updated = await this.notes.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`OrderNote ${id} vanished during unpin`);
    }
    return this.toDomain(updated);
  }

  async findPackerVisibleForOrders(
    internalOrderIds: readonly string[]
  ): Promise<Map<string, OrderNote[]>> {
    if (internalOrderIds.length === 0) {
      return new Map();
    }
    const entities = await this.notes.find({
      where: {
        internalOrderId: In([...internalOrderIds]),
        showToPacker: true,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
    const byOrder = new Map<string, OrderNote[]>();
    for (const entity of entities) {
      const note = this.toDomain(entity);
      const list = byOrder.get(note.internalOrderId);
      if (list) {
        list.push(note);
      } else {
        byOrder.set(note.internalOrderId, [note]);
      }
    }
    return byOrder;
  }

  async findTimelineForOrder(internalOrderId: string): Promise<OrderNoteTimelineEntry[]> {
    const notes = await this.notes.find({ where: { internalOrderId }, order: { createdAt: 'ASC' } });
    if (notes.length === 0) {
      return [];
    }
    const revisionRows = await this.revisions.find({
      where: { noteId: In(notes.map((note) => note.id)) },
      order: { supersededAt: 'ASC' },
    });
    const revisionsByNote = new Map<string, OrderNoteRevisionOrmEntity[]>();
    for (const revision of revisionRows) {
      const list = revisionsByNote.get(revision.noteId);
      if (list) {
        list.push(revision);
      } else {
        revisionsByNote.set(revision.noteId, [revision]);
      }
    }

    const entries: OrderNoteTimelineEntry[] = [];
    for (const note of notes) {
      const noteRevisions = revisionsByNote.get(note.id) ?? [];

      // Creation: the text as it stood before the FIRST edit, or the current
      // text when the note was never edited.
      entries.push({
        noteId: note.id,
        kind: 'created',
        occurredAt: note.createdAt,
        actorUsername: note.authorUsername,
        body: noteRevisions.length > 0 ? noteRevisions[0].body : note.body,
        showToPacker: noteRevisions.length > 0 ? noteRevisions[0].showToPacker : note.showToPacker,
      });

      // Each revision `i` records the text superseded AT `revisions[i].supersededAt`;
      // the text it was superseded BY is `revisions[i+1].body`, or the note's
      // current text when `i` was the last edit.
      for (let i = 0; i < noteRevisions.length; i += 1) {
        const next = noteRevisions[i + 1];
        const resultingBody = next ? next.body : note.body;
        const resultingFlag = next ? next.showToPacker : note.showToPacker;
        const priorFlag = noteRevisions[i].showToPacker;
        entries.push({
          noteId: note.id,
          kind: resultingFlag !== priorFlag ? 'flag_changed' : 'edited',
          occurredAt: noteRevisions[i].supersededAt,
          actorUsername: note.authorUsername,
          body: resultingFlag !== priorFlag ? null : resultingBody,
          showToPacker: resultingFlag !== priorFlag ? resultingFlag : null,
        });
      }

      if (note.deletedAt) {
        entries.push({
          noteId: note.id,
          kind: 'deleted',
          occurredAt: note.deletedAt,
          actorUsername: note.authorUsername,
          body: null,
          showToPacker: null,
        });
      }
    }

    entries.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return entries;
  }

  private toDomain(entity: OrderNoteOrmEntity): OrderNote {
    return {
      id: entity.id,
      internalOrderId: entity.internalOrderId,
      authorUserId: entity.authorUserId,
      authorUsername: entity.authorUsername,
      body: entity.body,
      showToPacker: entity.showToPacker,
      editedAt: entity.editedAt,
      deletedAt: entity.deletedAt,
      pinnedAt: entity.pinnedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
