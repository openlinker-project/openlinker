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
import { KeyValueList } from '../../../shared/ui/key-value-list';
import type { Connection } from '../api/connections.types';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import { CONNECTION_SHIPPING_COPY } from '../lib/connection-shipping.copy';
import {
  DELIVERY_METHOD_OPTION_KEYS,
  activeOrderSources,
  deliveryMethodLabel,
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
  const rulesQuery = useRoutingRulesQuery(source.id);
  const { options } = useMappingOptions(source.id, DELIVERY_METHOD_OPTION_KEYS);
  const routed = rulesRoutedTo(rulesQuery.data, carrier.id);
  const labels = routed.map((r) =>
    deliveryMethodLabel(options.allegroDeliveryMethods, r.sourceDeliveryMethodId)
  );

  let text: string;
  if (rulesQuery.isLoading) {
    text = CONNECTION_SHIPPING_COPY.rowLoading;
  } else if (rulesQuery.error) {
    text = CONNECTION_SHIPPING_COPY.rowUnavailable;
  } else if (labels.length > 0) {
    text = labels.join(', ');
  } else {
    text = CONNECTION_SHIPPING_COPY.shipsForEmpty(carrier.name);
  }

  return (
    <div className="button-group" data-testid={`ships-for-row-${source.id}`}>
      <span className={labels.length > 0 ? undefined : 'muted-text'}>{text}</span>
      {canChange ? (
        <Button tone="secondary" className="button--sm" onClick={() => onOpen(source)}>
          {labels.length > 0
            ? CONNECTION_SHIPPING_COPY.rowChange
            : CONNECTION_SHIPPING_COPY.rowChoose}
        </Button>
      ) : null}
    </div>
  );
}

export interface CarrierShipsForCardProps {
  /** The carrier connection whose page this is. */
  readonly connection: Connection;
}

export function CarrierShipsForCard({ connection }: CarrierShipsForCardProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const sources = activeOrderSources(connectionsQuery.data, connection.id);
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const [dialogSource, setDialogSource] = useState<Connection | null>(null);

  return (
    <section className="panel panel--dense" aria-labelledby="carrier-ships-for-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{CONNECTION_SHIPPING_COPY.shipsForEyebrow}</p>
          <h3 className="section-title" id="carrier-ships-for-title">
            {CONNECTION_SHIPPING_COPY.shipsForTitle}
          </h3>
        </div>
      </div>
      <p className="muted-text">{CONNECTION_SHIPPING_COPY.shipsForIntro(connection.name)}</p>
      {connectionsQuery.isLoading ? (
        <p className="muted-text">{CONNECTION_SHIPPING_COPY.rowLoading}</p>
      ) : sources.length === 0 ? (
        <p className="muted-text">{CONNECTION_SHIPPING_COPY.shipsForNoSources}</p>
      ) : (
        <KeyValueList
          items={sources.map((source) => ({
            id: source.id,
            label: source.name,
            value: (
              <CarrierSourceRow
                source={source}
                carrier={connection}
                canChange={write.visible}
                onOpen={setDialogSource}
              />
            ),
          }))}
        />
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
        title={CONNECTION_SHIPPING_COPY.createdTitle(connection.name)}
        action={
          target && write.visible ? (
            <Button tone="secondary" className="button--sm" onClick={() => setDialogSource(target)}>
              {CONNECTION_SHIPPING_COPY.createdAction}
            </Button>
          ) : undefined
        }
      >
        {CONNECTION_SHIPPING_COPY.createdBody(connection.name)}
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
