/**
 * Edit form: who ships, per sales channel (#4135)
 *
 * The assignment itself lives only in Mappings (Fulfilment tab). This section
 * summarises it for the channel being edited, or for every channel paired with
 * the shop being edited, and links there. It holds no picker and suggests no
 * carrier. A shop that ships by default is stated outright, so it is visible
 * without opening a channel's own page.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useMessages } from '../../../shared/i18n';
import { MappingPairingBar, resolveMappingPairing } from '../../mappings';
import type { Connection } from '../api/connections.types';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import { OrderSourceShippingSummary } from './order-source-shipping-card';
import { shippingAssignmentPath } from './shipping-assignment-path';

const ORDER_SOURCE = 'OrderSource';
/** From this many channels the list scrolls instead of pushing the form down. */
const SCROLL_FROM = 3;

function pairedMasterId(connection: Connection): string | undefined {
  const value = connection.config?.['masterCatalogConnectionId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The channels this edit form speaks about: itself, or the ones paired to it. */
export function channelsForShippingSummary(
  connection: Connection,
  all: readonly Connection[]
): Connection[] {
  if (pairedMasterId(connection) !== undefined) {
    return connection.enabledCapabilities.includes(ORDER_SOURCE) ? [connection] : [];
  }
  return all.filter(
    (c) => pairedMasterId(c) === connection.id && c.enabledCapabilities.includes(ORDER_SOURCE)
  );
}

export interface ChannelShippingSummarySectionProps {
  readonly connection: Connection;
}

export function ChannelShippingSummarySection({
  connection,
}: ChannelShippingSummarySectionProps): ReactElement {
  const copy = useMessages('connections').shippingSummary;
  const connectionsQuery = useConnectionsQuery();
  const all = connectionsQuery.data ?? [];
  const channels = channelsForShippingSummary(connection, all);

  if (channels.length === 0) {
    return <p className="muted-text">{copy.noChannels}</p>;
  }

  return (
    <div className="channel-shipping">
      <p className="muted-text">{copy.intro}</p>
      <ul
        className={[
          'channel-shipping__list',
          channels.length >= SCROLL_FROM ? 'channel-shipping__list--scroll' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {channels.map((channel) => {
          const pairing = resolveMappingPairing(channel, all);
          return (
            <li key={channel.id} className="channel-shipping__item">
              {pairing.status === 'ready' ? <MappingPairingBar pairing={pairing} /> : null}
              <div className="source-shipping">
                <OrderSourceShippingSummary connection={channel} />
              </div>
              <Link className="link" to={shippingAssignmentPath(channel.id)}>
                {copy.configure}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
