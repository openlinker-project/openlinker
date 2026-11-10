/**
 * PromotionChannelChip (#3935)
 *
 * A connection as the platform chip the rest of the app uses. Where the chip
 * names a channel the promotion is about (a readback sentence, a checkbox list)
 * it is plain; where it is a destination to go to (a table row, the peek) it is
 * the clickable `ConnectionChip` with the name that slides out.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { usePlatforms } from '../../../shared/plugins';
import {
  ConnectionChip,
  readConnectionEnvironment,
  type Connection,
} from '../../connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../mappings';

export interface PromotionChannelChipProps {
  connection: Pick<Connection, 'id' | 'name' | 'platformType' | 'config'>;
  /** Render the clickable chip; plain by default. */
  link?: boolean;
  loading?: boolean;
}

export function PromotionChannelChip({
  connection,
  link = false,
  loading = false,
}: PromotionChannelChipProps): ReactElement {
  const platforms = usePlatforms();
  const label = resolvePlatformLabel(platforms, connection.platformType);
  const shortLabel = resolvePlatformShortLabel(platforms, connection.platformType);
  if (link) {
    return (
      <ConnectionChip
        connectionId={connection.id}
        name={connection.name}
        loading={loading}
        channel={{
          platformType: connection.platformType,
          label,
          shortLabel,
          environment: readConnectionEnvironment(connection.config),
        }}
      />
    );
  }
  return (
    <span
      className="connection-chip"
      data-channel={connection.platformType}
      title={`${connection.name} (${label})`}
    >
      <span className="connection-chip__face">
        <span className="connection-chip__dot" aria-hidden="true" />
        <span className="connection-chip__platform">{shortLabel || label}</span>
      </span>
    </span>
  );
}
