/**
 * Order-source connection: "Shipping" card (#3958)
 *
 * Says, for one sales channel, how many of its delivery methods get a label
 * bought by OpenLinker and how many the shop still ships, with the same split
 * bar the routing editor shows and a button that opens that editor in place.
 * The page previously offered only a generic "Mappings" button, so a channel
 * whose every delivery method silently fell back to the shop looked fine.
 *
 * Counts come from the SAVED rules, not from a draft: this card is a summary
 * of what happens to the next order, and the editor is where drafts live.
 *
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';

import {
  RoutingDialog,
  RoutingSplitBar,
  resolvePlatformLabel,
  routeBuysLabel,
  useMappingOptions,
  useRoutingRulesQuery,
  type MappingOption,
  type RoutingRule,
  type RoutingSplitBucket,
  type ShippingRouteCopy,
  useShippingRouteCopy,
} from '../../mappings';
import { useDemoMode } from '../../system';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { usePlatforms } from '../../../shared/plugins';
import { Button } from '../../../shared/ui/button';
import type { Connection } from '../api/connections.types';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import { useConnectionShippingCopy } from '../hooks/use-connection-shipping-copy';
import { DELIVERY_METHOD_OPTION_KEYS } from './connection-shipping-routes';

const DEFAULT_BUCKET_KEY = '__default__';

interface ShippingSplit {
  readonly buckets: RoutingSplitBucket[];
  readonly labelled: number;
}

/**
 * One bucket per processor a method is routed to, plus the shop's default
 * bucket last, mirroring how the routing editor orders its own bar. A rule for
 * a method the source no longer lists is ignored: it routes no order.
 */
function buildShippingSplit(
  methods: readonly MappingOption[],
  rules: readonly RoutingRule[],
  nameById: ReadonlyMap<string, string>,
  sourceLabel: string,
  routeCopy: ShippingRouteCopy
): ShippingSplit {
  const ruleByMethod = new Map(rules.map((r) => [r.sourceDeliveryMethodId, r]));
  const buckets = new Map<string, RoutingSplitBucket>();
  let labelled = 0;
  let defaults = 0;

  for (const method of methods) {
    const rule = ruleByMethod.get(method.value);
    if (!rule || rule.processorKind === 'omp_fulfilled') {
      defaults += 1;
      continue;
    }
    if (routeBuysLabel(rule.processorKind)) labelled += 1;
    const key = `${rule.processorKind}::${rule.processorConnectionId}`;
    // Brokered shipping is the source's own service, so it carries the
    // marketplace's name, the same as in the routing editor.
    const label =
      rule.processorKind === 'source_brokered'
        ? routeCopy.sourceShipping(sourceLabel)
        : nameById.get(rule.processorConnectionId) ?? rule.processorConnectionId;
    const existing = buckets.get(key);
    buckets.set(key, { key, label, count: (existing?.count ?? 0) + 1 });
  }

  return {
    buckets: [
      ...buckets.values(),
      {
        key: DEFAULT_BUCKET_KEY,
        label: routeCopy.defaultOption(null),
        count: defaults,
        isDefault: true,
      },
    ],
    labelled,
  };
}

export interface OrderSourceShippingCardProps {
  /** The order-source connection whose page this is. */
  readonly connection: Connection;
}

export function OrderSourceShippingCard({
  connection,
}: OrderSourceShippingCardProps): ReactElement {
  const copy = useConnectionShippingCopy();
  const routeCopy = useShippingRouteCopy();
  const platforms = usePlatforms();
  const connectionsQuery = useConnectionsQuery();
  const rulesQuery = useRoutingRulesQuery(connection.id);
  const { options, isLoading, errors } = useMappingOptions(
    connection.id,
    DELIVERY_METHOD_OPTION_KEYS
  );
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const [open, setOpen] = useState(false);

  const methods = options.allegroDeliveryMethods;

  // A source that cannot list delivery methods has nothing to route, so the
  // card would only show an empty bar; one line says why instead.
  if (errors.allegroDeliveryMethods) {
    return <p className="muted-text">{copy.shippingUnlisted}</p>;
  }

  const nameById = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c.name]));
  const sourceLabel = resolvePlatformLabel(platforms, connection);

  let body: ReactElement;
  if (isLoading || rulesQuery.isLoading) {
    body = <p className="muted-text">{copy.shippingLoading}</p>;
  } else if (rulesQuery.error) {
    body = <p className="muted-text">{copy.rowUnavailable}</p>;
  } else if (methods.length === 0) {
    body = <p className="muted-text">{copy.shippingNoMethods}</p>;
  } else {
    const split = buildShippingSplit(methods, rulesQuery.data ?? [], nameById, sourceLabel, routeCopy);
    const rest = methods.length - split.labelled;
    body = (
      <>
        <p className="source-shipping__coverage">
          {copy.shippingCoverage(split.labelled, methods.length, (chunk) => (
            <strong>{chunk}</strong>
          ))}
        </p>
        <RoutingSplitBar buckets={split.buckets} />
        <p className="muted-text">
          {rest > 0
            ? copy.shippingRestByShop(rest)
            : copy.shippingAllLabelled}
        </p>
      </>
    );
  }

  return (
    <section className="panel panel--dense" aria-labelledby="order-source-shipping-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.shippingEyebrow}</p>
          <h3 className="section-title" id="order-source-shipping-title">
            {copy.shippingTitle}
          </h3>
        </div>
        {/* The one action sits with the title, where the other connection cards keep theirs. */}
        {write.visible && methods.length > 0 ? (
          <Button tone="secondary" className="button--sm" onClick={() => setOpen(true)}>
            {copy.shippingChange}
          </Button>
        ) : null}
      </div>
      <div className="source-shipping">{body}</div>
      <RoutingDialog
        open={open}
        onOpenChange={setOpen}
        sourceConnectionId={connection.id}
        sourceName={connection.name}
      />
    </section>
  );
}
