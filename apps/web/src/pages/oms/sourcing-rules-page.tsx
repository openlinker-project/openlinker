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
 * 100 rows are all retired would otherwise be refused while active locations
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
  SourcingRulesTestPanel,
  useInventoryLocationsForRulesQuery,
} from '../../features/oms';
import { useDemoMode } from '../../features/system';
import { demoReadOnlyActionMessage } from '../../shared/config/demo-mode';
import { useIsAdmin, useWriteAccess } from '../../shared/auth/use-permission';
import { interpolate, useMessages } from '../../shared/i18n';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { findOmsConnections } from './oms-connection';
import { describeApiError } from '../../shared/api/describe-api-error';

export function SourcingRulesPage(): ReactElement {
  const copy = useMessages('oms-core').sourcingRulesPage;
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
      eyebrow={copy.crumbGroup}
      title={copy.crumbTitle}
      description={copy.description}
      backTo={{ to: '/settings', label: copy.backToSettings }}
    >
      {children}
    </PageLayout>
  );

  if (
    connectionsQuery.isLoading ||
    locationsQuery.isLoading ||
    activeLocationCountQuery.isLoading
  ) {
    return shell(<LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />);
  }

  if (connectionsQuery.error || locationsQuery.error || activeLocationCountQuery.error) {
    return shell(
      <ErrorState
        title={copy.errorTitle}
        message={copy.errorMessage}
        action={
          <Button
            tone="secondary"
            onClick={() => {
              void connectionsQuery.refetch();
              void locationsQuery.refetch();
              void activeLocationCountQuery.refetch();
            }}
          >
            {copy.errorRetry}
          </Button>
        }
      />
    );
  }

  const connections = connectionsQuery.data ?? [];
  const omsConnections = findOmsConnections(connections);

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
        eyebrow={copy.notAvailableEyebrow}
        title={named ? copy.wrongConnectionTitle : copy.noOmsTitle}
        message={named ? copy.wrongConnectionMessage : copy.noOmsMessage}
        action={
          <Link className="button button--secondary button--sm" to="/connections">
            {copy.goToConnections}
          </Link>
        }
      />
    );
  }

  if ((activeLocationCountQuery.data ?? 0) === 0) {
    return shell(
      <>
        <EmptyState
          eyebrow={copy.noLocationsEyebrow}
          title={copy.noLocationsTitle}
          // The bootstrap's own caveats are stated only where the button is
          // actually offered; describing a control the session cannot see is
          // the same dead end as naming a screen that does not exist.
          message={
            <>
              {copy.noLocationsMessage}{' '}
              {write.visible ? copy.createLocationHint : copy.createLocationAdminOnly}
            </>
          }
          action={
            write.visible ? (
              <Button
                disabled={!canBootstrap || bootstrap.isPending}
                title={
                  write.demoReadOnly
                    ? demoReadOnlyActionMessage()
                    : !isAdmin
                      ? copy.createLocationAdminOnly
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
                {bootstrap.isPending ? copy.creatingLocation : copy.createLocation}
              </Button>
            ) : undefined
          }
        />
        {bootstrap.error ? (
          <ErrorState
            title={copy.createLocationErrorTitle}
            message={describeApiError(bootstrap.error, 'oms-core')}
          />
        ) : null}
      </>
    );
  }

  const locationsPage = locationsQuery.data ?? { options: [], total: 0 };
  const truncated = locationsPage.total > locationsPage.options.length;

  return shell(
    <>
      {truncated ? (
        <Alert tone="warning" title={copy.locationsTruncatedTitle}>
          {interpolate(copy.locationsTruncated, {
            shown: locationsPage.options.length,
            total: locationsPage.total,
          })}
        </Alert>
      ) : null}
      <SourcingRulesSection connectionId={connection.id} locations={locationsPage.options} />
      <SourcingRulesTestPanel connectionId={connection.id} locations={locationsPage.options} />
    </>
  );
}
