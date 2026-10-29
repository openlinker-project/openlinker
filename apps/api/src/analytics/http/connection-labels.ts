/**
 * Connection labels for CSV exports (#3589): the platform and connection name
 * the on-screen tables show, resolved with ONE list read per export.
 *
 * @module apps/api/src/analytics/http
 */
import type { IConnectionService } from '../../integrations/application/interfaces/connection.service.interface';

export interface ConnectionLabel {
  readonly platform: string;
  readonly name: string;
}

export type ConnectionLabels = ReadonlyMap<string, ConnectionLabel>;

function platformLabel(platformType: string): string {
  return platformType.length === 0
    ? platformType
    : platformType.charAt(0).toUpperCase() + platformType.slice(1);
}

export async function loadConnectionLabels(
  connections: Pick<IConnectionService, 'list'>
): Promise<ConnectionLabels> {
  const all = await connections.list();
  return new Map(
    all.map((c): [string, ConnectionLabel] => [
      c.id,
      { platform: platformLabel(c.platformType), name: c.name },
    ])
  );
}

/** `channel` = platform, `connection` = name; a connection that no longer exists reads Unknown / its id. */
export function channelCells(
  labels: ConnectionLabels,
  connectionId: string
): { channel: string; connection: string } {
  const label = labels.get(connectionId);
  return label === undefined
    ? { channel: 'Unknown', connection: connectionId }
    : { channel: label.platform, connection: label.name };
}

/** Column-header suffix that stays unambiguous when two connections share a name. */
export function connectionHeaderLabel(labels: ConnectionLabels, connectionId: string): string {
  const label = labels.get(connectionId);
  return label === undefined ? connectionId : `${label.name} (${label.platform})`;
}
