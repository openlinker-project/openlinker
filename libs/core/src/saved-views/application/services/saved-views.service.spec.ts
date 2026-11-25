/* eslint-disable @typescript-eslint/require-await -- the in-memory fake implements an async port without awaiting anything */
import { SavedView, SavedViewDefault } from '../../domain/entities/saved-view.entity';
import {
  InvalidSavedViewError,
  SavedViewForbiddenError,
  SavedViewNameTakenError,
  SavedViewNotFoundError,
  SavedViewRevisionConflictError,
} from '../../domain/exceptions/saved-view.exceptions';
import type {
  InsertSavedViewInput,
  SavedViewPatch,
  SavedViewRepositoryPort,
} from '../../domain/ports/saved-view-repository.port';
import type { SavedViewActor } from '../../domain/types/saved-view.types';
import { SavedViewsService } from './saved-views.service';

const definition = { v: 1, query: '', sort: null, columns: ['a'], parts: {} };

class FakeRepository implements SavedViewRepositoryPort {
  views: SavedView[] = [];
  defaults: SavedViewDefault[] = [];
  private seq = 0;

  async findById(id: string) {
    return this.views.find((v) => v.id === id) ?? null;
  }
  async listVisible(userId: string, pageKey: string) {
    return this.views.filter(
      (v) =>
        v.pageKey === pageKey && (v.scope === 'shared' || v.ownerUserId === userId)
    );
  }
  async countPersonal(userId: string, pageKey: string) {
    return this.views.filter(
      (v) => v.scope === 'personal' && v.ownerUserId === userId && v.pageKey === pageKey
    ).length;
  }
  async insert(input: InsertSavedViewInput) {
    const clash = this.views.some(
      (v) =>
        v.scope === input.scope &&
        v.pageKey === input.pageKey &&
        v.name === input.name &&
        v.ownerUserId === input.ownerUserId
    );
    if (clash) throw new SavedViewNameTakenError(input.pageKey, input.name);
    const view = new SavedView(
      `id-${++this.seq}`,
      input.scope,
      input.ownerUserId,
      input.createdByUserId,
      input.pageKey,
      input.name,
      input.definition,
      1,
      input.isWorkspaceDefault,
      new Date(),
      new Date()
    );
    this.views.push(view);
    return view;
  }
  async updateIfRevision(id: string, expectedRevision: number, patch: SavedViewPatch) {
    const i = this.views.findIndex((v) => v.id === id);
    if (i < 0 || this.views[i].revision !== expectedRevision) return null;
    const v = this.views[i];
    this.views[i] = new SavedView(
      v.id,
      v.scope,
      v.ownerUserId,
      v.createdByUserId,
      v.pageKey,
      patch.name ?? v.name,
      patch.definition ?? v.definition,
      v.revision + 1,
      patch.isWorkspaceDefault ?? v.isWorkspaceDefault,
      v.createdAt,
      new Date()
    );
    return this.views[i];
  }
  async delete(id: string) {
    const before = this.views.length;
    this.views = this.views.filter((v) => v.id !== id);
    return this.views.length < before;
  }
  async findDefault(userId: string, pageKey: string) {
    return this.defaults.find((d) => d.userId === userId && d.pageKey === pageKey) ?? null;
  }
  async upsertDefault(userId: string, pageKey: string, savedViewId: string | null) {
    this.defaults = this.defaults.filter((d) => !(d.userId === userId && d.pageKey === pageKey));
    this.defaults.push(new SavedViewDefault(userId, pageKey, savedViewId));
  }
  async clearDefault(userId: string, pageKey: string) {
    this.defaults = this.defaults.filter((d) => !(d.userId === userId && d.pageKey === pageKey));
  }
}

const alice: SavedViewActor = { userId: 'alice', isAdmin: false };
const bob: SavedViewActor = { userId: 'bob', isAdmin: false };
const admin: SavedViewActor = { userId: 'root', isAdmin: true };

describe('SavedViewsService', () => {
  let repo: FakeRepository;
  let service: SavedViewsService;

  beforeEach(() => {
    repo = new FakeRepository();
    service = new SavedViewsService(repo, { normalise: async (_page, def) => def });
  });

  const personal = (actor: SavedViewActor, name = 'mine', pageKey = 'orders') =>
    service.create(actor, { pageKey, name, scope: 'personal', definition });

  describe('visibility', () => {
    it('should list own personal views and every shared view, never another user\'s personal view', async () => {
      await personal(alice, 'a');
      await personal(bob, 'b');
      await service.create(admin, { pageKey: 'orders', name: 'team', scope: 'shared', definition });

      const names = (await service.list(alice, 'orders')).map((v) => v.name).sort();
      expect(names).toEqual(['a', 'team']);
    });

    it('should answer not-found, not forbidden, for another user\'s personal view', async () => {
      const view = await personal(alice);
      await expect(
        service.update(bob, view.id, { name: 'x', expectedRevision: 1 })
      ).rejects.toBeInstanceOf(SavedViewNotFoundError);
      await expect(service.remove(bob, view.id)).rejects.toBeInstanceOf(SavedViewNotFoundError);
      await expect(service.setDefault(bob, 'orders', view.id)).rejects.toBeInstanceOf(
        SavedViewNotFoundError
      );
    });

    it('should let a non-admin read a shared view but not change or delete it', async () => {
      const shared = await service.create(admin, {
        pageKey: 'orders',
        name: 'team',
        scope: 'shared',
        definition,
      });
      expect((await service.list(alice, 'orders'))[0]).toMatchObject({ canEdit: false });
      await expect(
        service.update(alice, shared.id, { name: 'x', expectedRevision: 1 })
      ).rejects.toBeInstanceOf(SavedViewForbiddenError);
      await expect(service.remove(alice, shared.id)).rejects.toBeInstanceOf(
        SavedViewForbiddenError
      );
    });

    it('should refuse a non-admin creating a shared view', async () => {
      await expect(
        service.create(alice, { pageKey: 'orders', name: 'x', scope: 'shared', definition })
      ).rejects.toBeInstanceOf(SavedViewForbiddenError);
    });

    it('should let an admin manage shared views and give them no owner', async () => {
      const shared = await service.create(admin, {
        pageKey: 'orders',
        name: 'team',
        scope: 'shared',
        definition,
      });
      expect(shared).toMatchObject({ ownerUserId: null, createdByUserId: 'root', canEdit: true });
      await service.remove(admin, shared.id);
      expect(repo.views).toHaveLength(0);
    });

    it('should let a viewer-level user clone a shared view as a personal one', async () => {
      const clone = await personal(alice, 'team (copy)');
      expect(clone).toMatchObject({ scope: 'personal', ownerUserId: 'alice', canEdit: true });
    });
  });

  describe('limits', () => {
    it('should refuse the 51st personal view for a user and page but not on another page', async () => {
      for (let i = 0; i < 50; i++) await personal(alice, `v${i}`);
      await expect(personal(alice, 'one-too-many')).rejects.toMatchObject({
        rule: 'too-many-views',
        limit: 50,
      });
      await expect(personal(alice, 'ok', 'products')).resolves.toBeDefined();
      await expect(personal(bob, 'ok')).resolves.toBeDefined();
    });

    it('should reject an oversized definition with an InvalidSavedViewError', async () => {
      await expect(
        service.create(alice, {
          pageKey: 'orders',
          name: 'x',
          scope: 'personal',
          definition: { ...definition, query: 'a'.repeat(2049) },
        })
      ).rejects.toBeInstanceOf(InvalidSavedViewError);
    });

    it.each(['', '   ', 'x'.repeat(101)])('should reject the name %p', async (name) => {
      await expect(
        service.create(alice, { pageKey: 'orders', name, scope: 'personal', definition })
      ).rejects.toMatchObject({ rule: 'invalid-name' });
    });

    it('should trim the stored name', async () => {
      expect((await personal(alice, '  padded  ')).name).toBe('padded');
    });

    it('should not allow a personal view to be the workspace default', async () => {
      await expect(
        service.create(alice, {
          pageKey: 'orders',
          name: 'x',
          scope: 'personal',
          definition,
          workspaceDefault: true,
        })
      ).rejects.toBeInstanceOf(InvalidSavedViewError);
    });
  });

  describe('optimistic concurrency', () => {
    it('should bump the revision and apply the patch when the expected revision matches', async () => {
      const view = await personal(alice);
      const updated = await service.update(alice, view.id, { name: 'renamed', expectedRevision: 1 });
      expect(updated).toMatchObject({ name: 'renamed', revision: 2 });
    });

    it('should raise a revision conflict when the revision is stale', async () => {
      const view = await personal(alice);
      await service.update(alice, view.id, { name: 'r1', expectedRevision: 1 });
      await expect(
        service.update(alice, view.id, { name: 'r2', expectedRevision: 1 })
      ).rejects.toBeInstanceOf(SavedViewRevisionConflictError);
    });

    it('should validate a replaced definition', async () => {
      const view = await personal(alice);
      await expect(
        service.update(alice, view.id, { definition: { v: 1 }, expectedRevision: 1 })
      ).rejects.toBeInstanceOf(InvalidSavedViewError);
    });
  });

  describe('default view fallback chain', () => {
    it('should resolve to no view (the system All) when nothing is set', async () => {
      await personal(alice);
      expect((await service.list(alice, 'orders')).some((v) => v.isDefault)).toBe(false);
    });

    it('should fall back to the shared workspace default', async () => {
      await service.create(admin, {
        pageKey: 'orders',
        name: 'team',
        scope: 'shared',
        definition,
        workspaceDefault: true,
      });
      const list = await service.list(alice, 'orders');
      expect(list.find((v) => v.name === 'team')?.isDefault).toBe(true);
    });

    it('should prefer the personal default over the shared one', async () => {
      await service.create(admin, {
        pageKey: 'orders',
        name: 'team',
        scope: 'shared',
        definition,
        workspaceDefault: true,
      });
      const mine = await personal(alice);
      await service.setDefault(alice, 'orders', mine.id);
      const list = await service.list(alice, 'orders');
      expect(list.filter((v) => v.isDefault).map((v) => v.name)).toEqual(['mine']);
    });

    it('should treat an explicit null as a choice of the system view, beating the shared default', async () => {
      await service.create(admin, {
        pageKey: 'orders',
        name: 'team',
        scope: 'shared',
        definition,
        workspaceDefault: true,
      });
      await service.setDefault(alice, 'orders', null);
      expect((await service.list(alice, 'orders')).some((v) => v.isDefault)).toBe(false);
    });

    it('should fall through, never error, when the default points at a view that is gone', async () => {
      const mine = await personal(alice);
      await service.setDefault(alice, 'orders', mine.id);
      repo.views = [];
      await expect(service.list(alice, 'orders')).resolves.toEqual([]);
    });

    it('should not let a default point at a view of another page', async () => {
      const mine = await personal(alice, 'mine', 'products');
      await expect(service.setDefault(alice, 'orders', mine.id)).rejects.toBeInstanceOf(
        SavedViewNotFoundError
      );
    });
  });

  describe('tolerant read', () => {
    it('should return a stale stored definition flagged, never throw', async () => {
      repo.views.push(
        new SavedView('x', 'personal', 'alice', 'alice', 'orders', 'old', 'garbage', 1, false, new Date(), new Date())
      );
      const [view] = await service.list(alice, 'orders');
      expect(view).toMatchObject({ stale: true, name: 'old' });
      expect(view.definition.columns).toEqual([]);
    });
  });
});
