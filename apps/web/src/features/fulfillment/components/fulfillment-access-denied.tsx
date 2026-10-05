/**
 * The fulfilment screens' "no access" state (#3096, F-9)
 *
 * The board and the task detail are supervisors' screens: `orders:write`,
 * held by admin and operator. A viewer used to reach both by URL and meet a
 * 403'd roster, a lane of "No longer a packer", or "Could not load this
 * fulfilment task [Retry]" — an outage that was really a role. This renders
 * the role fact instead, with no Retry.
 *
 * A session whose work is the bench (it holds `bench:write` and not
 * `orders:write`) is also given the way there. The app layout already sends a
 * bench-only session to `/bench` before any of this renders, so this branch is
 * the belt to that braces — a session that somehow lands here is still pointed
 * at the right screen rather than at nothing.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { usePermission } from '../../../shared/auth/use-permission';
import { BENCH_PATH } from '../../../shared/auth/session-surface';
import { AccessDeniedState } from '../../../shared/ui/feedback-state';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

export interface FulfillmentAccessDeniedProps {
  /** The screen's own refusal; the bench variant is shared by both screens. */
  copy: { readonly title: string; readonly message: string };
}

export function FulfillmentAccessDenied({ copy }: FulfillmentAccessDeniedProps): ReactElement {
  // Bench-only: may work the bench and may not supervise. An operator holds
  // both, and still meets this state when a read is refused mid-session (a
  // role change), so `bench:write` alone must not pick the bench variant.
  const worksTheBench = usePermission('bench:write');
  const supervises = usePermission('orders:write');
  const bench = FULFILLMENT_WORK_DETAIL_COPY.states.deniedBench;

  if (worksTheBench && !supervises) {
    return (
      <AccessDeniedState
        title={bench.title}
        message={bench.message}
        action={
          <Link className="button button--primary" to={BENCH_PATH}>
            {bench.action}
          </Link>
        }
      />
    );
  }

  return <AccessDeniedState title={copy.title} message={copy.message} />;
}
