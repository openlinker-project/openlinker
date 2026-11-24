/**
 * Carrier connection: "Ships for" card and the just-connected notice (#3958)
 *
 * A carrier (InPost, DPD) buys labels only for the delivery methods some order
 * source routes to it, and those routes are stored on the SOURCE. So a carrier
 * page could not say what it ships for. This card reads every active source's
 * rules (no new endpoint) and lists, per source, the delivery methods routed
 * here, each with a way to change it in the same routing editor the mappings
 * page uses.
 *
 * `CarrierCreatedNotice` is what a carrier wizard lands on: a new carrier
 * ships nothing until a route points at it, which is easy to miss, so the page
 * says so and opens the editor for the first source that does not use it yet.
 *
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';

import {
  RoutingDialog,
  useMappingOptions,
  useRoutingRulesForConnections,
  useRoutingRulesQuery,
} from '../../mappings';
import { useDemoMode } from '../../system';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import type { Connection } from '../api/connections.types';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import { useConnectionShippingCopy } from '../hooks/use-connection-shipping-copy';
import {
  DELIVERY_METHOD_OPTION_KEYS,
  activeOrderSources,
  rulesRoutedTo,
} from './connection-shipping-routes';

interface CarrierSourceRowProps {
  readonly source: Connection;
  readonly carrier: Connection;
  readonly canChange: boolean;
  readonly onOpen: (source: Connection) => void;
}

function CarrierSourceRow({
  source,
  carrier,
  canChange,
  onOpen,
}: CarrierSourceRowProps): ReactElement {
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
      {canChange ? (
        <Button tone="secondary" className="button--sm" onClick={() => onOpen(source)}>
          {routed.length > 0 ? copy.rowChange : copy.rowChoose}
        </Button>
      ) : null}
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
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const [dialogSource, setDialogSource] = useState<Connection | null>(null);

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
      {connectionsQuery.isLoading ? (
        <p className="muted-text">{copy.rowLoading}</p>
      ) : sources.length === 0 ? (
        <p className="muted-text">{copy.shipsForNoSources}</p>
      ) : (
        <ul className="ships-for">
          {sources.map((source) => (
            <CarrierSourceRow
              key={source.id}
              source={source}
              carrier={connection}
              canChange={write.visible}
              onOpen={setDialogSource}
            />
          ))}
        </ul>
      )}
      {dialogSource ? (
        <RoutingDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogSource(null);
          }}
          sourceConnectionId={dialogSource.id}
          sourceName={dialogSource.name}
        />
      ) : null}
    </section>
  );
}

export interface CarrierCreatedNoticeProps {
  readonly connection: Connection;
}

/**
 * The success landing after a carrier wizard. The action opens the routing
 * editor for the first active source that routes nothing to this carrier yet,
 * because that is the one the operator still has to decide about; with no such
 * source there is nothing left to choose, so the notice carries no action.
 */
export function CarrierCreatedNotice({ connection }: CarrierCreatedNoticeProps): ReactElement {
  const copy = useConnectionShippingCopy();
  const connectionsQuery = useConnectionsQuery();
  const sources = activeOrderSources(connectionsQuery.data, connection.id);
  const rulesBySource = useRoutingRulesForConnections(sources.map((s) => s.id));
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  // Pinned on open: saving a route can change which source is "first without
  // one", and the dialog must not switch sources under the operator.
  const [dialogSource, setDialogSource] = useState<Connection | null>(null);

  // Until every source's rules have loaded, a missing entry would read as "no
  // route yet" and point the action at the wrong source, so it waits.
  const rulesLoaded = sources.every((s) => rulesBySource.has(s.id));
  const target = rulesLoaded
    ? sources.find((s) => rulesRoutedTo(rulesBySource.get(s.id), connection.id).length === 0)
    : undefined;

  return (
    <>
      <Alert
        tone="success"
        title={copy.createdTitle(connection.name)}
        action={
          target && write.visible ? (
            <Button tone="secondary" className="button--sm" onClick={() => setDialogSource(target)}>
              {copy.createdAction}
            </Button>
          ) : undefined
        }
      >
        {copy.createdBody(connection.name)}
      </Alert>
      {dialogSource ? (
        <RoutingDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialogSource(null);
          }}
          sourceConnectionId={dialogSource.id}
          sourceName={dialogSource.name}
        />
      ) : null}
    </>
  );
}
