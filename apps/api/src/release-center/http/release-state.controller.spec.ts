/**
 * Release State Controller Spec
 *
 * @module apps/api/src/release-center/http
 */
import 'reflect-metadata';
import type { Response } from 'express';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { IReleaseStateViewService } from '../release-state-view.service.interface';
import { ReleaseStateController } from './release-state.controller';
import type { UpdateInstallationReleaseStepsDto } from './dto/release-state.dto';

const res = { setHeader: jest.fn() } as unknown as Response;
const user = (role: AuthenticatedUser['role']): AuthenticatedUser =>
  ({ id: 'u1', role }) as AuthenticatedUser;

const row = {
  id: 'r1',
  scope: 'installation' as const,
  userId: null,
  itemKey: 'welcome',
  status: 'done' as const,
  doneVia: null,
  actedByUserId: 'someone',
  snoozedUntil: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function build() {
  const view = {
    getView: jest
      .fn()
      .mockResolvedValue({ enabled: true, cursor: null, user: [], installation: [row] }),
    advanceCursor: jest.fn(),
    applyUserStates: jest.fn().mockResolvedValue([row]),
    applyInstallationStates: jest.fn().mockResolvedValue([row]),
  };
  return { view, controller: new ReleaseStateController(view as unknown as IReleaseStateViewService) };
}

describe('ReleaseStateController', () => {
  it('should declare explicit roles with steps admin only and no packer', () => {
    const roles = (name: keyof ReleaseStateController): string[] =>
      Reflect.getMetadata(ROLES_KEY, ReleaseStateController.prototype[name]) as string[];
    expect(roles('get')).toEqual(['admin', 'operator', 'viewer']);
    expect(roles('putCursor')).toEqual(['admin', 'operator', 'viewer']);
    expect(roles('putItems')).toEqual(['admin', 'operator', 'viewer']);
    expect(roles('putSteps')).toEqual(['admin']);
  });

  it('should omit actedByUserId for non-admins and include it for admins', async () => {
    const { controller } = build();
    const viewer = await controller.get(user('viewer'), res);
    expect(viewer.installation[0]).not.toHaveProperty('actedByUserId');
    const admin = await controller.get(user('admin'), res);
    expect(admin.installation[0].actedByUserId).toBe('someone');
  });

  it('should take the user id from the token and ignore a body userId', async () => {
    const { controller, view } = build();
    await controller.putItems(user('viewer'), {
      userId: 'attacker',
      changes: [{ itemKey: 'a', status: 'archived' }],
    } as never);
    expect(view.applyUserStates).toHaveBeenCalledWith('u1', expect.any(Array));
  });

  it('should record the acting admin on installation steps', async () => {
    const { controller, view } = build();
    await controller.putSteps(user('admin'), {
      changes: [{ itemKey: 'welcome', status: 'done' }],
    } as UpdateInstallationReleaseStepsDto);
    expect(view.applyInstallationStates).toHaveBeenCalledWith('u1', [
      { itemKey: 'welcome', status: 'done', doneVia: undefined },
    ]);
  });
});
