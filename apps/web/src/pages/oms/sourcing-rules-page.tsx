/**
 * Sourcing rules (#3060)
 *
 * The page behind the `/settings` tile. It owns exactly two gates and nothing
 * else — the read's own states, the table and every dialog belong to
 * `SourcingRulesSection` (#3061), so "what does this read look like while it is
 * loading, failing or empty" has one answer rather than two.
 *
 * ## No sidebar entry. The tile is the only way in.
 *
 * Settled on #3055 § Decisions in the mockup's favour, so the page carries a
 * back-link to `/settings` and a two-level crumb rather than relying on a nav
 * item that does not exist. `InventoryLocationsTile` and `WhoDecidesTile` are
 * the same shape.
 *
 * ## Gate 1 — the wrong connection, or none
 *
 * A ruleset is per connection and only the OpenLinker OMS connection can hold
 * one: the backend refuses authoring on anything else (#2953). Rendering the
 * editor anyway would let an operator author rules nothing will ever read. The
 * two causes are told apart by the CAUSE, never by whether a `?connectionId=`
 * was supplied: with a query param and no OMS connection at all, picking the
 * copy off the param would say "this is not your OMS connection" about a
 * comparison that never happened.
 *
 * ## Gate 2 — no ACTIVE location
 *
 * Rules choose BETWEEN locations, so with none there is nothing to rank and
 * every rule would decide nothing. The gate reads the `listActiveLocations`
 * probe (`status=active&limit=1`, where only `total` is meaningful) rather than
 * counting active rows inside the picker's capped page: an install whose first
 * 200 rows are all retired would otherwise be refused while active locations
 * exist. The picker keeps the full-status page, because an inactive location is
 * still a legitimate priority entry.
 *
 * Its remedy is the bootstrap, not a link: there is no locations screen yet, so
 * a button promising one would land the operator back where they started.
 *
 * @module apps/web/src/pages/oms
 */
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useActiveLocationCountQuery, useBootstrapLocationsMutation } from '../../features/inventory';
import {
  SourcingRulesSection,
  SOURCING_RULES_PAGE_COPY as COPY,
  useInventoryLocationsForRulesQuery,
} from '../../features/oms';
import { useDemoMode } from '../../features/system';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../shared/config/demo-mode';
import { useIsAdmin, useWriteAccess } from '../../shared/auth/use-permission';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

/** The discriminator `createOmsFulfillmentRouterResolver` uses (ADR-055). */
const OMS_PLATFORM_TYPE = 'openlinker';

export function SourcingRulesPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const requestedConnectionId = searchParams.get('connectionId');

  const connectionsQuery = useConnectionsQuery();
  const locationsQuery = useInventoryLocationsForRulesQuery();
  const activeLocationCountQuery = useActiveLocationCountQuery();
  const bootstrap = useBootstrapLocationsMutation();

  const demoMode = useDemoMode();
  // Paired with the role because `POST /inventory/locations/bootstrap` is
  // `@Roles('admin')` while `inventory:write` is also held by `operator` —
  // gating on the permission alone renders a control that answers 403.
  const write = useWriteAccess('inventory:write', demoMode);
  const isAdmin = useIsAdmin();
  const canBootstrap = write.canWrite && isAdmin;

  const shell = (children: ReactElement): ReactElement => (
    <PageLayout
      eyebrow={COPY.crumbGroup}
      title={COPY.crumbTitle}
      description={COPY.description}
      backTo={{ to: '/settings', label: COPY.backToSettings }}
    >
      {children}
    </PageLayout>
  );

  if (
    connectionsQuery.isLoading ||
    locationsQuery.isLoading ||
    activeLocationCountQuery.isLoading
  ) {
    return shell(<LoadingState title={COPY.loadingTitle} message={COPY.loadingMessage} />);
  }

  if (connectionsQuery.error || locationsQuery.error || activeLocationCountQuery.error) {
    return shell(
      <ErrorState
        title={COPY.errorTitle}
        message={COPY.errorMessage}
        action={
          <Button
            tone="secondary"
            onClick={() => {
              void connectionsQuery.refetch();
              void locationsQuery.refetch();
              void activeLocationCountQuery.refetch();
            }}
          >
            {COPY.errorRetry}
          </Button>
        }
      />
    );
  }

  const connections = connectionsQuery.data ?? [];
  const omsConnections = connections.filter(
    (connection) => connection.platformType === OMS_PLATFORM_TYPE
  );

  // An explicit `?connectionId=` is honoured so a link from a connection page
  // lands somewhere truthful; it is validated rather than trusted, because a
  // ruleset authored against a non-OMS connection would never be read.
  const connection =
    requestedConnectionId === null
      ? omsConnections[0]
      : omsConnections.find((candidate) => candidate.id === requestedConnectionId);

  if (connection === undefined) {
    // A named connection can only be the WRONG one if there was a right one to
    // compare it against. With no OMS connection at all the true fact is that
    // the OMS is not enabled, whatever the URL asked for.
    const named = requestedConnectionId !== null && omsConnections.length > 0;
    return shell(
      <EmptyState
        eyebrow={COPY.notAvailableEyebrow}
        title={named ? COPY.wrongConnectionTitle : COPY.noOmsTitle}
        message={named ? COPY.wrongConnectionMessage : COPY.noOmsMessage}
        action={
          <Link className="button button--secondary button--sm" to="/connections">
            {COPY.goToConnections}
          </Link>
        }
      />
    );
  }

  if ((activeLocationCountQuery.data ?? 0) === 0) {
    return shell(
      <>
        <EmptyState
          eyebrow={COPY.noLocationsEyebrow}
          title={COPY.noLocationsTitle}
          // The bootstrap's own caveats are stated only where the button is
          // actually offered; describing a control the session cannot see is
          // the same dead end as naming a screen that does not exist.
          message={
            write.visible
              ? `${COPY.noLocationsMessage} ${COPY.createLocationHint}`
              : `${COPY.noLocationsMessage} ${COPY.createLocationAdminOnly}`
          }
          action={
            write.visible ? (
              <Button
                disabled={!canBootstrap || bootstrap.isPending}
                title={
                  write.demoReadOnly
                    ? DEMO_READ_ONLY_ACTION_MESSAGE
                    : !isAdmin
                      ? COPY.createLocationAdminOnly
                      : undefined
                }
                onClick={() => {
                  bootstrap.reset();
                  // The shared mutation invalidates the active-location count,
                  // which is what re-opens this gate. The picker's own page is
                  // keyed separately, so it is refetched here rather than left
                  // holding the empty list the operator just fixed.
                  bootstrap.mutate(undefined, {
                    onSuccess: () => void locationsQuery.refetch(),
                  });
                }}
              >
                {bootstrap.isPending ? COPY.creatingLocation : COPY.createLocation}
              </Button>
            ) : undefined
          }
        />
        {bootstrap.error ? (
          <ErrorState title={COPY.createLocationErrorTitle} message={bootstrap.error.message} />
        ) : null}
      </>
    );
  }

  const locationsPage = locationsQuery.data ?? { options: [], total: 0 };
  const truncated = locationsPage.total > locationsPage.options.length;

  return shell(
    <>
      {truncated ? (
        <Alert tone="warning" title={COPY.locationsTruncatedTitle}>
          {COPY.locationsTruncated(locationsPage.options.length, locationsPage.total)}
        </Alert>
      ) : null}
      <SourcingRulesSection connectionId={connection.id} locations={locationsPage.options} />
    </>
  );
}
