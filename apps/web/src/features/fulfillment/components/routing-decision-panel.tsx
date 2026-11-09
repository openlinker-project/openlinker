/**
 * Routing decision panel (#3557, epic #3511)
 *
 * The order-detail statement of how OpenLinker's attempt to choose where an
 * order is packed stands. Three states, read only (D4):
 *
 *   - `stuck`    - the router never gave a final answer and the time limit has
 *                  passed; the reaper has not run yet. Says OpenLinker is WAITING
 *                  for the router's own answer, with how long and the limit.
 *   - `resolved` - the reaper closed the stuck attempt. The body says routing is
 *                  running again, or - when the order is held `routing-failed`,
 *                  the reaper's fallback when no re-route could start - that it
 *                  could not start again; never "routed again" either way. Offers
 *                  "Retry routing" (only while the order is held in a state the
 *                  endpoint accepts) and reports its outcome.
 *   - `healthy`  - routed automatically.
 *
 * There is deliberately NO control that forces, checks or abandons a decision:
 * closing a live one early could let a second attempt ship the order twice.
 *
 * ## Four read outcomes, none reported as another
 *
 * Loading renders a quiet line, a FAILED read renders an error with a retry of
 * the READ, "no decision" and "nothing to say" render nothing - never a claim
 * that the order was or was not routed.
 *
 * The time limit shown is `ttlMs` from the read endpoint, never a constant here.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { formatDurationMs } from '../../../shared/format/format-duration-ms';
import { interpolate, useMessages } from '../../../shared/i18n';
import { useConnectionQuery } from '../../connections';
import { useDemoMode } from '../../system';
import { useRetryOrderRoutingMutation } from '../hooks/use-retry-order-routing-mutation';
import { useRoutingDecisionQuery } from '../hooks/use-routing-decision-query';
import { describeRetryRoutingError } from '../lib/routing-decision-retry-error';
import { canRetryRouting, resolveRoutingDecisionState } from '../lib/routing-decision-state';

export interface RoutingDecisionPanelProps {
  internalOrderId: string;
  /** The order's persisted hold reason, used only to decide whether Retry is offered. */
  orderBlockReason: string | null | undefined;
  /** False when routing is not switched on: no read is made and nothing renders. */
  enabled: boolean;
}

export function RoutingDecisionPanel({
  internalOrderId,
  orderBlockReason,
  enabled,
}: RoutingDecisionPanelProps): ReactElement | null {
  const messages = useMessages('fulfillment');
  const routingCopy = messages.routingDecision;
  const panelCopy = messages.routingDecisionPanel;
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const query = useRoutingDecisionQuery(internalOrderId, { enabled });
  const retry = useRetryOrderRoutingMutation();
  const decision = query.data ?? null;
  // The router's name is a nicety: a pending or failed lookup degrades to a
  // generic phrase, never to a raw id standing alone.
  const router = useConnectionQuery(decision?.routerConnectionId ?? '', {
    enabled: decision !== null,
  });

  if (!enabled) return null;
  if (query.isPending) return null;

  if (query.isError) {
    return (
      <Alert
        tone="error"
        data-testid="routing-decision-panel"
        action={
          <Button tone="secondary" className="button--sm" onClick={() => void query.refetch()}>
            {panelCopy.retry}
          </Button>
        }
      >
        {routingCopy.readFailed}
      </Alert>
    );
  }

  const state = resolveRoutingDecisionState(decision);
  if (decision === null || state === null) return null;

  const routerName = router.data?.name ?? panelCopy.routerFallback;

  if (state === 'healthy') {
    return (
      <p className="text-muted" data-testid="routing-decision-panel" data-mk-state="healthy">
        {routingCopy.healthy.title}
      </p>
    );
  }

  if (state === 'stuck') {
    const age = formatDurationMs(decision.ageMs);
    const limit = formatDurationMs(decision.ttlMs);
    return (
      <div data-testid="routing-decision-panel" data-mk-state="stuck">
        <Alert tone="warning" title={routingCopy.stuck.title}>
          <p>{routingCopy.stuck.body}</p>
          <p className="mono-text">
            {[
              age !== null ? interpolate(panelCopy.waitingFor, { age }) : panelCopy.waiting,
              limit !== null ? interpolate(panelCopy.timeLimit, { limit }) : null,
              interpolate(panelCopy.router, { name: routerName }),
            ]
              .filter((part): part is string => part !== null)
              .join(' · ')}
          </p>
        </Alert>
      </div>
    );
  }

  const offerRetry = write.visible && canRetryRouting(orderBlockReason);
  const handleRetry = (): void => {
    retry.mutate(internalOrderId, {
      onSuccess: () => {
        showToast({ tone: 'success', description: routingCopy.retry.started });
      },
    });
  };

  return (
    <div data-testid="routing-decision-panel" data-mk-state="resolved">
    <Alert
      tone="info"
      title={routingCopy.resolved.title}
      action={
        offerRetry ? (
          <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
            <Button
              tone="secondary"
              className="button--sm"
              data-testid="routing-decision-retry"
              disabled={retry.isPending || write.demoReadOnly}
              onClick={handleRetry}
            >
              {retry.isPending
                ? routingCopy.retry.pending
                : routingCopy.retry.action}
            </Button>
          </ReadOnlyLock>
        ) : undefined
      }
    >
      <p>
        {orderBlockReason === 'routing-failed'
          ? routingCopy.resolved.bodyNotRestarted
          : routingCopy.resolved.body}
      </p>
      {retry.error ? (
        <p role="alert" data-testid="routing-decision-retry-error">
          {describeRetryRoutingError(retry.error)}
        </p>
      ) : null}
    </Alert>
    </div>
  );
}
