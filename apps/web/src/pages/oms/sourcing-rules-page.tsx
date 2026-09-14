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
 * two causes are told apart, because "you are looking at the wrong connection"
 * and "the OMS is not enabled" have different remedies.
 *
 * ## Gate 2 — no locations
 *
 * Rules choose BETWEEN locations, so with none there is nothing to rank and
 * every rule would decide nothing. The gate asks about ACTIVE locations, since
 * a ruleset that can only rank retired warehouses is the same degenerate state.
 *
 * @module apps/web/src/pages/oms
 */
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import {
  SourcingRulesSection,
  SOURCING_RULES_PAGE_COPY as COPY,
  useInventoryLocationsForRulesQuery,
} from '../../features/oms';
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

  if (connectionsQuery.isLoading || locationsQuery.isLoading) {
    return shell(<LoadingState title={COPY.loadingTitle} message={COPY.loadingMessage} />);
  }

  if (connectionsQuery.error || locationsQuery.error) {
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
            }}
          >
            Retry
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
    const named = requestedConnectionId !== null;
    return shell(
      <EmptyState
        eyebrow="Not available here"
        title={named ? COPY.wrongConnectionTitle : COPY.noOmsTitle}
        message={named ? COPY.wrongConnectionMessage : COPY.noOmsMessage}
        action={
          <Link className="button button--secondary button--sm" to="/connections">
            Go to connections
          </Link>
        }
      />
    );
  }

  const locations = locationsQuery.data ?? [];
  if (locations.filter((location) => location.isActive).length === 0) {
    return shell(
      <EmptyState
        eyebrow="No locations"
        title={COPY.noLocationsTitle}
        message={COPY.noLocationsMessage}
        action={
          <Link className="button button--secondary button--sm" to="/settings">
            {COPY.manageLocations}
          </Link>
        }
      />
    );
  }

  return shell(
    <SourcingRulesSection connectionId={connection.id} locations={locations} />
  );
}
