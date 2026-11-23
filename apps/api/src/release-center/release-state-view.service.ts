/**
 * Release State View Service
 *
 * Composes what the leaf release-center context deliberately cannot: the
 * `enabled` flag (operational-settings) and the check that a connection-scoped
 * step key (`stepId:connectionId`) names a connection that exists. The leaf
 * imports no sibling context (ADR-086), so both live in the API layer.
 *
 * @module apps/api/src/release-center
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import {
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
  type IOperationalSettingsService,
} from '@openlinker/core/operational-settings';
import {
  RELEASE_CENTER_CURSOR_SERVICE_TOKEN,
  RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN,
  type IReleaseCursorService,
  type IReleaseItemStateService,
  type ReleaseItemState,
  type ReleaseItemStateChange,
  type UserReleaseState,
} from '@openlinker/core/release-center';
import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../integrations/application/interfaces/connection.service.interface';
import { UnknownReleaseConnectionError } from './release-center.errors';
import type {
  IReleaseStateViewService,
  ReleaseStateView,
} from './release-state-view.service.interface';

/** A connection id is a UUID; a step id never ends in that shape. */
const CONNECTION_SUFFIX = /:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

@Injectable()
export class ReleaseStateViewService implements IReleaseStateViewService {
  constructor(
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IOperationalSettingsService,
    @Inject(RELEASE_CENTER_CURSOR_SERVICE_TOKEN)
    private readonly cursors: IReleaseCursorService,
    @Inject(RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN)
    private readonly items: IReleaseItemStateService,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService
  ) {}

  async getView(userId: string): Promise<ReleaseStateView> {
    const enabled = (await this.settings.resolve()).releaseCenterEnabled.value;
    if (!enabled) {
      // The switch turns off what an update brings (the window, the release cards, the guides). The
      // caller's own item states stay readable, because messages in the bell keep them: without them every
      // archived message would come back unread. There is no cursor and no installation state to report.
      const snapshot = await this.items.getSnapshot(userId);
      return { enabled: false, cursor: null, user: snapshot.user, installation: [] };
    }
    const [cursor, snapshot] = await Promise.all([
      this.cursors.getState(userId),
      this.items.getSnapshot(userId),
    ]);
    return { enabled: true, cursor, user: snapshot.user, installation: snapshot.installation };
  }

  async advanceCursor(
    userId: string,
    update: { version?: string; skipDialog?: boolean }
  ): Promise<{ applied: boolean; cursor: UserReleaseState | null }> {
    let applied = true;
    let cursor: UserReleaseState | null = null;
    if (update.version !== undefined) {
      const result = await this.cursors.advance(userId, update.version);
      applied = result.applied;
      cursor = result.state;
    }
    if (update.skipDialog !== undefined) {
      cursor = await this.cursors.setSkipDialog(userId, update.skipDialog);
    }
    return { applied, cursor: cursor ?? (await this.cursors.getState(userId)) };
  }

  applyUserStates(
    userId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]> {
    return this.items.applyUserStates(userId, changes);
  }

  async applyInstallationStates(
    actedByUserId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]> {
    for (const change of changes) {
      const connectionId = CONNECTION_SUFFIX.exec(change.itemKey)?.[1];
      if (connectionId === undefined) continue;
      try {
        await this.connections.get(connectionId);
      } catch (error) {
        if (error instanceof ConnectionNotFoundException) {
          throw new UnknownReleaseConnectionError(change.itemKey, connectionId);
        }
        throw error;
      }
    }
    return this.items.applyInstallationStates(actedByUserId, changes);
  }
}
