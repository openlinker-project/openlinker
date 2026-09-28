import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { OrderNoteNotAuthoredError } from '../../domain/exceptions/order-note-not-authored.error';
import { OrderNoteNotFoundError } from '../../domain/exceptions/order-note-not-found.error';
import type { OrderNoteRepositoryPort } from '../../domain/ports/order-note-repository.port';
import type { OrderNote } from '../../domain/types/order-note.types';
import { ORDER_NOTE_REPOSITORY_TOKEN } from '../../orders.tokens';
import { OrderNoteService } from './order-note.service';

describe('OrderNoteService', () => {
  let service: OrderNoteService;
  let repository: jest.Mocked<OrderNoteRepositoryPort>;

  const now = new Date('2026-01-15T10:00:00Z');
  const authoredByAlice: OrderNote = {
    id: 'note-1',
    internalOrderId: 'ol_order_1',
    authorUserId: 'alice',
    authorUsername: 'alice',
    body: 'Fragile — pack with extra care',
    showToPacker: true,
    editedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    const mockRepository: jest.Mocked<OrderNoteRepositoryPort> = {
      findByOrderId: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      applyEdit: jest.fn(),
      softDelete: jest.fn(),
      findPackerVisibleForOrders: jest.fn(),
      findTimelineForOrder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderNoteService,
        { provide: ORDER_NOTE_REPOSITORY_TOKEN, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(OrderNoteService);
    repository = module.get(ORDER_NOTE_REPOSITORY_TOKEN);
  });

  describe('update (D33)', () => {
    it('should allow the author to edit their own note', async () => {
      repository.findById.mockResolvedValue(authoredByAlice);
      repository.applyEdit.mockResolvedValue({ ...authoredByAlice, body: 'Updated', editedAt: now });

      const result = await service.update('note-1', 'alice', false, { body: 'Updated' });

      expect(repository.applyEdit).toHaveBeenCalledWith(
        'note-1',
        { body: 'Updated' },
        expect.any(Date),
      );
      expect(result.body).toBe('Updated');
    });

    it('should refuse a non-author edit even when the caller is an admin', async () => {
      // D33 names only the two DELETE actors (author, admin) — an admin may
      // not edit someone else's note text on their behalf.
      repository.findById.mockResolvedValue(authoredByAlice);

      await expect(
        service.update('note-1', 'bob-the-admin', true, { body: 'Hijacked' }),
      ).rejects.toThrow(OrderNoteNotAuthoredError);
      expect(repository.applyEdit).not.toHaveBeenCalled();
    });

    it('should throw OrderNoteNotFoundError for a missing note', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('missing', 'alice', false, { body: 'x' })).rejects.toThrow(
        OrderNoteNotFoundError,
      );
    });

    it('should treat a soft-deleted note as not found', async () => {
      repository.findById.mockResolvedValue({ ...authoredByAlice, deletedAt: now, body: '' });

      await expect(service.update('note-1', 'alice', false, { body: 'x' })).rejects.toThrow(
        OrderNoteNotFoundError,
      );
    });
  });

  describe('delete (D33)', () => {
    it('should allow the author to delete their own note', async () => {
      repository.findById.mockResolvedValue(authoredByAlice);

      await service.delete('note-1', 'alice', false);

      expect(repository.softDelete).toHaveBeenCalledWith('note-1', expect.any(Date));
    });

    it('should allow an admin to delete a note they did not author', async () => {
      repository.findById.mockResolvedValue(authoredByAlice);

      await service.delete('note-1', 'bob-the-admin', true);

      expect(repository.softDelete).toHaveBeenCalledWith('note-1', expect.any(Date));
    });

    it('should refuse a non-author, non-admin delete', async () => {
      repository.findById.mockResolvedValue(authoredByAlice);

      await expect(service.delete('note-1', 'mallory', false)).rejects.toThrow(
        OrderNoteNotAuthoredError,
      );
      expect(repository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('getPackerVisibleForOrders', () => {
    it('should delegate to the batched repository read', async () => {
      const byOrder = new Map([['ol_order_1', [authoredByAlice]]]);
      repository.findPackerVisibleForOrders.mockResolvedValue(byOrder);

      const result = await service.getPackerVisibleForOrders(['ol_order_1']);

      expect(repository.findPackerVisibleForOrders).toHaveBeenCalledWith(['ol_order_1']);
      expect(result).toBe(byOrder);
    });
  });
});
