import type { ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { hasPricingSyncPage } from '../../features/connections/lib/pricing-destination';
import { useProductMasterConnections } from '../../features/connections/hooks/use-product-master-connections';
import { ConnectionActionsPanel } from '../../features/connections/components/ConnectionActionsPanel';
import { EnableConnectionButton } from '../../features/connections/components/EnableConnectionButton';
import { RestoreConnectionButton } from '../../features/connections/components/restore-connection-button';
import { ConnectionCapabilitiesPanel } from '../../features/connections/components/ConnectionCapabilitiesPanel';
import { ConnectionConfigPanel } from '../../features/connections/components/ConnectionConfigPanel';
import { ConnectionDiagnosticsPanel } from '../../features/connections/components/ConnectionDiagnosticsPanel';
import { CatalogTrustPanel } from '../../features/connections/components/catalog-trust-panel';
import { ConnectionSyncStatusPanel } from '../../features/connections/components/connection-sync-status-panel';
import { RouterReadinessPanel } from '../../features/connections/components/router-readiness-panel';
import {
  CarrierCreatedNotice,
  CarrierShipsForCard,
} from '../../features/connections/components/carrier-ships-for-card';
import { OrderSourceShippingCard } from '../../features/connections/components/order-source-shipping-card';
import {
  CARRIER_CAPABILITY,
  ORDER_SOURCE_CAPABILITY,
} from '../../features/connections/components/connection-shipping-routes';
import { interpolate, renderRich, useMessages } from '../../shared/i18n';
import {
  CONNECTION_CREATED_PARAM,
  OMS_SETUP_RETURN_PATH,
  isFromOmsSetup,
} from '../../features/connections/lib/oms-setup-return';
import type { Connection, ConnectionStatus } from '../../features/connections/api/connections.types';
import { hasMissingCredentials } from '../../features/connections/api/connections.types';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { EntityLabel } from '../../shared/ui/entity-label';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { TimeDisplay } from '../../shared/ui/time-display';
import { isOmsRoutingUiEnabled } from '../../shared/config/oms-routing-ui';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Alert } from '../../shared/ui/alert';
import { usePlatform, usePlatforms } from '../../shared/plugins';
import { resolvePlatformLabel } from '../../features/mappings';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { describeConnectionStatus, OMS_PLATFORM_TYPE } from '../oms/oms-connection';
import { GuideButton, PageGuide } from '../../shared/ui/guide-drawer';
import {
  GiftsOnDocumentsPanel,
  useGiftDocumentsGuide,
  type OverridingGift,
} from '../../features/gift-documents';
import { usePromotionsQuery } from '../../features/promotions';
import { describeApiError } from '../../shared/api/describe-api-error';

function toStatusTone(status: ConnectionStatus): StatusBadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'disabled':
      return 'neutral';
    case 'error':
      return 'error';
    case 'needs_reauth':
      return 'warning';
    case 'archived':
      return 'neutral';
  }
}

/**
 * Re-authentication banner (#819).
 *
 * Shown when a connection has been auto-flagged `needs_reauth` after a terminal
 * credential rejection (the scheduler has paused syncing against it). For OAuth
 * platforms it links to the setup wizard in re-auth mode (`?reauth={id}`),
 * which rotates credentials in place and clears the flag. Non-OAuth platforms
 * fall back to editing the connection's credentials.
 */
function ReauthRequiredBanner({ connection }: { connection: Connection }): ReactElement | null {
  const platform = usePlatform(connection.platformType);
  const platforms = usePlatforms();
  const copy = useMessages('connections').connectionDetailPage;

  if (connection.status !== 'needs_reauth') return null;

  const platformLabel = resolvePlatformLabel(platforms, connection);
  const oauthReauthTo =
    platform?.requiresExternalAuthRedirect && platform.setupCard?.to
      ? `${platform.setupCard.to}?reauth=${connection.id}`
      : null;

  return (
    <Alert
      tone="warning"
      title={copy.reauthBanner.title}
      action={
        oauthReauthTo ? (
          <Link className="button button--primary" to={oauthReauthTo}>
            {copy.reauthenticate}
          </Link>
        ) : (
          <Link className="button button--primary" to={`/connections/${connection.id}/edit`}>
            {copy.reauthBanner.updateCredentials}
          </Link>
        )
      }
    >
      {interpolate(copy.reauthBanner.body, { platform: platformLabel })}
    </Alert>
  );
}

/**
 * Sync-paused banner (#1940).
 *
 * Shown when an operator has disabled the connection. Mirrors
 * {@link ReauthRequiredBanner} — one status, one explanation, one recovery
 * control — so the pause is visible and reversible from the page itself rather
 * than only from the Actions tab.
 *
 * Info tone, not warning: a disabled connection is a deliberate operator choice,
 * not a fault. The warning tone stays reserved for states nobody asked for.
 */
function SyncPausedBanner({ connection }: { connection: Connection }): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const copy = useMessages('connections').connectionDetailPage;

  if (connection.status !== 'disabled') return null;
  // A restored archived connection is disabled too, but "enable it to resume"
  // would be false there: it has no credentials. CredentialsMissingBanner
  // says what to do instead (#3657).
  if (hasMissingCredentials(connection)) return null;

  return (
    <Alert
      tone="info"
      title={copy.pausedBanner.title}
      action={
        write.visible ? (
          <EnableConnectionButton connection={connection} label={copy.pausedBanner.enable} />
        ) : undefined
      }
    >
      {copy.pausedBanner.body}
    </Alert>
  );
}

/**
 * #3657 — a restored archived connection comes back disabled with its
 * credential deleted. It cannot be enabled until credentials are entered again,
 * so the banner offers that step, not Enable. Same recovery targets as
 * {@link ReauthRequiredBanner}: an OAuth platform re-authenticates through its
 * setup wizard, any other platform through the edit page.
 */
function CredentialsMissingBanner({ connection }: { connection: Connection }): ReactElement | null {
  const platform = usePlatform(connection.platformType);
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const copy = useMessages('connections').connectionDetailPage;

  if (connection.status !== 'disabled' || !hasMissingCredentials(connection)) return null;

  const oauthReauthTo =
    platform?.requiresExternalAuthRedirect && platform.setupCard?.to
      ? `${platform.setupCard.to}?reauth=${connection.id}`
      : null;

  return (
    <Alert
      tone="info"
      title={copy.credentialsBanner.title}
      action={
        write.visible ? (
          oauthReauthTo ? (
            <Link className="button button--primary" to={oauthReauthTo}>
              {copy.reauthenticate}
            </Link>
          ) : (
            <Link className="button button--primary" to={`/connections/${connection.id}/edit`}>
              {copy.credentialsBanner.enter}
            </Link>
          )
        ) : undefined
      }
    >
      {copy.credentialsBanner.body}
    </Alert>
  );
}

/**
 * #3657 — an archived connection is reachable only by its URL (a history link,
 * or the Archived filter on the list). Say what it is and offer the way back.
 */
function ArchivedBanner({ connection }: { connection: Connection }): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const copy = useMessages('connections').connectionDetailPage;

  if (connection.status !== 'archived') return null;

  return (
    <Alert
      tone="info"
      title={copy.archivedBanner.title}
      action={write.visible ? <RestoreConnectionButton connection={connection} /> : undefined}
    >
      {copy.archivedBanner.body}
    </Alert>
  );
}

const TAB_VALUES = ['overview', 'health', 'actions', 'config', 'gifts'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(value: string | null): value is TabValue {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value);
}

interface ProductCatalogLinkBannerProps {
  connection: Connection;
  candidates: Connection[];
  isLoading: boolean;
  hasError: boolean;
}

function ProductCatalogLinkBanner({
  connection,
  candidates,
  isLoading,
  hasError,
}: ProductCatalogLinkBannerProps): ReactElement | null {
  const copy = useMessages('connections').connectionDetailPage.catalogBanner;
  if (
    !connection.enabledCapabilities.includes('OfferManager') &&
    !connection.enabledCapabilities.includes('ProductPublisher')
  ) {
    return null;
  }

  const rawMaster = connection.config.masterCatalogConnectionId;
  const explicitMaster = typeof rawMaster === 'string' ? rawMaster : null;
  const editHref = `/connections/${connection.id}/edit`;
  const editLink = (text: string): ReactElement => <Link to={editHref}>{text}</Link>;

  if (explicitMaster !== null && explicitMaster.length > 0) {
    // Linked — no banner.
    return null;
  }

  if (explicitMaster === '') {
    return (
      <Alert tone="warning" title={copy.disabledTitle}>
        {renderRich(copy.disabledBody, { link: editLink })}
      </Alert>
    );
  }

  // From here: explicitMaster === null (server never stored the key).
  // Defer banner render until candidates query settles, and stay silent on
  // candidate-query errors (advisory banner, not blocking; avoids double
  // noise when the user already sees global query errors elsewhere).
  if (isLoading) return null;
  if (hasError) return null;

  if (candidates.length === 1) {
    return (
      <Alert tone="info" title={copy.autoLinkedTitle}>
        {renderRich(
          copy.autoLinkedBody,
          { strong: (text) => <strong>{text}</strong>, link: editLink },
          { name: candidates[0].name },
        )}
      </Alert>
    );
  }

  if (candidates.length === 0) {
    return (
      <Alert tone="warning" title={copy.notLinkedTitle}>
        {renderRich(copy.noCandidatesBody, {
          link: (text) => <Link to="/connections/new?platform=prestashop">{text}</Link>,
        })}
      </Alert>
    );
  }

  return (
    <Alert tone="warning" title={copy.notLinkedTitle}>
      {renderRich(copy.ambiguousBody, { link: editLink })}
    </Alert>
  );
}

function ConnectionStatusBadge({ connection }: { connection: Connection }): ReactElement {
  const view = describeConnectionStatus(connection, toStatusTone(connection.status));
  return <StatusBadge tone={view.tone}>{view.label}</StatusBadge>;
}

/** The OMS connection is configured by the packing setup, never by the generic edit form. */
const PACKING_SETTINGS_PATH = '/settings/packing';

/**
 * The promotions that set their own gift form for this channel, i.e. the ones
 * above the connection in the order of settings. A promotion with no channel
 * condition applies to every channel.
 */
function overridingGiftsFor(
  promotions: ReturnType<typeof usePromotionsQuery>['data'],
  connectionId: string,
): OverridingGift[] {
  return (promotions ?? []).flatMap((rule) => {
    const form = rule.benefit.documentForm;
    if (!rule.isActive || form === undefined) return [];
    const channels = rule.conditions.flatMap((c) =>
      c.field === 'sourceConnection' ? [[c.value]] : c.field === 'sourceConnectionIn' ? [c.values] : [],
    );
    if (channels.length > 0 && !channels.every((ids) => ids.includes(connectionId))) return [];
    const unitPrice = rule.benefit.documentUnitPrice;
    return [
      {
        id: rule.id,
        name: rule.name,
        form,
        ...(unitPrice === undefined ? {} : { unitPrice }),
      },
    ];
  });
}

export function ConnectionDetailPage(): ReactElement {
  const shippingCopy = useMessages('connections').shipping;
  const { connectionId = '' } = useParams();
  const guideCopy = useGiftDocumentsGuide();
  const promotions = usePromotionsQuery();
  const connectionQuery = useConnectionQuery(connectionId);
  // The plugin registry is what turns a `platformType` slug into the product
  // name an operator recognises. Rendering the raw slug was tolerable while
  // one slug meant one product; it stopped being so when two products can
  // share a prefix (`subiekt-gt` vs `subiekt-nexo`), where the slug is
  // exactly the part a reader has to squint at.
  const platforms = usePlatforms();
  const {
    productMasterConnections,
    connectionsQuery: productMasterConnectionsQuery,
  } = useProductMasterConnections();
  const [searchParams, setSearchParams] = useSearchParams();
  const copy = useMessages('connections').connectionDetailPage;
  const common = useMessages('ui').common;

  const tabParam = searchParams.get('tab');
  const activeTab: TabValue = isTabValue(tabParam) ? tabParam : 'overview';

  const handleTabChange = (value: string): void => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value === 'overview') {
          params.delete('tab');
        } else {
          params.set('tab', value);
        }
        return params;
      },
      { replace: true },
    );
  };

  const connection = connectionQuery.data;
  // The OMS connection is a by-product of the packing setup: no credentials, no
  // adapter choice, no config to edit. It is managed from /settings/packing.
  const isOms = connection?.platformType === OMS_PLATFORM_TYPE;
  const giftTabCopy = useMessages('gift-documents').settings;
  const supportsGifts = connection?.enabledCapabilities.includes('OrderSource') === true;
  const isCarrier = connection?.enabledCapabilities.includes(CARRIER_CAPABILITY) ?? false;
  const isOrderSource = connection?.enabledCapabilities.includes(ORDER_SOURCE_CAPABILITY) ?? false;
  // Set by a carrier wizard on the page it lands on (#3958). Compared with a
  // literal only, like `from` below.
  const justCreated = searchParams.get(CONNECTION_CREATED_PARAM) === '1';
  // An operator who left the OMS setup to connect a carrier gets the way back
  // to that step. The param is never used as a URL; the target is fixed.
  const backTo = isFromOmsSetup(searchParams)
    ? { to: OMS_SETUP_RETURN_PATH, label: shippingCopy.backToOmsSetup }
    : { to: '/connections', label: copy.backLabel };

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={
        connection ? (
          <EntityLabel id={connection.id} name={connection.name} />
        ) : (
          interpolate(copy.fallbackTitle, { id: connectionId })
        )
      }
      description={
        isOms
          ? copy.descriptionOms
          : copy.description
      }
      backTo={backTo}
      actions={
        connection ? (
          connection.platformType === OMS_PLATFORM_TYPE ? (
            <div className="button-group connection-actions">
              <Link className="button button--primary" to={PACKING_SETTINGS_PATH}>
                {copy.packingSettings}
              </Link>
            </div>
          ) : (
          <div className="button-group connection-actions">
            <Link className="button button--primary" to={`/connections/${connectionId}/edit`}>
              {copy.actions.edit}
            </Link>
            <Link className="button button--secondary" to={`/connections/${connectionId}/mappings`}>
              {copy.actions.mappings}
            </Link>
            {connection.enabledCapabilities.includes('ProductMaster') ? (
              <Link className="button button--secondary" to={`/connections/${connectionId}/mappings/categories`}>
                {copy.actions.categoryMappings}
              </Link>
            ) : null}
            {/* Wider than the destination predicate: the page also carries a
                SOURCE connection's read-only pricing rollup, so a
                ProductMaster-only connection must be able to reach it from
                here too (#3167 review). One definition, in
                features/connections/lib. */}
            {hasPricingSyncPage(connection) ? (
              <Link
                className="button button--secondary"
                to={`/connections/${connectionId}/pricing-sync`}
              >
                {copy.actions.pricingSync}
              </Link>
            ) : null}
          </div>
          )
        ) : undefined
      }
      summary={
        connection ? (
          <>
            <div className="toolbar__group">
              <span className="toolbar-chip" title={connection.platformType}>
                {resolvePlatformLabel(platforms, connection)}
              </span>
              <ConnectionStatusBadge connection={connection} />
            </div>
            <div className="toolbar__group">
              <span className="muted-text">
                {renderRich(copy.created, {
                  date: () => <TimeDisplay iso={connection.createdAt} format="date" />,
                })}
              </span>
            </div>
          </>
        ) : undefined
      }
    >
      {connectionQuery.isLoading ? (
        <LoadingState
          title={copy.loading.title}
          message={copy.loading.message}
        />
      ) : null}
      {connectionQuery.error ? (
        <ErrorState
          title={copy.error.title}
          message={describeApiError(connectionQuery.error, 'connections')}
          action={
            <button type="button" className="button button--secondary" onClick={() => void connectionQuery.refetch()}>
              {common.retry}
            </button>
          }
        />
      ) : null}
      {!connectionQuery.isLoading && !connectionQuery.error && !connection ? (
        <EmptyState
          title={copy.notFound.title}
          message={copy.notFound.message}
        />
      ) : null}
      {connection ? <ReauthRequiredBanner connection={connection} /> : null}
      {connection ? <SyncPausedBanner connection={connection} /> : null}
      {connection ? <CredentialsMissingBanner connection={connection} /> : null}
      {connection ? <ArchivedBanner connection={connection} /> : null}
      {connection && isCarrier && !isOms && justCreated ? (
        <CarrierCreatedNotice connection={connection} />
      ) : null}
      {connection ? (
        <ProductCatalogLinkBanner
          connection={connection}
          candidates={productMasterConnections.filter((c) => c.id !== connection.id)}
          isLoading={productMasterConnectionsQuery.isLoading}
          hasError={Boolean(productMasterConnectionsQuery.error)}
        />
      ) : null}
      {connection ? (
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="tabs__list--scroll">
            <TabsTrigger value="overview">{copy.tabs.overview}</TabsTrigger>
            <TabsTrigger value="health">{copy.tabs.health}</TabsTrigger>
            {isOms ? null : <TabsTrigger value="actions">{copy.tabs.actions}</TabsTrigger>}
            {isOms ? null : <TabsTrigger value="config">{copy.tabs.config}</TabsTrigger>}
            {supportsGifts ? <TabsTrigger value="gifts">{copy.tabs.gifts}</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="overview">
            <div className="panel panel--dense">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">{copy.overview.eyebrow}</p>
                  <h3 className="section-title">{copy.tabs.overview}</h3>
                </div>
                <ConnectionStatusBadge connection={connection} />
              </div>

              <KeyValueList
                items={[
                  { id: 'name', label: copy.overview.name, value: connection.name },
                  {
                    id: 'platform',
                    label: copy.overview.platform,
                    // Both, not one: the product name is what an operator
                    // reads, and the raw slug is what they paste into a
                    // support ticket or an API call. Replacing the slug
                    // outright would take that away.
                    value: (
                      <>
                        {resolvePlatformLabel(platforms, connection)}{' '}
                        <span className="muted-text mono-text">{connection.platformType}</span>
                      </>
                    ),
                  },
                  ...(isOms ? [] : [
                  {
                    id: 'credentials',
                    label: copy.overview.credentials,
                    value: hasMissingCredentials(connection)
                      ? copy.overview.credentialsNotSet
                      : connection.credentialsBacked
                        ? copy.overview.credentialsStored
                        : copy.overview.credentialsServer,
                  },
                  {
                    id: 'adapter',
                    label: copy.overview.adapter,
                    value: connection.adapterKey ?? copy.overview.defaultAdapter,
                    mono: true,
                  },
                  ]),
                  { id: 'id', label: copy.overview.connectionId, value: connection.id, mono: true },
                  {
                    id: 'updatedAt',
                    label: copy.overview.lastUpdated,
                    value: <TimeDisplay iso={connection.updatedAt} />,
                  },
                ]}
              />
            </div>

            {isCarrier && !isOms ? <CarrierShipsForCard connection={connection} /> : null}
            {isOrderSource && !isOms ? <OrderSourceShippingCard connection={connection} /> : null}

            <ConnectionCapabilitiesPanel connection={connection} readOnly={isOms} />
          </TabsContent>

          <TabsContent value="health">
            <ConnectionDiagnosticsPanel connectionId={connection.id} />
            <ConnectionSyncStatusPanel connectionId={connection.id} />
            {connection.enabledCapabilities.includes('ProductMaster') ? (
              <CatalogTrustPanel connectionId={connection.id} />
            ) : null}
            {/* #2407 — install-wide precondition, rendered here because this is
                where routing gets switched on. Deliberately not capability-gated:
                the claim lives in config, and `enabledCapabilities` is stamped at
                create and never retro-filled (#2085), so gating on it would hide
                the panel from exactly the connections that need it. Withheld
                entirely unless the build opts into the OMS routing UI (#3634). */}
            {isOmsRoutingUiEnabled() ? <RouterReadinessPanel /> : null}
          </TabsContent>

          <TabsContent value="actions">
            <ConnectionActionsPanel
              connection={connection}
              settingsLink={
                isOms
                  ? { to: PACKING_SETTINGS_PATH, label: copy.packingSettings }
                  : undefined
              }
            />
          </TabsContent>

          <TabsContent value="config">
            <ConnectionConfigPanel config={connection.config} />
          </TabsContent>

          {supportsGifts ? (
            <TabsContent value="gifts">
              <PageGuide
                title={guideCopy.title}
                lede={guideCopy.lede}
                sections={guideCopy.sections}
                defaultOpen={guideCopy.defaultOpen}
              >
                <div className="gift-tab-actions">
                  <GuideButton label={giftTabCopy.guideButton} />
                </div>
                <GiftsOnDocumentsPanel
                  connectionId={connection.id}
                  overridingGifts={overridingGiftsFor(promotions.data, connection.id)}
                />
              </PageGuide>
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}
    </PageLayout>
  );
}
