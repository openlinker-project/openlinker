/**
 * Connection Mappings Page
 *
 * Tabbed editor for the order mappings between a marketplace source and its
 * paired shop destination (order statuses, carriers, payments, fulfillment
 * routing, and the outbound order-state override). The source/destination
 * pair is resolved from the connection's config-stamped pairing via
 * `useMappingPairing` and shown as a route strip under the title; all copy
 * uses the resolved platform labels rather than hardcoded platform names.
 *
 * @module apps/web/src/pages/connections
 */

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { Alert } from '../../shared/ui/alert';
import { MappingPanel, type MappingRow } from '../../features/mappings/components/MappingPanel';
import { RoutingRulesPanel } from '../../features/mappings/components/routing-rules-panel';
import { MappingPairingBar } from '../../features/mappings/components/mapping-pairing-bar';
import { useMappingPairing } from '../../features/mappings/hooks/use-mapping-pairing';
import { useStatusMappingsQuery, useUpsertStatusMappings } from '../../features/mappings/hooks/use-status-mappings';
import { useCarrierMappingsQuery, useUpsertCarrierMappings } from '../../features/mappings/hooks/use-carrier-mappings';
import { usePaymentMappingsQuery, useUpsertPaymentMappings } from '../../features/mappings/hooks/use-payment-mappings';
import {
  useOrderStateMappingsQuery,
  useUpsertOrderStateMappings,
} from '../../features/mappings/hooks/use-order-state-mappings';
import { useRoutingRulesQuery } from '../../features/mappings/hooks/use-routing-rules';
import { useMappingOptions } from '../../features/mappings/hooks/use-mapping-options';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { usePlatforms } from '../../shared/plugins';
import type { Connection } from '../../features/connections';
import {
  OL_ORDER_STATUS_OPTIONS,
  type MappingOption,
  type MappingOptions,
} from '../../features/mappings/api/mappings.types';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';

type TabId = 'fulfillment' | 'status' | 'carriers' | 'payments' | 'order-states';

const ALL_TABS: TabId[] = ['fulfillment', 'status', 'carriers', 'payments', 'order-states'];

/**
 * Which option-bundle keys each tab consumes (#1784 follow-up: lazy-load per
 * tab). Used to fetch only the option lists the visited tabs actually need,
 * instead of the whole 6-list bundle on page load. Order-states' source axis
 * is the static `OL_ORDER_STATUS_OPTIONS`, so it only needs the destination
 * status list.
 */
const OPTION_KEYS_BY_TAB: Record<TabId, (keyof MappingOptions)[]> = {
  fulfillment: ['allegroDeliveryMethods'],
  status: ['allegroOrderStatuses', 'prestashopOrderStatuses'],
  carriers: ['allegroDeliveryMethods', 'prestashopCarriers'],
  payments: ['allegroPaymentProviders', 'prestashopPaymentModules'],
  'order-states': ['prestashopOrderStatuses'],
};

interface FallbackBannerSpec {
  tone: 'info' | 'warning';
  message: ReactNode;
}

/**
 * Resolves the user-facing copy for the carrier-fallback banner (#517).
 * Returns null when the banner should not render (loading, errored,
 * nothing unmapped, or when we genuinely don't have enough info to
 * decide). Banner only fires on the carriers tab.
 *
 * `unmappedCount` is routing-aware (#836): methods diverted to a non-OMP
 * processor (Allegro Delivery, OL-managed carrier) never flow through PS
 * carrier mapping, so the caller excludes them before counting - the
 * banner only warns about methods that genuinely still need a PS carrier.
 *
 * `sourceLabel` is the resolved source-platform label (#1784) used in the
 * OpenLinker-Dynamic copy, instead of a hardcoded platform name.
 *
 * Decision tree mirrors the BE adapter's resolution chain (#516):
 *   (1) `defaultCarrierId` set        -> "using fallback: {name}"   info
 *   (2) OL Dynamic carrier installed   -> "using OpenLinker Dynamic" info
 *   (3) neither                        -> "sync will fail ..."       warning
 */
function deriveCarrierFallbackBanner(args: {
  unmappedCount: number;
  defaultCarrierId: string | null;
  carriers: MappingOption[];
  sourceLabel: string;
}): FallbackBannerSpec | null {
  const { unmappedCount, defaultCarrierId, carriers, sourceLabel } = args;
  if (unmappedCount <= 0) return null;

  const count = (
    <span className="alert__count">{unmappedCount}</span>
  );
  const noun = unmappedCount === 1 ? 'method' : 'methods';

  // Case 1 - explicit fallback configured. Resolve the carrier name from
  // the loaded options. If the saved id no longer exists in the live
  // options (operator deleted the carrier in BO), fall through to the
  // "no fallback" warning so the operator notices.
  if (defaultCarrierId) {
    const fallback = carriers.find((c) => c.value === defaultCarrierId);
    if (fallback) {
      return {
        tone: 'info',
        message: (
          <>
            {count} {noun} unmapped - using fallback: {fallback.label}.
          </>
        ),
      };
    }
  }

  // Case 2 - OL Dynamic is installed and runtime will fall back to it.
  const hasDynamic = carriers.some((c) => c.kind === 'dynamic');
  if (hasDynamic) {
    return {
      tone: 'info',
      message: (
        <>
          {count} {noun} unmapped - using OpenLinker Dynamic (exact {sourceLabel} cost) at sync time.
        </>
      ),
    };
  }

  // Case 3 - no fallback at all. Operator-actionable warning.
  return {
    tone: 'warning',
    message: (
      <>
        {count} {noun} unmapped - sync will fail until a mapping or fallback
        is configured.
      </>
    ),
  };
}

export function ConnectionMappingsPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const navigate = useNavigate();
  const platforms = usePlatforms();

  // Resolve the config-stamped source -> destination pairing (#1784). Drives
  // both the route strip and every platform label on the page.
  const pairing = useMappingPairing(connectionId);

  // Connection config carries `defaultCarrierId` which the carrier
  // fallback-banner copy depends on (#517). Errors are tolerated - if we
  // can't load the connection we just suppress the banner; the BE still
  // does the right thing at sync time per #516.
  const connectionQuery = useConnectionQuery(connectionId);

  // The Fulfillment tab + routing rules apply only to connections that ingest
  // orders (the routing key is a *source* delivery method). Capability-gated,
  // not platformType-gated, so any future OrderSource adapter inherits it.
  const supportsOrderSource =
    connectionQuery.data?.supportedCapabilities.includes('OrderSource') ?? false;

  // The Order-States tab is the OUTBOUND OL->destination override (#862) - it
  // belongs to a destination (OrderProcessorManager) connection's own state
  // catalogue, so it's capability-gated to those connections (PrestaShop today),
  // mirroring how Fulfillment is gated to OrderSource. Capability-based, never
  // platformType-based.
  const supportsOrderProcessor =
    connectionQuery.data?.supportedCapabilities.includes('OrderProcessorManager') ?? false;

  // Lazy-load per tab (#1784 follow-up): only the tab that is open on load
  // (`defaultTab`) plus tabs the operator has visited fetch their data, instead
  // of firing every mapping query + the full options bundle at page mount.
  // `supportsOrderSource`/`defaultTab` are only meaningful once the connection
  // has loaded; until then they read as their provisional (false / 'status')
  // values. Gating tab-activeness on `connectionReady` prevents the transient
  // default from firing the wrong tab's queries during the connection load
  // window (#1784 follow-up).
  const connectionReady = connectionQuery.data !== undefined;
  const defaultTab: TabId = supportsOrderSource ? 'fulfillment' : 'status';
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TabId>>(new Set());
  const isTabActive = (tab: TabId): boolean =>
    connectionReady && (tab === defaultTab || visitedTabs.has(tab));
  function markVisited(tab: string): void {
    setVisitedTabs((prev) =>
      prev.has(tab as TabId) ? prev : new Set(prev).add(tab as TabId),
    );
  }

  const statusQuery = useStatusMappingsQuery(connectionId, { enabled: isTabActive('status') });
  const carrierQuery = useCarrierMappingsQuery(connectionId, { enabled: isTabActive('carriers') });
  const paymentQuery = usePaymentMappingsQuery(connectionId, { enabled: isTabActive('payments') });
  const orderStateQuery = useOrderStateMappingsQuery(connectionId, {
    enabled: isTabActive('order-states'),
  });

  // Fetch only the option lists the visited tabs need (#1784 follow-up).
  const enabledOptionKeys = useMemo<ReadonlySet<keyof MappingOptions>>(() => {
    const keys = new Set<keyof MappingOptions>();
    if (!connectionReady) return keys;
    for (const tab of ALL_TABS) {
      if (tab === defaultTab || visitedTabs.has(tab)) {
        OPTION_KEYS_BY_TAB[tab].forEach((key) => keys.add(key));
      }
    }
    return keys;
  }, [connectionReady, defaultTab, visitedTabs]);
  const {
    options,
    isLoading: optionsLoading,
    errors: optionsErrors,
  } = useMappingOptions(connectionId, enabledOptionKeys);

  // Routing rules feed two things: the Fulfillment tab and the routing-aware
  // carrier-banner count (#836). Gated to OrderSource connections and to the
  // tabs that actually read them; deduped with the panel's own subscription.
  const routingRulesQuery = useRoutingRulesQuery(connectionId, {
    enabled: supportsOrderSource && (isTabActive('fulfillment') || isTabActive('carriers')),
  });

  const upsertStatus = useUpsertStatusMappings(connectionId);
  const upsertCarrier = useUpsertCarrierMappings(connectionId);
  const upsertPayment = useUpsertPaymentMappings(connectionId);
  const upsertOrderState = useUpsertOrderStateMappings(connectionId);

  const labelOf = (connection: Connection): string =>
    platforms.find((p) => p.platformType === connection.platformType)?.displayName ??
    connection.platformType;

  // Resolved platform labels for all page copy (#1784). Neutral fallbacks keep
  // the labels sensible while the pair is not `ready`.
  const sourceLabel = pairing.status === 'ready' ? labelOf(pairing.source) : 'the marketplace';
  const destinationLabel =
    pairing.status === 'ready' ? labelOf(pairing.destination) : 'the connected shop';

  const backTo = { to: `/connections/${connectionId}`, label: 'Connection' } as const;

  // ── Pairing-driven states (evaluated after all hooks) ───────────────────

  if (pairing.status === 'loading') {
    return (
      <PageLayout eyebrow="Connection" title="Mapping Configuration" description="Loading mapping configuration…">
        <LoadingState liveRegion="off" title="Loading mappings" message="Fetching configured mappings for this connection." />
      </PageLayout>
    );
  }

  if (pairing.status === 'error') {
    return (
      <PageLayout backTo={backTo} eyebrow="Connection" title="Mapping Configuration" description="Unable to load mapping configuration.">
        <ErrorState title="Unable to load mappings" message={pairing.error.message} />
      </PageLayout>
    );
  }

  if (pairing.status === 'unsupported') {
    const unsupportedLabel = labelOf(pairing.source);
    return (
      <PageLayout
        backTo={backTo}
        eyebrow="Connection"
        title="Mapping Configuration"
        description={`${unsupportedLabel} order mapping isn't supported yet.`}
      >
        <MappingPairingBar pairing={pairing} onPickSource={() => undefined} />
        <EmptyState
          title={`Mapping isn't available for ${unsupportedLabel} connections yet`}
          message="Order mapping is available for Allegro to PrestaShop and Erli to PrestaShop today. Support for more platforms is planned."
        />
      </PageLayout>
    );
  }

  if (pairing.status === 'no-source') {
    return (
      <PageLayout
        backTo={backTo}
        eyebrow="Connection"
        title="Mapping Configuration"
        description={`No marketplace is paired with ${pairing.master.name} yet.`}
      >
        <MappingPairingBar pairing={pairing} onPickSource={() => undefined} />
        <EmptyState
          title="No marketplace is paired with this shop"
          message="Order mappings are configured from the marketplace side. Open a marketplace connection (Allegro or Erli) and set its catalog to this shop to pair them."
          action={
            <Link className="button button--secondary" to="/connections">
              Go to connections
            </Link>
          }
        />
      </PageLayout>
    );
  }

  if (pairing.status === 'pick-source') {
    return (
      <PageLayout
        backTo={backTo}
        eyebrow="Connection"
        title="Mapping Configuration"
        description={`Choose a marketplace to configure ${pairing.master.name} mappings.`}
      >
        <MappingPairingBar
          pairing={pairing}
          onPickSource={(sourceConnectionId) => {
            void navigate(`/connections/${sourceConnectionId}/mappings`);
          }}
        />
        <EmptyState
          title="Choose which marketplace to configure"
          message={`Order mappings belong to a marketplace. Choose which of the ${pairing.candidates.length} paired marketplaces you want to configure against ${pairing.master.name}.`}
        />
      </PageLayout>
    );
  }

  // ── Ready: the pair is resolved and supported. Load the mapping data. ────

  // The pairing gate already waited on the connection, so nothing blocks the
  // page shell here anymore. Per-tab mapping data loads lazily (#1784 follow-up)
  // and each panel renders its own loading/error state, so mapping queries are
  // intentionally NOT part of a full-page gate. loadError still surfaces a hard
  // failure of a tab the operator is actually on (enabled queries only).
  const isLoading = connectionQuery.isLoading;
  const loadError =
    statusQuery.error ?? carrierQuery.error ?? paymentQuery.error ?? orderStateQuery.error ?? null;

  if (isLoading) {
    return (
      <PageLayout backTo={backTo} eyebrow="Connection" title="Mapping Configuration" description="Loading mapping configuration…">
        <LoadingState liveRegion="off" title="Loading mappings" message="Fetching configured mappings for this connection." />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout backTo={backTo} eyebrow="Connection" title="Mapping Configuration" description="Unable to load mapping configuration.">
        <ErrorState title="Unable to load mappings" message={loadError.message} />
      </PageLayout>
    );
  }

  const tabs: { id: TabId; label: string }[] = [
    ...(supportsOrderSource ? [{ id: 'fulfillment' as const, label: 'Fulfillment' }] : []),
    { id: 'status' as const, label: 'Order Statuses' },
    { id: 'carriers' as const, label: 'Carriers' },
    { id: 'payments' as const, label: 'Payments' },
    ...(supportsOrderProcessor ? [{ id: 'order-states' as const, label: 'Order States' }] : []),
  ];

  // Per-panel error isolation (#484): a failure in one bundle key must not
  // block the other tabs. Each panel only watches the two keys it actually
  // reads from.
  const statusOptionsError =
    optionsErrors.allegroOrderStatuses ?? optionsErrors.prestashopOrderStatuses ?? null;
  const carrierOptionsError =
    optionsErrors.allegroDeliveryMethods ?? optionsErrors.prestashopCarriers ?? null;
  const paymentOptionsError =
    optionsErrors.allegroPaymentProviders ?? optionsErrors.prestashopPaymentModules ?? null;
  // Outbound OL->PS order-state panel (#862): only the destination dropdown
  // (prestashopOrderStatuses) loads from the bundle - the source axis is the
  // fixed OL OrderStatus list. So its options-readiness tracks only that key.
  const orderStateOptionsError = optionsErrors.prestashopOrderStatuses ?? null;

  const statusRows: MappingRow[] = (statusQuery.data ?? []).map((m) => ({
    sourceValue: m.allegroStatus,
    targetValue: m.prestashopStatusId,
  }));

  const carrierRows: MappingRow[] = (carrierQuery.data ?? []).map((m) => ({
    sourceValue: m.allegroDeliveryMethodId,
    targetValue: m.prestashopCarrierId,
  }));

  // Carrier-fallback banner (#517) - single banner above the carrier panel
  // summarising the BE runtime fallback chain (#516). Routing-aware unmapped
  // count (#836): a method is "unmapped" only if it has neither a PS carrier
  // mapping NOR a routing rule diverting it to a non-PS processor.
  const divertedMethodIds = new Set(
    (routingRulesQuery.data ?? []).map((r) => r.sourceDeliveryMethodId),
  );
  const carrierMappedIds = new Set(carrierRows.map((r) => r.sourceValue));
  const unmappedDeliveryCount = options.allegroDeliveryMethods.filter(
    (m) => !carrierMappedIds.has(m.value) && !divertedMethodIds.has(m.value),
  ).length;

  const carriersReady =
    !optionsLoading &&
    carrierOptionsError === null &&
    connectionQuery.data !== undefined &&
    !routingRulesQuery.isLoading &&
    routingRulesQuery.error === null;
  const connectionConfig = connectionQuery.data?.config as
    | { defaultCarrierId?: unknown }
    | undefined;
  const carrierFallbackBanner = carriersReady
    ? deriveCarrierFallbackBanner({
        unmappedCount: unmappedDeliveryCount,
        defaultCarrierId:
          connectionConfig?.defaultCarrierId !== undefined &&
          connectionConfig.defaultCarrierId !== null
            ? String(connectionConfig.defaultCarrierId)
            : null,
        carriers: options.prestashopCarriers,
        sourceLabel,
      })
    : null;

  const paymentRows: MappingRow[] = (paymentQuery.data ?? []).map((m) => ({
    sourceValue: m.allegroPaymentProvider,
    targetValue: m.prestashopPaymentModule,
  }));

  const orderStateRows: MappingRow[] = (orderStateQuery.data ?? []).map((m) => ({
    sourceValue: m.olStatus,
    targetValue: m.externalStateId,
  }));

  function handleSaveStatus(rows: MappingRow[]): void {
    upsertStatus.mutate({
      items: rows.map((r) => ({ allegroStatus: r.sourceValue, prestashopStatusId: r.targetValue })),
    });
  }

  function handleSaveCarriers(rows: MappingRow[]): void {
    upsertCarrier.mutate({
      items: rows.map((r) => ({ allegroDeliveryMethodId: r.sourceValue, prestashopCarrierId: r.targetValue })),
    });
  }

  function handleSavePayments(rows: MappingRow[]): void {
    upsertPayment.mutate({
      items: rows.map((r) => ({ allegroPaymentProvider: r.sourceValue, prestashopPaymentModule: r.targetValue })),
    });
  }

  function handleSaveOrderStates(rows: MappingRow[]): void {
    upsertOrderState.mutate({
      items: rows.map((r) => ({ olStatus: r.sourceValue, externalStateId: r.targetValue })),
    });
  }

  return (
    <PageLayout
      backTo={backTo}
      eyebrow="Connection"
      title="Mapping Configuration"
      description={`Configure ${sourceLabel} → ${destinationLabel} mappings for order statuses, delivery carriers, and payment methods.`}
    >
      <MappingPairingBar pairing={pairing} onPickSource={() => undefined} />

      <Tabs defaultValue={defaultTab} onValueChange={markVisited} aria-label="Mapping types">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {supportsOrderSource && (
          <TabsContent value="fulfillment">
            <RoutingRulesPanel
              connectionId={connectionId}
              sourceLabel={sourceLabel}
              deliveryMethods={options.allegroDeliveryMethods}
              deliveryMethodsLoading={optionsLoading}
              deliveryMethodsError={optionsErrors.allegroDeliveryMethods ?? null}
            />
          </TabsContent>
        )}

        <TabsContent value="status">
          <MappingPanel
            title="Order Status Mappings"
            description={`Map ${sourceLabel} order statuses to the corresponding ${destinationLabel} order status IDs.`}
            sourceLabel={`${sourceLabel} status`}
            targetLabel={`${destinationLabel} status`}
            sourceOptions={options.allegroOrderStatuses}
            targetOptions={options.prestashopOrderStatuses}
            savedRows={statusRows}
            onSave={handleSaveStatus}
            isSaving={upsertStatus.isPending}
            saveError={upsertStatus.error}
            optionsLoading={optionsLoading}
            optionsError={statusOptionsError}
          />
        </TabsContent>

        <TabsContent value="carriers">
          {carrierFallbackBanner ? (
            <Alert
              tone={carrierFallbackBanner.tone}
              className="mapping-panel__fallback-alert"
            >
              {carrierFallbackBanner.message}
            </Alert>
          ) : null}
          <MappingPanel
            title="Carrier Mappings"
            description={`Map ${sourceLabel} delivery method IDs to the corresponding ${destinationLabel} carrier IDs.`}
            sourceLabel={`${sourceLabel} delivery method`}
            targetLabel={`${destinationLabel} carrier`}
            sourceOptions={options.allegroDeliveryMethods}
            targetOptions={options.prestashopCarriers}
            savedRows={carrierRows}
            onSave={handleSaveCarriers}
            isSaving={upsertCarrier.isPending}
            saveError={upsertCarrier.error}
            optionsLoading={optionsLoading}
            optionsError={carrierOptionsError}
            dynamicOptionSuffix={` - exact ${sourceLabel} cost`}
          />
        </TabsContent>

        <TabsContent value="payments">
          <MappingPanel
            title="Payment Mappings"
            description={`Map ${sourceLabel} payment provider names to the corresponding ${destinationLabel} payment module names.`}
            sourceLabel={`${sourceLabel} payment provider`}
            targetLabel={`${destinationLabel} payment module`}
            sourceOptions={options.allegroPaymentProviders}
            targetOptions={options.prestashopPaymentModules}
            savedRows={paymentRows}
            onSave={handleSavePayments}
            isSaving={upsertPayment.isPending}
            saveError={upsertPayment.error}
            optionsLoading={optionsLoading}
            optionsError={paymentOptionsError}
          />
        </TabsContent>

        {supportsOrderProcessor && (
          <TabsContent value="order-states">
            <MappingPanel
              title="Order-State Mappings"
              description={`Override which ${destinationLabel} order state each OpenLinker status transitions to. Customised shops (renamed or added states) map here; unmapped statuses use the default-install state.`}
              sourceLabel="OpenLinker status"
              targetLabel={`${destinationLabel} order state`}
              sourceOptions={OL_ORDER_STATUS_OPTIONS}
              targetOptions={options.prestashopOrderStatuses}
              savedRows={orderStateRows}
              onSave={handleSaveOrderStates}
              isSaving={upsertOrderState.isPending}
              saveError={upsertOrderState.error}
              optionsLoading={optionsLoading}
              optionsError={orderStateOptionsError}
            />
          </TabsContent>
        )}
      </Tabs>
    </PageLayout>
  );
}
