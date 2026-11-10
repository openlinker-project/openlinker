/**
 * Channel chips of a gift row: the channels that sent the orders carrying it.
 *
 * @module features/gift-report/components
 */
import type { ReactElement } from 'react';
import { usePlatforms } from '../../../shared/plugins';
import {
  ConnectionChip,
  readConnectionEnvironment,
  useConnectionsQuery,
} from '../../connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../mappings';

export function GiftChannelChips({ ids }: { ids: readonly string[] }): ReactElement {
  const connections = useConnectionsQuery();
  const platforms = usePlatforms();
  const byId = new Map((connections.data ?? []).map((c) => [c.id, c]));
  return (
    <span className="gift-chans">
      {ids.map((id) => {
        const connection = byId.get(id);
        return (
          <ConnectionChip
            key={id}
            connectionId={id}
            name={connection?.name ?? null}
            loading={connections.isLoading}
            channel={{
              platformType: connection?.platformType,
              label: connection ? resolvePlatformLabel(platforms, connection.platformType) : null,
              shortLabel: connection ? resolvePlatformShortLabel(platforms, connection.platformType) : null,
              environment: readConnectionEnvironment(connection?.config),
            }}
          />
        );
      })}
    </span>
  );
}
