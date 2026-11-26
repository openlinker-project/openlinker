import type { HttpException } from '@nestjs/common';
import {
  InvalidSavedViewError,
  SavedViewForbiddenError,
  SavedViewNameTakenError,
  SavedViewNotFoundError,
  SavedViewRevisionConflictError,
  type ISavedViewsService,
  type SavedViewReadModel,
} from '@openlinker/core/saved-views';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { SavedViewsController } from './saved-views.controller';

const view: SavedViewReadModel = {
  id: '11111111-1111-1111-1111-111111111111',
  pageKey: 'orders',
  scope: 'personal',
  name: 'mine',
  definition: { v: 1, query: '', sort: null, columns: ['a'], parts: {} },
  stale: false,
  revision: 1,
  ownerUserId: 'u1',
  createdByUserId: 'u1',
  isWorkspaceDefault: false,
  isDefault: true,
  canEdit: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const user = (role: AuthenticatedUser['role']): AuthenticatedUser =>
  ({ id: 'u1', username: 'u', role }) as AuthenticatedUser;

function makeController(): { controller: SavedViewsController; service: jest.Mocked<ISavedViewsService> } {
  const service: jest.Mocked<ISavedViewsService> = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    setDefault: jest.fn(),
  };
  return { controller: new SavedViewsController(service), service };
}

async function statusAndCode(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const http = error as HttpException;
    return { status: http.getStatus(), code: (http.getResponse() as { code: string }).code };
  }
  throw new Error('expected a rejection');
}

describe('SavedViewsController', () => {
  it('should map the role to an actor flag and serialise dates', async () => {
    const { controller, service } = makeController();
    service.list.mockResolvedValue([view]);
    const res = { setHeader: jest.fn() } as never;

    const out = await controller.list({ pageKey: 'orders' }, user('admin'), res);

    expect(service.list).toHaveBeenCalledWith({ userId: 'u1', isAdmin: true }, 'orders');
    expect(out[0]).toMatchObject({ id: view.id, createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it('should treat a non-admin role as isAdmin false', async () => {
    const { controller, service } = makeController();
    service.create.mockResolvedValue(view);
    await controller.create(
      { pageKey: 'orders', name: 'n', scope: 'shared', definition: {} },
      user('operator')
    );
    expect(service.create.mock.calls[0][0]).toEqual({ userId: 'u1', isAdmin: false });
  });

  it.each([
    [new SavedViewNotFoundError('x'), 404, 'SAVED_VIEW_NOT_FOUND'],
    [new SavedViewForbiddenError(), 403, 'SAVED_VIEW_FORBIDDEN'],
    [new SavedViewNameTakenError('orders', 'n'), 409, 'SAVED_VIEW_NAME_TAKEN'],
    [new SavedViewRevisionConflictError('x', 1), 409, 'SAVED_VIEW_REVISION_CONFLICT'],
    [new InvalidSavedViewError('definition', 'too big', 'definition-too-large', 16384), 400, 'SAVED_VIEW_INVALID'],
  ])('should map %p to HTTP %i %s', async (error, status, code) => {
    const { controller, service } = makeController();
    service.update.mockRejectedValue(error);
    await expect(
      statusAndCode(controller.update(view.id, { expectedRevision: 1 }, user('admin')))
    ).resolves.toEqual({ status, code });
  });

  it('should pass unknown errors through untouched', async () => {
    const { controller, service } = makeController();
    const boom = new Error('boom');
    service.remove.mockRejectedValue(boom);
    await expect(controller.remove(view.id, user('admin'))).rejects.toBe(boom);
  });

  it('should pass the viewId, including null, to setDefault', async () => {
    const { controller, service } = makeController();
    await controller.setDefault({ pageKey: 'orders', viewId: null }, user('viewer'));
    expect(service.setDefault).toHaveBeenCalledWith({ userId: 'u1', isAdmin: false }, 'orders', null);
  });
});
