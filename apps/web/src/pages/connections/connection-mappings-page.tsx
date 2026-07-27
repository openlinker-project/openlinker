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
 * Mapping data is keyed per side (#1784 follow-up B1): status / carriers /
 * payments / fulfillment-routing are SOURCE-keyed; order-states are
 * DESTINATION-keyed. The page derives `sourceConnectionId` / `destConnectionId`
 * from the resolved pair so opening from either side converges on the same data
 * and never writes to a dead key.
 *
 * @module apps/web/src/pages/connections
 */

import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { MappingPanel, type MappingRow } from '../../features/mappings/components/MappingPanel';
import { RoutingRulesPanel } from '../../features/mappings/components/routing-rules-panel';
import {
  MappingPairingBar,
  MAPPING_SOURCE_PICKER_ID,
} from '../../features/mappings/components/mapping-pairing-bar';
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
import { resolvePlatformLabel } from '../../features/mappings/lib/platform-label';
import { usePlatforms } from '../../shared/plugins';
import {
  OL_ORDER_STATUS_OPTIONS,
  type MappingOption,
  type MappingOptions,
} from '../../features/mappings/api/mappings.types';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';

type TabId = 'fulfillment' | 'status' | 'carriers' | 'payments' | 'order-states';

const ALL_TABS: TabId[] = ['fulfillment', 'status', 'carriers', 'payments', 'order-states'];

function isTabId(value: string): value is TabId {
  return (ALL_TABS as string[]).includes(value);
}

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

/** Precise per-tab empty-state copy (#1784 follow-up S15). */
const EMPTY_STATE_MESSAGE_BY_TAB: Record<Exclude<TabId, 'fulfillment'>, string> = {
  status:
    'No mappings configured yet. Unmapped statuses fall back to the default status at sync time. Add one below.',
  carriers:
    'No mappings configured yet. An unmapped carrier can fail order sync unless a fallback carrier is set. Add one below.',
  payments:
    'No mappings configured yet. Unmapped payment methods fall back to the default payment module. Add one below.',
  'order-states':
    'No mappings configured yet. Unmapped statuses use the default-install order state. Add one below.',
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
  const isReady = pairing.status === 'ready';

  // Per-side connection ids (#1784 follow-up B1). Until the pair resolves they
  // fall back to the URL id, but every data query is gated on `isReady` so no
  // stray fetch lands on the wrong key in that window.
  const sourceConnectionId = isReady ? pairing.source.id : connectionId;
  const destConnectionId = isReady ? pairing.destination.id : connectionId;

  // Capability gating reads from the RESOLVED pair (#1784 follow-up B1): the
  // Fulfillment tab + routing rules gate on the SOURCE's OrderSource capability;
  // the Order-States tab gates on the DESTINATION's OrderProcessorManager. This
  // keeps the tab set stable regardless of which side the page was opened from.
  const supportsOrderSource = isReady
    ? pairing.source.supportedCapabilities.includes('OrderSource')
    : false;
  const supportsOrderProcessor = isReady
    ? pairing.destination.supportedCapabilities.includes('OrderProcessorManager')
    : false;

  // Lazy-load per tab (#1784 follow-up): only the tab open on load (`defaultTab`)
  // plus tabs the operator has visited fetch their data.
  const defaultTab: TabId = supportsOrderSource ? 'fulfillment' : 'status';
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TabId>>(new Set());
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [dirtyTabs, setDirtyTabs] = useState<ReadonlySet<TabId>>(new Set());
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const currentTab = activeTab ?? defaultTab;

  const isTabActive = (tab: TabId): boolean =>
    isReady && (tab === defaultTab || visitedTabs.has(tab));

  const statusQuery = useStatusMappingsQuery(sourceConnectionId, { enabled: isTabActive('status') });
  const carrierQuery = useCarrierMappingsQuery(sourceConnectionId, { enabled: isTabActive('carriers') });
  const paymentQuery = usePaymentMappingsQuery(sourceConnectionId, { enabled: isTabActive('payments') });
  const orderStateQuery = useOrderStateMappingsQuery(destConnectionId, {
    enabled: isTabActive('order-states'),
  });

  // Fetch only the option lists the visited tabs need (#1784 follow-up).
  const enabledOptionKeys = useMemo<ReadonlySet<keyof MappingOptions>>(() => {
    const keys = new Set<keyof MappingOptions>();
    if (!isReady) return keys;
    for (const tab of ALL_TABS) {
      if (tab === defaultTab || visitedTabs.has(tab)) {
        OPTION_KEYS_BY_TAB[tab].forEach((key) => keys.add(key));
      }
    }
    return keys;
  }, [isReady, defaultTab, visitedTabs]);
  const {
    options,
    isLoading: optionsLoading,
    errors: optionsErrors,
  } = useMappingOptions(
    { source: sourceConnectionId, destination: destConnectionId },
    enabledOptionKeys,
  );

  // Routing rules feed two things: the Fulfillment tab and the routing-aware
  // carrier-banner count (#836). Gated to OrderSource connections and to the
  // tabs that actually read them; deduped with the panel's own subscription.
  const routingRulesQuery = useRoutingRulesQuery(sourceConnectionId, {
    enabled: supportsOrderSource && (isTabActive('fulfillment') || isTabActive('carriers')),
  });

  const upsertStatus = useUpsertStatusMappings(sourceConnectionId);
  const upsertCarrier = useUpsertCarrierMappings(sourceConnectionId);
  const upsertPayment = useUpsertPaymentMappings(sourceConnectionId);
  const upsertOrderState = useUpsertOrderStateMappings(destConnectionId);

  // Stable per-tab dirty setters for the discard guard (#1784 follow-up I3).
  const dirtyHandlers = useMemo(() => {
    const make = (tab: TabId) => (dirty: boolean) => {
      setDirtyTabs((prev) => {
        if (dirty === prev.has(tab)) return prev;
        const next = new Set(prev);
        if (dirty) next.add(tab);
        else next.delete(tab);
        return next;
      });
    };
    return {
      fulfillment: make('fulfillment'),
      status: make('status'),
      carriers: make('carriers'),
      payments: make('payments'),
      'order-states': make('order-states'),
    } satisfies Record<TabId, (dirty: boolean) => void>;
  }, []);

  const commitTabChange = useCallback((tab: TabId) => {
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    setActiveTab(tab);
  }, []);

  const handleTabChange = useCallback(
    (next: string) => {
      if (!isTabId(next) || next === currentTab) return;
      if (dirtyTabs.has(currentTab)) {
        // Intercept: a dirty tab is being left. Confirm before discarding.
        setPendingTab(next);
        return;
      }
      commitTabChange(next);
    },
    [currentTab, dirtyTabs, commitTabChange],
  );

  const confirmDiscard = useCallback(() => {
    if (pendingTab === null) return;
    setDirtyTabs((prev) => {
      if (!prev.has(currentTab)) return prev;
      const nextSet = new Set(prev);
      nextSet.delete(currentTab);
      return nextSet;
    });
    commitTabChange(pendingTab);
    setPendingTab(null);
  }, [pendingTab, currentTab, commitTabChange]);

  const cancelDiscard = useCallback(() => setPendingTab(null), []);

  // Resolved platform labels for all page copy (#1784). Neutral fallbacks keep
  // the labels sensible while the pair is not `ready`.
  const sourceLabel = isReady ? resolvePlatformLabel(platforms, pairing.source) : 'the marketplace';
  const destinationLabel = isReady
    ? resolvePlatformLabel(platforms, pairing.destination)
    : 'the connected shop';

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
    const unsupportedLabel = resolvePlatformLabel(platforms, pairing.source);
    return (
      <PageLayout
        backTo={backTo}
        eyebrow="Connection"
        title="Mapping Configuration"
        description={`${unsupportedLabel} order mapping isn't supported yet.`}
      >
        <MappingPairingBar pairing={pairing} />
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
        description={`No supported marketplace is paired with ${pairing.master.name} yet.`}
      >
        <MappingPairingBar pairing={pairing} />
        <EmptyState
          title="No supported marketplace is paired with this shop"
          message="Order mappings are configured from the marketplace side. Open a supported marketplace connection (Allegro or Erli) and set its catalog to this shop to pair them."
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
          onPickSource={(chosenSourceId) => {
            void navigate(`/connections/${chosenSourceId}/mappings`);
          }}
        />
        <EmptyState
          title="Choose which marketplace to configure"
          message={`Order mappings belong to a marketplace. Choose which of the ${pairing.candidates.length} paired marketplaces you want to configure against ${pairing.master.name}.`}
          action={
            <Button
              tone="secondary"
              onClick={() => document.getElementById(MAPPING_SOURCE_PICKER_ID)?.focus()}
            >
              Choose marketplace
            </Button>
          }
        />
      </PageLayout>
    );
  }

  // ── Ready: the pair is resolved and supported. Load the mapping data. ────
  //
  // Per-tab mapping data loads lazily (#1784 follow-up) and each panel renders
  // its own loading/error state via `dataError` (#1784 follow-up I2), so a
  // failure on one lazily-visited tab never tears down the pairing strip or the
  // other tabs. There is no full-page data gate here anymore.

  const sourceInactive = pairing.source.status !== 'active';
  const destinationInactive = pairing.destination.status !== 'active';

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
    !routingRulesQuery.isLoading &&
    routingRulesQuery.error === null;
  // The fallback carrier id lives on the DESTINATION (PrestaShop) connection and
  // is applied by the destination adapter (#1784 follow-up I6) — never the
  // source marketplace config, which carries no `defaultCarrierId`.
  const destinationConfig = pairing.destination.config as
    | { defaultCarrierId?: unknown }
    | undefined;
  const carrierFallbackBanner = carriersReady
    ? deriveCarrierFallbackBanner({
        unmappedCount: unmappedDeliveryCount,
        defaultCarrierId:
          destinationConfig?.defaultCarrierId !== undefined &&
          destinationConfig.defaultCarrierId !== null
            ? String(destinationConfig.defaultCarrierId)
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

  const inactiveNote =
    sourceInactive && destinationInactive
      ? `Both the ${sourceLabel} source and ${destinationLabel} destination connections are not active. Mappings save, but orders won't sync until both are re-enabled.`
      : destinationInactive
        ? `The ${destinationLabel} destination connection is not active. Mappings save, but orders won't sync until it's re-enabled.`
        : sourceInactive
          ? `The ${sourceLabel} source connection is not active. Mappings save, but orders won't sync until it's re-enabled.`
          : null;

  return (
    <PageLayout
      backTo={backTo}
      eyebrow="Connection"
      title="Mapping Configuration"
      description={`Configure ${sourceLabel} → ${destinationLabel} mappings for order statuses, delivery carriers, and payment methods.`}
    >
      <MappingPairingBar pairing={pairing} />

      {inactiveNote && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="info">{inactiveNote}</Alert>
        </div>
      )}

      <Tabs value={currentTab} onValueChange={handleTabChange} aria-label="Mapping types">
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
              connectionId={sourceConnectionId}
              sourceLabel={sourceLabel}
              deliveryMethods={options.allegroDeliveryMethods}
              deliveryMethodsLoading={optionsLoading}
              deliveryMethodsError={optionsErrors.allegroDeliveryMethods ?? null}
              onDirtyChange={dirtyHandlers.fulfillment}
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
            dataError={statusQuery.error ?? null}
            onRetryData={() => void statusQuery.refetch()}
            onDirtyChange={dirtyHandlers.status}
            emptyStateMessage={EMPTY_STATE_MESSAGE_BY_TAB.status}
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
            dataError={carrierQuery.error ?? null}
            onRetryData={() => void carrierQuery.refetch()}
            onDirtyChange={dirtyHandlers.carriers}
            emptyStateMessage={EMPTY_STATE_MESSAGE_BY_TAB.carriers}
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
            dataError={paymentQuery.error ?? null}
            onRetryData={() => void paymentQuery.refetch()}
            onDirtyChange={dirtyHandlers.payments}
            emptyStateMessage={EMPTY_STATE_MESSAGE_BY_TAB.payments}
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
              dataError={orderStateQuery.error ?? null}
              onRetryData={() => void orderStateQuery.refetch()}
              onDirtyChange={dirtyHandlers['order-states']}
              emptyStateMessage={EMPTY_STATE_MESSAGE_BY_TAB['order-states']}
            />
          </TabsContent>
        )}
      </Tabs>

      <ConfirmDialog
        open={pendingTab !== null}
        onOpenChange={(open) => {
          if (!open) cancelDiscard();
        }}
        title="Discard unsaved changes?"
        description="You have unsaved mapping edits on this tab. Switching tabs will discard them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={confirmDiscard}
      />
    </PageLayout>
  );
}
