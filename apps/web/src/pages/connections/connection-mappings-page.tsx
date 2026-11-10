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
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { MappingPanel, type MappingRow } from '../../features/mappings/components/MappingPanel';
import { RoutingRulesPanel } from '../../features/mappings/components/routing-rules-panel';
import { AttributeRulesPanel } from '../../features/mappings/components/attribute-rules-panel';
import { DeliveryOnDocumentsPanel } from '../../features/delivery-on-documents';
import { publishDestinationKind } from '../../features/listings';
import {
  MappingPairingBar,
  MAPPING_SOURCE_PICKER_ID,
} from '../../features/mappings/components/mapping-pairing-bar';
import { useConnectionQuery } from '../../features/connections';
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
import { DELIVERY_MAPPING_DEEP_LINK_PARAMS, resolvePlatformLabel } from '../../features/mappings';
import { usePlatforms } from '../../shared/plugins';
import {
  OL_ORDER_STATUS_OPTIONS,
  type MappingOption,
  type MappingOptions,
} from '../../features/mappings/api/mappings.types';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import {
  interpolate,
  renderRich,
  selectPluralForm,
  useActiveLocale,
  useFormat,
  useMessages,
  type Messages,
  type ResolvedCopy,
  type SupportedLocale,
} from '../../shared/i18n';
import { describeApiError } from '../../shared/api/describe-api-error';

type PageCopy = ResolvedCopy<Messages['connections']>['connectionMappingsPage'];

type TabId =
  | 'fulfillment'
  | 'status'
  | 'carriers'
  | 'payments'
  | 'order-states'
  | 'attribute-rules'
  | 'delivery-on-documents';

const ALL_TABS: TabId[] = [
  'fulfillment',
  'status',
  'carriers',
  'payments',
  'order-states',
  'attribute-rules',
  'delivery-on-documents',
];

function isTabId(value: string): value is TabId {
  return (ALL_TABS as string[]).includes(value);
}

/**
 * Which option-bundle keys each tab consumes (#1784 follow-up: lazy-load per
 * tab). Used to fetch only the option lists the visited tabs actually need,
 * instead of the whole 6-list bundle on page load. Order-states' source axis
 * is the static `OL_ORDER_STATUS_OPTIONS`, so it only needs the destination
 * status list. Attribute rules (#1841) read no option bundle at all — the panel
 * owns its own data — so the tab contributes no keys. The same holds for
 * Delivery on documents (#3908).
 */
const OPTION_KEYS_BY_TAB: Record<TabId, (keyof MappingOptions)[]> = {
  fulfillment: ['allegroDeliveryMethods'],
  status: ['allegroOrderStatuses', 'prestashopOrderStatuses'],
  carriers: ['allegroDeliveryMethods', 'prestashopCarriers'],
  payments: ['allegroPaymentProviders', 'prestashopPaymentModules'],
  'order-states': ['prestashopOrderStatuses'],
  'attribute-rules': [],
  'delivery-on-documents': [],
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
  copy: PageCopy['carrierFallback'];
  locale: SupportedLocale;
  formatNumber: (value: number) => string;
}): FallbackBannerSpec | null {
  const { unmappedCount, defaultCarrierId, carriers, sourceLabel, copy, locale, formatNumber } =
    args;
  if (unmappedCount <= 0) return null;

  const render = (
    forms: PageCopy['carrierFallback']['usingFallback'],
    params: Record<string, string> = {},
  ): ReactNode =>
    renderRich(
      selectPluralForm(unmappedCount, forms, locale),
      { count: (text) => <span className="alert__count">{text}</span> },
      { n: formatNumber(unmappedCount), ...params },
    );

  // Case 1 - explicit fallback configured. Resolve the carrier name from
  // the loaded options. If the saved id no longer exists in the live
  // options (operator deleted the carrier in BO), fall through to the
  // "no fallback" warning so the operator notices.
  if (defaultCarrierId) {
    const fallback = carriers.find((c) => c.value === defaultCarrierId);
    if (fallback) {
      return {
        tone: 'info',
        message: render(copy.usingFallback, { fallback: fallback.label }),
      };
    }
  }

  // Case 2 - OL Dynamic is installed and runtime will fall back to it.
  const hasDynamic = carriers.some((c) => c.kind === 'dynamic');
  if (hasDynamic) {
    return {
      tone: 'info',
      message: render(copy.usingDynamic, { platform: sourceLabel }),
    };
  }

  // Case 3 - no fallback at all. Operator-actionable warning.
  return {
    tone: 'warning',
    message: render(copy.noFallback),
  };
}

export function ConnectionMappingsPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const navigate = useNavigate();
  const platforms = usePlatforms();
  const copy = useMessages('connections').connectionMappingsPage;
  const locale = useActiveLocale();
  const format = useFormat();

  // Fix-it deep link (#1794): the order-detail "Add mapping" rider links here
  // with `?tab=carriers&method=<id>&methodName=<name>` so we open the Delivery
  // (carriers) tab and pre-focus the unmapped source method.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get(DELIVERY_MAPPING_DEEP_LINK_PARAMS.tab);
  const focusMethodId = searchParams.get(DELIVERY_MAPPING_DEEP_LINK_PARAMS.method);
  const focusMethodName = searchParams.get(DELIVERY_MAPPING_DEEP_LINK_PARAMS.methodName);

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
  // plus tabs the operator has visited fetch their data. Honour the deep-link
  // tab request (#1794) only when it names a tab that's actually available for
  // this connection's resolved capabilities; otherwise fall back to the first.
  const fallbackTab: TabId = supportsOrderSource ? 'fulfillment' : 'status';
  const requestedTabAvailable =
    requestedTab !== null &&
    isTabId(requestedTab) &&
    (requestedTab !== 'fulfillment' || supportsOrderSource) &&
    (requestedTab !== 'delivery-on-documents' || supportsOrderSource) &&
    (requestedTab !== 'order-states' || supportsOrderProcessor);
  const defaultTab: TabId = requestedTabAvailable ? requestedTab : fallbackTab;
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

  // Attribute mapping rules (#1841) feed attribute projection, which runs for
  // marketplace offer creation and shop publish. Gate on the SAME publish-
  // destination convention as the unified publish flow (#1828/#1829): a
  // marketplace is an `OfferCreator` (supportedCapabilities), a shop is an
  // enabled `ProductPublisher` (enabledCapabilities). Capability-driven, never
  // platformType-based.
  const connectionQuery = useConnectionQuery(connectionId);
  const supportsAttributeRules =
    connectionQuery.data !== undefined && publishDestinationKind(connectionQuery.data) !== null;

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
      'attribute-rules': make('attribute-rules'),
      'delivery-on-documents': make('delivery-on-documents'),
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
  const sourceLabel = isReady ? resolvePlatformLabel(platforms, pairing.source) : copy.fallbackSource;
  const destinationLabel = isReady
    ? resolvePlatformLabel(platforms, pairing.destination)
    : copy.fallbackDestination;

  const backTo = { to: `/connections/${connectionId}`, label: copy.eyebrow } as const;

  // ── Pairing-driven states (evaluated after all hooks) ───────────────────

  if (pairing.status === 'loading') {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.loading.description}>
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      </PageLayout>
    );
  }

  if (pairing.status === 'error') {
    return (
      <PageLayout backTo={backTo} eyebrow={copy.eyebrow} title={copy.title} description={copy.error.description}>
        <ErrorState title={copy.error.title} message={describeApiError(pairing.error, 'connections')} />
      </PageLayout>
    );
  }

  if (pairing.status === 'unsupported') {
    const unsupportedLabel = resolvePlatformLabel(platforms, pairing.source);
    return (
      <PageLayout
        backTo={backTo}
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={interpolate(copy.unsupported.description, { platform: unsupportedLabel })}
      >
        <MappingPairingBar pairing={pairing} />
        <EmptyState
          title={interpolate(copy.unsupported.title, { platform: unsupportedLabel })}
          message={copy.unsupported.message}
        />
      </PageLayout>
    );
  }

  if (pairing.status === 'no-source') {
    return (
      <PageLayout
        backTo={backTo}
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={interpolate(copy.noSource.description, { name: pairing.master.name })}
      >
        <MappingPairingBar pairing={pairing} />
        <EmptyState
          title={copy.noSource.title}
          message={copy.noSource.message}
          action={
            <Link className="button button--secondary" to="/connections">
              {copy.noSource.goToConnections}
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
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={interpolate(copy.pickSource.description, { name: pairing.master.name })}
      >
        <MappingPairingBar
          pairing={pairing}
          onPickSource={(chosenSourceId) => {
            void navigate(`/connections/${chosenSourceId}/mappings`);
          }}
        />
        <EmptyState
          title={copy.pickSource.title}
          message={interpolate(copy.pickSource.message, {
            n: format.number(pairing.candidates.length),
            name: pairing.master.name,
          })}
          action={
            <Button
              tone="secondary"
              onClick={() => document.getElementById(MAPPING_SOURCE_PICKER_ID)?.focus()}
            >
              {copy.pickSource.choose}
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
    ...(supportsOrderSource ? [{ id: 'fulfillment' as const, label: copy.tabs.fulfillment }] : []),
    { id: 'status' as const, label: copy.tabs.status },
    { id: 'carriers' as const, label: copy.tabs.carriers },
    { id: 'payments' as const, label: copy.tabs.payments },
    ...(supportsOrderProcessor ? [{ id: 'order-states' as const, label: copy.tabs.orderStates }] : []),
    ...(supportsAttributeRules
      ? [{ id: 'attribute-rules' as const, label: copy.tabs.attributeRules }]
      : []),
    ...(supportsOrderSource
      ? [{ id: 'delivery-on-documents' as const, label: copy.tabs.deliveryOnDocuments }]
      : []),
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
        copy: copy.carrierFallback,
        locale,
        formatNumber: format.number,
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
      ? interpolate(copy.inactive.both, { source: sourceLabel, destination: destinationLabel })
      : destinationInactive
        ? interpolate(copy.inactive.destination, { destination: destinationLabel })
        : sourceInactive
          ? interpolate(copy.inactive.source, { source: sourceLabel })
          : null;

  return (
    <PageLayout
      backTo={backTo}
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={interpolate(copy.description, { source: sourceLabel, destination: destinationLabel })}
    >
      <MappingPairingBar pairing={pairing} />

      {inactiveNote && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="info">{inactiveNote}</Alert>
        </div>
      )}

      <Tabs value={currentTab} onValueChange={handleTabChange} aria-label={copy.tabsLabel}>
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
            title={copy.status.title}
            mappingKind="status"
            description={interpolate(copy.status.description, { source: sourceLabel, destination: destinationLabel })}
            sourceLabel={interpolate(copy.status.columnLabel, { platform: sourceLabel })}
            targetLabel={interpolate(copy.status.columnLabel, { platform: destinationLabel })}
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
            emptyStateMessage={copy.status.empty}
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
            title={copy.carriers.title}
            mappingKind="carriers"
            description={interpolate(copy.carriers.description, { source: sourceLabel, destination: destinationLabel })}
            sourceLabel={interpolate(copy.carriers.sourceColumn, { platform: sourceLabel })}
            targetLabel={interpolate(copy.carriers.targetColumn, { platform: destinationLabel })}
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
            emptyStateMessage={copy.carriers.empty}
            dynamicOptionSuffix={` - ${interpolate(copy.carriers.dynamicSuffix, { platform: sourceLabel })}`}
            focusSourceValue={focusMethodId}
            focusSourceName={focusMethodName}
          />
        </TabsContent>

        <TabsContent value="payments">
          <MappingPanel
            title={copy.payments.title}
            mappingKind="payments"
            description={interpolate(copy.payments.description, { source: sourceLabel, destination: destinationLabel })}
            sourceLabel={interpolate(copy.payments.sourceColumn, { platform: sourceLabel })}
            targetLabel={interpolate(copy.payments.targetColumn, { platform: destinationLabel })}
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
            emptyStateMessage={copy.payments.empty}
          />
        </TabsContent>

        {supportsOrderProcessor && (
          <TabsContent value="order-states">
            <MappingPanel
              title={copy.orderStates.title}
              mappingKind="order-state"
              description={interpolate(copy.orderStates.description, { destination: destinationLabel })}
              sourceLabel={copy.orderStates.sourceColumn}
              targetLabel={interpolate(copy.orderStates.targetColumn, { platform: destinationLabel })}
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
              emptyStateMessage={copy.orderStates.empty}
            />
          </TabsContent>
        )}

        {supportsAttributeRules && (
          <TabsContent value="attribute-rules">
            <AttributeRulesPanel connectionId={connectionId} />
          </TabsContent>
        )}

        {supportsOrderSource && (
          <TabsContent value="delivery-on-documents">
            <DeliveryOnDocumentsPanel
              connectionId={sourceConnectionId}
              onDirtyChange={dirtyHandlers['delivery-on-documents']}
            />
          </TabsContent>
        )}
      </Tabs>

      <ConfirmDialog
        open={pendingTab !== null}
        onOpenChange={(open) => {
          if (!open) cancelDiscard();
        }}
        title={copy.discard.title}
        description={copy.discard.description}
        confirmLabel={copy.discard.confirm}
        cancelLabel={copy.discard.cancel}
        tone="danger"
        onConfirm={confirmDiscard}
      />
    </PageLayout>
  );
}
