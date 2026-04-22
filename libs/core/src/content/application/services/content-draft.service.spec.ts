/**
 * Content Draft Service — Unit Tests
 *
 * Covers all branches of the save / discard / publish / reconcile / resolve
 * lifecycle defined in §4.4 / §4.5 of the implementation plan. The repository
 * port is mocked; the publisher port is mocked.
 *
 * @module libs/core/src/content/application/services
 */
import { ContentDraftService } from './content-draft.service';
import { ProductContentField } from '../../domain/entities/product-content-field.entity';
import { ContentConflictException } from '../../domain/exceptions/content-conflict.exception';
import type { ContentPublisherPort } from '../../domain/ports/content-publisher.port';
import type { ProductContentFieldRepositoryPort } from '../../domain/ports/product-content-field-repository.port';

const buildField = (overrides: Partial<ProductContentField> = {}): ProductContentField => {
  const base = {
    id: 'fld-1',
    productId: 'ol_product_abc',
    connectionId: null as string | null,
    fieldKey: 'description' as const,
    draftValue: null as string | null,
    baseValue: null as string | null,
    baseVersion: null as string | null,
    hasConflict: false,
    updatedAt: new Date('2026-04-22T10:00:00Z'),
    updatedBy: null as string | null,
    ...overrides,
  };
  return new ProductContentField(
    base.id,
    base.productId,
    base.connectionId,
    base.fieldKey,
    base.draftValue,
    base.baseValue,
    base.baseVersion,
    base.hasConflict,
    base.updatedAt,
    base.updatedBy,
  );
};

const buildRepoMock = (): jest.Mocked<ProductContentFieldRepositoryPort> => ({
  findByKey: jest.fn(),
  upsert: jest.fn(),
  delete: jest.fn(),
});

const buildPublisherMock = (): jest.Mocked<ContentPublisherPort> => ({
  publish: jest.fn(),
});

describe('ContentDraftService', () => {
  let repo: jest.Mocked<ProductContentFieldRepositoryPort>;
  let publisher: jest.Mocked<ContentPublisherPort>;
  let service: ContentDraftService;

  beforeEach(() => {
    repo = buildRepoMock();
    publisher = buildPublisherMock();
    service = new ContentDraftService(repo, publisher);
  });

  describe('saveDraft', () => {
    it('should create a row with draftValue when no row exists', async () => {
      repo.findByKey.mockResolvedValue(null);
      repo.upsert.mockImplementation((p) =>
        Promise.resolve(buildField({ draftValue: p.draftValue, updatedBy: p.updatedBy })),
      );

      await service.saveDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        value: 'new draft',
        userId: 'user-1',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          draftValue: 'new draft',
          baseValue: null,
          baseVersion: null,
          hasConflict: false,
          updatedBy: 'user-1',
        }),
      );
    });

    it('should update draftValue and preserve baseValue/baseVersion when row exists', async () => {
      repo.findByKey.mockResolvedValue(
        buildField({ baseValue: 'old base', baseVersion: 'v1', draftValue: 'old draft' }),
      );
      repo.upsert.mockImplementation((p) =>
        Promise.resolve(buildField({ ...p, baseValue: p.baseValue, baseVersion: p.baseVersion })),
      );

      await service.saveDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        value: 'new draft',
        userId: 'user-2',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          draftValue: 'new draft',
          baseValue: 'old base',
          baseVersion: 'v1',
        }),
      );
    });

    it('should clear hasConflict when a new draft is saved over a previously-conflicted row (implicit acknowledgement)', async () => {
      repo.findByKey.mockResolvedValue(
        buildField({ baseValue: 'newer base', baseVersion: 'v2', draftValue: 'stale draft', hasConflict: true }),
      );
      repo.upsert.mockImplementation((p) => Promise.resolve(buildField(p)));

      await service.saveDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        value: 'reconciled draft',
        userId: 'user-1',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ hasConflict: false }),
      );
    });
  });

  describe('discardDraft', () => {
    it('should null draftValue when a row with a draft exists', async () => {
      repo.findByKey.mockResolvedValue(
        buildField({ baseValue: 'b', baseVersion: 'v1', draftValue: 'd' }),
      );

      await service.discardDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          draftValue: null,
          baseValue: 'b',
          baseVersion: 'v1',
        }),
      );
    });

    it('should be a no-op when no row exists', async () => {
      repo.findByKey.mockResolvedValue(null);

      await service.discardDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('should be a no-op when the row has no draft', async () => {
      repo.findByKey.mockResolvedValue(buildField({ baseValue: 'b', draftValue: null }));

      await service.discardDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('publishDraft', () => {
    it('should be a no-op when there is no draft to publish', async () => {
      repo.findByKey.mockResolvedValue(buildField({ baseValue: 'b', draftValue: null }));

      await service.publishDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(publisher.publish).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('should throw ContentConflictException when the row is conflicted', async () => {
      repo.findByKey.mockResolvedValue(
        buildField({ baseValue: 'newer', baseVersion: 'v2', draftValue: 'd', hasConflict: true }),
      );

      await expect(
        service.publishDraft({
          productId: 'ol_product_abc',
          connectionId: null,
          fieldKey: 'description',
        }),
      ).rejects.toBeInstanceOf(ContentConflictException);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('should call ContentPublisherPort.publish, set baseValue=draftValue, null draftValue, and update baseVersion on success', async () => {
      repo.findByKey.mockResolvedValue(
        buildField({ baseValue: 'old', baseVersion: 'v1', draftValue: 'new draft' }),
      );
      publisher.publish.mockResolvedValue({ baseVersion: 'v2-after-publish' });
      repo.upsert.mockImplementation((p) => Promise.resolve(buildField(p)));

      await service.publishDraft({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(publisher.publish).toHaveBeenCalledWith({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        value: 'new draft',
      });
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          draftValue: null,
          baseValue: 'new draft',
          baseVersion: 'v2-after-publish',
          hasConflict: false,
        }),
      );
    });
  });

  describe('reconcileExternal', () => {
    it('should silently update baseValue and baseVersion when no draft exists', async () => {
      repo.findByKey.mockResolvedValue(buildField({ baseValue: 'old', baseVersion: 'v1' }));
      repo.upsert.mockImplementation((p) => Promise.resolve(buildField(p)));

      await service.reconcileExternal({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        externalValue: 'platform value',
        externalVersion: 'v2',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          baseValue: 'platform value',
          baseVersion: 'v2',
          draftValue: null,
          hasConflict: false,
        }),
      );
    });

    it('should mark hasConflict=true when draft exists and external version differs from base', async () => {
      repo.findByKey.mockResolvedValue(
        buildField({ baseValue: 'old', baseVersion: 'v1', draftValue: 'pending draft' }),
      );
      repo.upsert.mockImplementation((p) => Promise.resolve(buildField(p)));

      await service.reconcileExternal({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        externalValue: 'someone else changed it',
        externalVersion: 'v2',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          baseValue: 'someone else changed it',
          baseVersion: 'v2',
          draftValue: 'pending draft',
          hasConflict: true,
        }),
      );
    });

    it('should be a no-op when external version equals base version (same-origin replay)', async () => {
      repo.findByKey.mockResolvedValue(
        buildField({ baseValue: 'b', baseVersion: 'v1', draftValue: 'd' }),
      );

      await service.reconcileExternal({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        externalValue: 'b',
        externalVersion: 'v1',
      });

      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('should insert a fresh row on first-touch when no row exists', async () => {
      repo.findByKey.mockResolvedValue(null);
      repo.upsert.mockImplementation((p) => Promise.resolve(buildField(p)));

      await service.reconcileExternal({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
        externalValue: 'first value',
        externalVersion: 'v0',
      });

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          baseValue: 'first value',
          baseVersion: 'v0',
          draftValue: null,
          hasConflict: false,
          updatedBy: null,
        }),
      );
    });
  });

  describe('resolveValue', () => {
    it('should return master draft when connectionId is null and a draft exists', async () => {
      repo.findByKey.mockResolvedValue(buildField({ baseValue: 'b', draftValue: 'master draft' }));

      const value = await service.resolveValue({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(value).toBe('master draft');
    });

    it('should return master baseValue when no draft and connectionId is null', async () => {
      repo.findByKey.mockResolvedValue(buildField({ baseValue: 'master base', draftValue: null }));

      const value = await service.resolveValue({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(value).toBe('master base');
    });

    it('should return null when no master row exists and connectionId is null', async () => {
      repo.findByKey.mockResolvedValue(null);

      const value = await service.resolveValue({
        productId: 'ol_product_abc',
        connectionId: null,
        fieldKey: 'description',
      });

      expect(value).toBeNull();
    });

    it('should prefer channel draft over channel base over master values when connectionId is set', async () => {
      // First call (channel) returns a draft.
      repo.findByKey.mockImplementation(({ connectionId }) =>
        Promise.resolve(
          connectionId === null
            ? buildField({ baseValue: 'master base' })
            : buildField({ connectionId: 'conn-1', draftValue: 'channel draft', baseValue: 'channel base' }),
        ),
      );

      const value = await service.resolveValue({
        productId: 'ol_product_abc',
        connectionId: 'conn-1',
        fieldKey: 'description',
      });

      expect(value).toBe('channel draft');
    });

    it('should fall back from channel base to master draft to master base when channel has no value', async () => {
      repo.findByKey.mockImplementation(({ connectionId }) =>
        Promise.resolve(
          connectionId === null
            ? buildField({ draftValue: 'master draft', baseValue: 'master base' })
            : null, // no channel row
        ),
      );

      const value = await service.resolveValue({
        productId: 'ol_product_abc',
        connectionId: 'conn-1',
        fieldKey: 'description',
      });

      expect(value).toBe('master draft');
    });

    it('should return null when neither channel nor master have any value', async () => {
      repo.findByKey.mockResolvedValue(null);

      const value = await service.resolveValue({
        productId: 'ol_product_abc',
        connectionId: 'conn-1',
        fieldKey: 'description',
      });

      expect(value).toBeNull();
    });
  });
});
