/**
 * Carrier connection: "Ships for" card and the just-connected notice (#3958)
 *
 * A carrier (InPost, DPD) buys labels only for the delivery methods some order
 * source routes to it, and those routes are stored on the SOURCE. So a carrier
 * page could not say what it ships for. This card reads every active source's
 * rules (no new endpoint) and lists, per source, the delivery methods routed
 * here. It is read-only (#4137): assignment is edited on the sales channel, so
 * each row only links there and the card never becomes a second editor.
 *
 * `CarrierCreatedNotice` is what a carrier wizard lands on: a new carrier
 * ships nothing until a route points at it, which is easy to miss, so the page
 * says so and links to the first source that does not use it yet.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  DELIVERY_MAPPING_DEEP_LINK_PARAMS,
  useMappingOptions,
  useRoutingRulesForConnections,
  useRoutingRulesQuery,
} from '../../mappings';
import { Alert } from '../../../shared/ui/alert';
import { EmptyState } from '../../../shared/ui/feedback-state';
import type { Connection } from '../api/connections.types';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import { useConnectionShippingCopy } from '../hooks/use-connection-shipping-copy';
import {
  DELIVERY_METHOD_OPTION_KEYS,
  activeOrderSources,
  rulesRoutedTo,
} from './connection-shipping-routes';

/** The sales channel's fulfillment routing tab, where assignment is edited. */
export function channelAssignmentPath(sourceId: string): string {
  return `/connections/${sourceId}/mappings?${DELIVERY_MAPPING_DEEP_LINK_PARAMS.tab}=fulfillment`;
}

interface CarrierSourceRowProps {
  readonly source: Connection;
  readonly carrier: Connection;
}

function CarrierSourceRow({ source, carrier }: CarrierSourceRowProps): ReactElement {
  const copy = useConnectionShippingCopy();
  const rulesQuery = useRoutingRulesQuery(source.id);
  const { options } = useMappingOptions(source.id, DELIVERY_METHOD_OPTION_KEYS);
  const routed = rulesRoutedTo(rulesQuery.data, carrier.id);
  const known = new Map(options.allegroDeliveryMethods.map((m) => [m.value, m.label]));
  const names = routed.flatMap((r) => (known.has(r.sourceDeliveryMethodId) ? [known.get(r.sourceDeliveryMethodId)!] : []));
  const unnamed = routed.length - names.length;

  let body: ReactElement;
  if (rulesQuery.isLoading) {
    body = <span className="muted-text">{copy.rowLoading}</span>;
  } else if (rulesQuery.error) {
    body = <span className="muted-text">{copy.rowUnavailable}</span>;
  } else if (routed.length === 0) {
    body = <span className="muted-text">{copy.shipsForEmpty(carrier.name)}</span>;
  } else {
    body = (
      <ul className="ships-for__methods">
        {names.map((name) => (
          <li key={name} className="ships-for__method">{name}</li>
        ))}
        {unnamed > 0 ? <li className="ships-for__method ships-for__method--muted">{copy.shipsForUnnamed(unnamed)}</li> : null}
      </ul>
    );
  }

  return (
    <li className="ships-for__row" data-testid={`ships-for-row-${source.id}`}>
      <div className="ships-for__text">
        <span className="ships-for__source">{source.name}</span>
        {body}
      </div>
      <Link className="button button--secondary button--sm" to={channelAssignmentPath(source.id)}>
        {copy.rowOpenChannel}
      </Link>
    </li>
  );
}

export interface CarrierShipsForCardProps {
  /** The carrier connection whose page this is. */
  readonly connection: Connection;
}

export function CarrierShipsForCard({ connection }: CarrierShipsForCardProps): ReactElement {
  const copy = useConnectionShippingCopy();
  const connectionsQuery = useConnectionsQuery();
  const sources = activeOrderSources(connectionsQuery.data, connection.id);
  const rulesBySource = useRoutingRulesForConnections(sources.map((s) => s.id));
  // An unassigned account is a state worth saying outright; until every
  // source's rules have loaded, a missing entry must not read as "unused".
  const unused =
    sources.length > 0 &&
    sources.every((s) => rulesBySource.has(s.id)) &&
    sources.every((s) => rulesRoutedTo(rulesBySource.get(s.id), connection.id).length === 0);

  return (
    <section className="panel panel--dense" aria-labelledby="carrier-ships-for-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.shipsForEyebrow}</p>
          <h3 className="section-title" id="carrier-ships-for-title">
            {copy.shipsForTitle}
          </h3>
        </div>
      </div>
      <p className="muted-text">{copy.shipsForIntro(connection.name)}</p>
      {unused ? (
        <Alert tone="info" title={copy.shipsForUnusedTitle(connection.name)}>
          {copy.shipsForUnusedBody}
        </Alert>
      ) : null}
      {connectionsQuery.isLoading ? (
        <p className="muted-text">{copy.rowLoading}</p>
      ) : sources.length === 0 ? (
        <p className="muted-text">{copy.shipsForNoSources}</p>
      ) : (
        <ul className="ships-for">
          {sources.map((source) => (
            <CarrierSourceRow key={source.id} source={source} carrier={connection} />
          ))}
        </ul>
      )}
    </section>
  );
}

export interface CarrierCreatedNoticeProps {
  readonly connection: Connection;
}

/**
 * The success landing after a carrier wizard. The action links to the
 * routing tab of the first active source that routes nothing to this carrier yet,
 * because that is the one the operator still has to decide about; with no such
 * source there is nothing left to choose, so the notice carries no action.
 */
export function CarrierCreatedNotice({ connection }: CarrierCreatedNoticeProps): ReactElement {
  const copy = useConnectionShippingCopy();
  const connectionsQuery = useConnectionsQuery();
  const sources = activeOrderSources(connectionsQuery.data, connection.id);
  const rulesBySource = useRoutingRulesForConnections(sources.map((s) => s.id));

  // Until every source's rules have loaded, a missing entry would read as "no
  // route yet" and point the action at the wrong source, so it waits.
  const rulesLoaded = sources.every((s) => rulesBySource.has(s.id));
  const target = rulesLoaded
    ? sources.find((s) => rulesRoutedTo(rulesBySource.get(s.id), connection.id).length === 0)
    : undefined;

  return (
    <Alert
        tone="success"
        title={copy.createdTitle(connection.name)}
        action={
          target ? (
            <Link className="button button--secondary button--sm" to={channelAssignmentPath(target.id)}>
              {copy.createdAction}
            </Link>
          ) : undefined
        }
      >
        {copy.createdBody(connection.name)}
      </Alert>
  );
}

export interface CarrierMappingsNoticeProps {
  readonly connection: Connection;
}

/**
 * What the Mappings page says for a carrier account (#4137). A carrier is not
 * paired to a marketplace, so the pairing resolver reports no source; saying
 * "no marketplace is paired" there reads as a fault. The truth is that its
 * assignment lives on each sales channel, so this points there.
 */
export function CarrierMappingsNotice({ connection }: CarrierMappingsNoticeProps): ReactElement {
  const copy = useConnectionShippingCopy();
  const connectionsQuery = useConnectionsQuery();
  const sources = activeOrderSources(connectionsQuery.data, connection.id);

  return (
    <EmptyState
      title={copy.carrierMappingsTitle(connection.name)}
      message={sources.length === 0 ? copy.carrierMappingsNoChannels : copy.carrierMappingsMessage}
      action={
        sources.length > 0 ? (
          <div className="ships-for__methods">
            {sources.map((source) => (
              <Link
                key={source.id}
                className="button button--secondary"
                to={channelAssignmentPath(source.id)}
              >
                {copy.carrierMappingsOpenChannel(source.name)}
              </Link>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}
