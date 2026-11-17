/**
 * Release State View Service Spec
 *
 * @module apps/api/src/release-center
 */
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import type { IOperationalSettingsService } from '@openlinker/core/operational-settings';
import type {
  IReleaseCursorService,
  IReleaseItemStateService,
} from '@openlinker/core/release-center';
import type { IConnectionService } from '../integrations/application/interfaces/connection.service.interface';
import { UnknownReleaseConnectionError } from './release-center.errors';
import { ReleaseStateViewService } from './release-state-view.service';

const CONNECTION_ID = '3f2a1c9e-0000-4000-8000-000000000000';

function build(enabled: boolean) {
  const settings = {
    resolve: jest.fn().mockResolvedValue({ releaseCenterEnabled: { value: enabled } }),
  };
  const cursors = {
    getState: jest.fn().mockResolvedValue(null),
    advance: jest.fn(),
    setSkipDialog: jest.fn(),
  };
  const items = {
    getSnapshot: jest.fn().mockResolvedValue({ user: [], installation: [] }),
    applyUserStates: jest.fn().mockResolvedValue([]),
    applyInstallationStates: jest.fn().mockResolvedValue([]),
  };
  const connections = { get: jest.fn().mockResolvedValue({ id: CONNECTION_ID }) };
  const service = new ReleaseStateViewService(
    settings as unknown as IOperationalSettingsService,
    cursors as unknown as IReleaseCursorService,
    items as unknown as IReleaseItemStateService,
    connections as unknown as IConnectionService
  );
  return { service, cursors, items, connections };
}

describe('ReleaseStateViewService', () => {
  it('should answer enabled false without reading the tables when disabled', async () => {
    const { service, cursors, items } = build(false);
    await expect(service.getView('u1')).resolves.toEqual({
      enabled: false,
      cursor: null,
      user: [],
      installation: [],
    });
    expect(cursors.getState).not.toHaveBeenCalled();
    expect(items.getSnapshot).not.toHaveBeenCalled();
  });

  it('should read cursor and snapshot when enabled', async () => {
    const { service, cursors, items } = build(true);
    const view = await service.getView('u1');
    expect(view.enabled).toBe(true);
    expect(cursors.getState).toHaveBeenCalledWith('u1');
    expect(items.getSnapshot).toHaveBeenCalledWith('u1');
  });

  it('should reject a step naming an unknown connection', async () => {
    const { service, connections, items } = build(true);
    connections.get.mockRejectedValue(new ConnectionNotFoundException(CONNECTION_ID));
    await expect(
      service.applyInstallationStates('a1', [
        { itemKey: `carrier-mapping:${CONNECTION_ID}`, status: 'done' },
      ])
    ).rejects.toBeInstanceOf(UnknownReleaseConnectionError);
    expect(items.applyInstallationStates).not.toHaveBeenCalled();
  });

  it('should not look up a connection for a step without a connection suffix', async () => {
    const { service, connections, items } = build(true);
    await service.applyInstallationStates('a1', [{ itemKey: 'welcome', status: 'done' }]);
    expect(connections.get).not.toHaveBeenCalled();
    expect(items.applyInstallationStates).toHaveBeenCalled();
  });
});
