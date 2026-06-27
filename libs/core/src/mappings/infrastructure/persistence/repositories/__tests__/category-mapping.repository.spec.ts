/**
 * CategoryMappingRepository unit tests
 *
 * Covers the #1036 deterministic lookup (oldest-wins + warn on ambiguity) and
 * the find-then-save upsert (create vs update branch), with a mocked TypeORM
 * Repository. Partial-index enforcement is covered by the int-spec.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories/__tests__
 */

import { IsNull, type Repository } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';
import { CategoryMappingRepository } from '../category-mapping.repository';
import type { CategoryMappingOrmEntity } from '../../entities/category-mapping.orm-entity';

function ormRow(partial: Partial<CategoryMappingOrmEntity>): CategoryMappingOrmEntity {
  return {
    id: 'row-id',
    sourceConnectionId: null,
    destinationConnectionId: 'dest-1',
    sourceCategoryId: 'src-cat-1',
    destinationCategoryId: 'dest-cat-1',
    destinationCategoryName: 'Name',
    destinationCategoryPath: null,
    destinationTaxonomyProvenance: 'allegro',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as CategoryMappingOrmEntity;
}

describe('CategoryMappingRepository', () => {
  let repo: jest.Mocked<Pick<Repository<CategoryMappingOrmEntity>, 'find' | 'findOne' | 'create' | 'save' | 'delete'>>;
  let sut: CategoryMappingRepository;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    sut = new CategoryMappingRepository(repo as unknown as Repository<CategoryMappingOrmEntity>);
  });

  describe('findBySourceCategory', () => {
    it('queries with a deterministic (createdAt, id) order', async () => {
      repo.find.mockResolvedValue([]);

      await sut.findBySourceCategory('dest-1', 'src-cat-1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { destinationConnectionId: 'dest-1', sourceCategoryId: 'src-cat-1' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    });

    it('returns null when no row matches', async () => {
      repo.find.mockResolvedValue([]);
      expect(await sut.findBySourceCategory('dest-1', 'src-cat-1')).toBeNull();
    });

    it('returns the oldest row and warns when more than one matches', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      repo.find.mockResolvedValue([
        ormRow({ id: 'oldest', destinationCategoryId: 'dest-cat-OLD' }),
        ormRow({ id: 'newer', destinationCategoryId: 'dest-cat-NEW' }),
      ]);

      const result = await sut.findBySourceCategory('dest-1', 'src-cat-1');

      expect(result?.id).toBe('oldest');
      expect(result?.destinationCategoryId).toBe('dest-cat-OLD');
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('findBySourceCategoryByProvenance (#1045)', () => {
    it('matches the source store OR source-agnostic rows when a source connection is given', async () => {
      repo.find.mockResolvedValue([]);

      await sut.findBySourceCategoryByProvenance('allegro', 'src-cat-1', 'src-conn-7');

      expect(repo.find).toHaveBeenCalledWith({
        where: [
          {
            destinationTaxonomyProvenance: 'allegro',
            sourceCategoryId: 'src-cat-1',
            sourceConnectionId: 'src-conn-7',
          },
          {
            destinationTaxonomyProvenance: 'allegro',
            sourceCategoryId: 'src-cat-1',
            sourceConnectionId: IsNull(),
          },
        ],
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    });

    it('matches by provenance + source category only when no source connection is given', async () => {
      repo.find.mockResolvedValue([]);

      await sut.findBySourceCategoryByProvenance('allegro', 'src-cat-1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { destinationTaxonomyProvenance: 'allegro', sourceCategoryId: 'src-cat-1' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    });

    it('returns the oldest row and warns when more than one matches', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      repo.find.mockResolvedValue([
        ormRow({ id: 'oldest', destinationCategoryId: 'dest-cat-OLD' }),
        ormRow({ id: 'newer', destinationCategoryId: 'dest-cat-NEW' }),
      ]);

      const result = await sut.findBySourceCategoryByProvenance('allegro', 'src-cat-1', 'src-conn-7');

      expect(result?.id).toBe('oldest');
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('returns null when no row matches', async () => {
      repo.find.mockResolvedValue([]);
      expect(await sut.findBySourceCategoryByProvenance('allegro', 'src-cat-1')).toBeNull();
    });
  });

  describe('upsertMapping', () => {
    it('creates a new row (provenance defaults to allegro) when none exists', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(ormRow({ destinationConnectionId: 'dest-1' }));
      repo.save.mockImplementation((e) =>
        Promise.resolve(ormRow({ ...(e as CategoryMappingOrmEntity), id: 'new-id' }))
      );

      const result = await sut.upsertMapping('dest-1', {
        sourceCategoryId: 'src-cat-9',
        destinationCategoryId: 'dest-cat-9',
        destinationCategoryName: 'Cameras',
      });

      // null source → lookup uses IsNull()
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { destinationConnectionId: 'dest-1', sourceCategoryId: 'src-cat-9', sourceConnectionId: IsNull() },
      });
      const saved = repo.save.mock.calls[0][0] as CategoryMappingOrmEntity;
      expect(saved.sourceCategoryId).toBe('src-cat-9');
      expect(saved.destinationTaxonomyProvenance).toBe('allegro');
      expect(saved.destinationCategoryPath).toBeNull();
      expect(result.id).toBe('new-id');
    });

    it('updates the existing row in place', async () => {
      const existing = ormRow({ id: 'existing', destinationCategoryName: 'Old' });
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockImplementation((e) => Promise.resolve(e as CategoryMappingOrmEntity));

      await sut.upsertMapping('dest-1', {
        sourceCategoryId: 'src-cat-1',
        destinationCategoryId: 'dest-cat-2',
        destinationCategoryName: 'New',
        sourceConnectionId: 'src-conn-7',
      });

      expect(repo.create).not.toHaveBeenCalled();
      const saved = repo.save.mock.calls[0][0] as CategoryMappingOrmEntity;
      expect(saved.id).toBe('existing');
      expect(saved.destinationCategoryName).toBe('New');
      expect(saved.sourceConnectionId).toBe('src-conn-7');
    });
  });

  describe('deleteMapping', () => {
    it('delegates to repo.delete keyed by destination + source category', async () => {
      repo.delete.mockResolvedValue({ affected: 1, raw: [] });
      await sut.deleteMapping('dest-1', 'src-cat-1');
      expect(repo.delete).toHaveBeenCalledWith({
        destinationConnectionId: 'dest-1',
        sourceCategoryId: 'src-cat-1',
      });
    });
  });
});
