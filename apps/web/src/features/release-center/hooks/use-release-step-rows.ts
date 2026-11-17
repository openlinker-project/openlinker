/**
 * Release step rows (#4147)
 *
 * The steps that apply to this installation, one row per step and per
 * connection, with their stored completion. Connections are read only when a
 * visible step needs them.
 *
 * @module features/release-center/hooks
 */
import { useMemo } from 'react';
import { APP_VERSION } from '../../../shared/config/app-version';
import { useConnectionsQuery } from '../../connections';
import { RELEASE_STEPS } from '../catalog/release-steps';
import {
  buildStepRows,
  type NamedStepConnection,
  type ReleaseStepRow,
} from '../lib/release-dialog-content';
import { visibleSteps } from '../lib/visible-steps';
import { useReleaseCenterAccess } from './use-release-center-access';
import { useReleaseStateQuery } from './use-release-state-query';

export function useReleaseStepRows(introducedAfter: string | null = null): ReleaseStepRow[] {
  const { canRead } = useReleaseCenterAccess();
  const state = useReleaseStateQuery().data;
  const needsConnections = visibleSteps(RELEASE_STEPS, APP_VERSION).some(
    (step) => step.scope === 'connection'
  );
  const connections = useConnectionsQuery(undefined, { enabled: canRead && needsConnections }).data;

  return useMemo(() => {
    const named: NamedStepConnection[] = (connections ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      platformType: c.platformType,
      capabilities: c.enabledCapabilities,
      config: c.config,
    }));
    return buildStepRows(RELEASE_STEPS, named, state, APP_VERSION, introducedAfter);
  }, [connections, state, introducedAfter]);
}
