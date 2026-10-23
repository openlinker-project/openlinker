import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { OrderColumnPresetNotFoundError } from '../../domain/exceptions/order-column-preset-not-found.error';
import type { OrderColumnPresetRepositoryPort } from '../../domain/ports/order-column-preset-repository.port';
import type { OrderColumnPreset } from '../../domain/types/order-column-preset.types';
import { ORDER_COLUMN_PRESET_REPOSITORY_TOKEN } from '../../orders.tokens';
import { OrderColumnPresetService } from './order-column-preset.service';

describe('OrderColumnPresetService', () => {
  let service: OrderColumnPresetService;
  let repository: jest.Mocked<OrderColumnPresetRepositoryPort>;

  const now = new Date('2026-01-15T10:00:00Z');
  const ownedPreset: OrderColumnPreset = {
    id: 'preset-1',
    userId: 'user-1',
    name: 'My view',
    columns: ['order', 'status'],
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    const mockRepository: jest.Mocked<OrderColumnPresetRepositoryPort> = {
      findByUserId: jest.fn(),
      findWorkspaceDefault: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsertWorkspaceDefault: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderColumnPresetService,
        { provide: ORDER_COLUMN_PRESET_REPOSITORY_TOKEN, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(OrderColumnPresetService);
    repository = module.get(ORDER_COLUMN_PRESET_REPOSITORY_TOKEN);
  });

  describe('update', () => {
    it('should update when the caller owns the preset', async () => {
      repository.findById.mockResolvedValue(ownedPreset);
      repository.update.mockResolvedValue({ ...ownedPreset, name: 'Renamed' });

      const result = await service.update('user-1', 'preset-1', { name: 'Renamed' });

      expect(repository.update).toHaveBeenCalledWith('preset-1', { name: 'Renamed' });
      expect(result.name).toBe('Renamed');
    });

    it('should throw OrderColumnPresetNotFoundError when the preset belongs to a different user', async () => {
      repository.findById.mockResolvedValue(ownedPreset);

      await expect(
        service.update('someone-else', 'preset-1', { name: 'Hijacked' }),
      ).rejects.toThrow(OrderColumnPresetNotFoundError);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should throw OrderColumnPresetNotFoundError when no such preset exists', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('user-1', 'missing', { name: 'x' })).rejects.toThrow(
        OrderColumnPresetNotFoundError,
      );
    });
  });

  describe('delete', () => {
    it('should delete when the caller owns the preset', async () => {
      repository.findById.mockResolvedValue(ownedPreset);

      await service.delete('user-1', 'preset-1');

      expect(repository.delete).toHaveBeenCalledWith('preset-1');
    });

    it('should refuse to delete a preset owned by a different user', async () => {
      repository.findById.mockResolvedValue(ownedPreset);

      await expect(service.delete('someone-else', 'preset-1')).rejects.toThrow(
        OrderColumnPresetNotFoundError,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('setWorkspaceDefault', () => {
    it('should delegate to the repository upsert', async () => {
      const workspaceDefault: OrderColumnPreset = {
        id: 'workspace-default',
        userId: null,
        name: 'Workspace default',
        columns: ['order', 'status', 'total'],
        createdAt: now,
        updatedAt: now,
      };
      repository.upsertWorkspaceDefault.mockResolvedValue(workspaceDefault);

      const result = await service.setWorkspaceDefault(['order', 'status', 'total']);

      expect(repository.upsertWorkspaceDefault).toHaveBeenCalledWith([
        'order',
        'status',
        'total',
      ]);
      expect(result.userId).toBeNull();
    });
  });
});
