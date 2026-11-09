import type { ReactElement } from 'react';
import { renderRich, useFormat, useMessages } from '../../../shared/i18n';
import {
  useActiveLocationCountQuery,
  useBootstrapLocationsMutation,
} from '../../inventory';
import { useOmsRoutingState } from '../../fulfillment-authority';
import { useWriteAccess, useIsAdmin } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';

/**
 * Routing readiness panel (#2407, REVIEW D3).
 *
 * Fulfilment routing needs at least one active inventory location, and
 * `inventory_locations` ships empty on every install with nothing seeding it.
 * Enabling routing against zero locations therefore refuses with a 400 — this
 * panel is where that refusal stops being a dead end and becomes an offer.
 *
 * **The fact is install-wide, not per connection.** Locations belong to the
 * deployment, so the read carries no connection axis and two connection pages
 * share one cache entry. The panel is mounted per connection because that is
 * where routing is switched on, not because the answer differs by connection.
 *
 * **The degraded state is REPORTED, never claimed as an invariant.** The guard
 * is enable-time only: deleting the last location, or switching it inactive,
 * takes an already-enabled install back to zero. Enforcing at those writes
 * would put a routing rule inside the inventory context, a cross-context edge
 * ADR-053 forbids — and the degenerate state is safe, not corrupt. So the panel
 * says what is true in plain terms: routing is on and is currently deciding
 * nothing, which is a setup detail with a one-click remedy, not a silent
 * failure. Saying "routing is inert" and stopping there would be the operator-
 * hostile reading this whole issue exists to remove.
 *
 * **The ready state does not promise routing will now succeed.** A minted
 * location holds no stock: `locationId IS NULL` on a position permanently means
 * the master declines to locate its stock (ADR-058 decision 2), and no minted
 * row is ever a stand-in for that. The copy says the location still needs stock
 * assigned rather than implying the problem is solved.
 *
 * Copy avoids the words banned by epic #2412's P9 rule (authority, posture,
 * phase, gateway, holder, FulfillmentWork). Note `check-ui-vocabulary.mjs` does
 * NOT scan `features/connections`, so that is honoured here by review, not by
 * CI — stated rather than assumed.
 */

const READY_TONE: StatusBadgeTone = 'success';
/**
 * `warning` is reserved for the DEGRADED state — routing switched on with
 * nowhere to send an order. A never-configured install is an unstarted setup
 * step, not something wrong, and colouring it amber says otherwise.
 */
const DEGRADED_TONE: StatusBadgeTone = 'warning';
const UNCONFIGURED_TONE: StatusBadgeTone = 'neutral';

export function RouterReadinessPanel(): ReactElement {
  const copy = useMessages('connections').routerReadinessPanel;
  const format = useFormat();
  const countQuery = useActiveLocationCountQuery();
  const omsRouting = useOmsRoutingState();
  const bootstrap = useBootstrapLocationsMutation();

  const demoMode = useDemoMode();
  // Paired with the role because the route is `@Roles('admin')` while
  // `inventory:write` is also held by `operator` — gating on the permission
  // alone renders a control that answers 403.
  const write = useWriteAccess('inventory:write', demoMode);
  const isAdmin = useIsAdmin();
  const canAct = write.canWrite && isAdmin;

  if (countQuery.isLoading) {
    return (
      <div className="panel panel--dense">
        <LoadingState
          title={copy.loadingTitle}
          message={copy.loadingMessage}
        />
      </div>
    );
  }

  if (countQuery.error) {
    return (
      <div className="panel panel--dense">
        <ErrorState
          title={copy.errorTitle}
          message={countQuery.error.message}
          action={
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void countQuery.refetch()}
            >
              {copy.retry}
            </button>
          }
        />
      </div>
    );
  }

  const activeLocations = countQuery.data ?? 0;
  const hasLocation = activeLocations > 0;
  // `default` is the one state that means nothing claims routing. Read from the
  // shipped status projection rather than re-derived from connection config —
  // a second reader of that config in the browser would be a mirror of a rule
  // that lives in core.
  // Three states, not two. "Not known yet" is not "not claimed": while this read
  // is in flight — or if it failed — asserting the pre-enable copy would tell an
  // operator whose routing is already ON that it cannot be switched on. Same
  // principle `AccessGate` applies to the session-hydration window.
  const routingClaimed: boolean | undefined =
    omsRouting === 'on' ? true : omsRouting === 'off' ? false : undefined;

  // Nothing to say: the precondition is met and nothing claims routing on this
  // install. Rendering "routing can be switched on" on every connection's health
  // tab — including connections that will never route — is noise, and for a
  // READINESS panel absence correctly reads as "nothing to do here". Every state
  // that is actionable, or that confirms a claim the operator made, still renders.
  if (hasLocation && routingClaimed !== true) {
    return <></>;
  }

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <StatusBadge
          tone={
            hasLocation
              ? READY_TONE
              : routingClaimed === true
                ? DEGRADED_TONE
                : UNCONFIGURED_TONE
          }
        >
          {hasLocation ? copy.locationReady : copy.noLocation}
        </StatusBadge>
      </div>

      <dl className="definition-list">
        <div>
          <dt>{copy.activeLocations}</dt>
          <dd>{format.number(activeLocations)}</dd>
        </div>
      </dl>

      {hasLocation ? (
        <p className="router-readiness-panel__note">
          {copy.notes.ready}
        </p>
      ) : routingClaimed === true ? (
        <p className="router-readiness-panel__note">
          {copy.notes.onWithoutLocation}
        </p>
      ) : routingClaimed === false ? (
        <p className="router-readiness-panel__note">
          {copy.notes.offWithoutLocation}
        </p>
      ) : (
        <p className="router-readiness-panel__note">
          {copy.notes.unknown}
        </p>
      )}

      {!hasLocation && write.visible ? (
        <>
          <button
            type="button"
            className="button button--primary"
            disabled={!canAct || bootstrap.isPending}
            title={
              write.demoReadOnly
                ? demoReadOnlyActionMessage()
                : // The route is admin-only while `inventory:write` is also an
                  // operator permission, so this button can be disabled for a
                  // session that genuinely holds the permission. Say which.
                  !isAdmin
                  ? copy.adminOnly
                  : undefined
            }
            onClick={() => {
              bootstrap.reset();
              bootstrap.mutate();
            }}
          >
            {bootstrap.isPending ? copy.creating : copy.createDefault}
          </button>
          <p className="router-readiness-panel__note">
            {renderRich(copy.createHint, { code: (text) => <code>{text}</code> })}
          </p>
        </>
      ) : null}

      {bootstrap.error ? (
        <ErrorState title={copy.createErrorTitle} message={bootstrap.error.message} />
      ) : null}
    </div>
  );
}
