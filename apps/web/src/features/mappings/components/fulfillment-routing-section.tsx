/**
 * Fulfilment routing section (#3958)
 *
 * The connection mappings page's fulfilment tab, made self-contained: given an
 * order-source connection it loads that source's delivery methods and its
 * display name, then renders `RoutingRulesPanel`. The mappings page and the OMS
 * setup's Shipping step both render THIS component, so routing is edited in one
 * place and the two can never show different rules or different options.
 *
 * Same shape as `SalesDocumentsPanel` (#3668): the host owns the surrounding
 * heading, this owns its data, its save and its loading / error states, and
 * reports only whether it holds unsaved changes.
 *
 * @module apps/web/src/features/mappings/components
 */
import type { ReactElement } from 'react';

import { useConnectionsQuery } from '../../connections';
import { usePlatforms } from '../../../shared/plugins';
import type { MappingOptions } from '../api/mappings.types';
import { useMappingOptions } from '../hooks/use-mapping-options';
import { resolvePlatformLabel } from '../lib/platform-label';
import { RoutingRulesPanel } from './routing-rules-panel';

// Module-level so the set is referentially stable: the options hook keys its
// queries off it, and routing needs the source's delivery methods only.
const FULFILLMENT_OPTION_KEYS: ReadonlySet<keyof MappingOptions> = new Set(['allegroDeliveryMethods']);

export interface FulfillmentRoutingSectionProps {
  /** The order-source connection whose delivery methods are routed (never the master shop). */
  readonly sourceConnectionId: string;
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** See `RoutingRulesPanel.embedded`. */
  readonly embedded?: boolean;
  /** See `RoutingRulesPanel.focusMethodId`. */
  readonly focusMethodId?: string;
}

export function FulfillmentRoutingSection({
  sourceConnectionId,
  onDirtyChange,
  embedded,
  focusMethodId,
}: FulfillmentRoutingSectionProps): ReactElement {
  const platforms = usePlatforms();
  const connections = useConnectionsQuery();
  const source = connections.data?.find((c) => c.id === sourceConnectionId);
  const sourceLabel = source ? resolvePlatformLabel(platforms, source) : 'the marketplace';

  const {
    options,
    isLoading,
    errors,
  } = useMappingOptions(sourceConnectionId, FULFILLMENT_OPTION_KEYS);

  return (
    <RoutingRulesPanel
      connectionId={sourceConnectionId}
      sourceLabel={sourceLabel}
      deliveryMethods={options.allegroDeliveryMethods}
      deliveryMethodsLoading={isLoading}
      deliveryMethodsError={errors.allegroDeliveryMethods ?? null}
      onDirtyChange={onDirtyChange}
      embedded={embedded}
      focusMethodId={focusMethodId}
    />
  );
}
