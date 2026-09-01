/**
 * Fiscal registration poll interval (#1909)
 *
 * Pure helper answering "should the order's registration list keep polling?".
 * Extracted from `useOrderFiscalRegistrationsQuery` so the rule is assertable
 * without mounting a query harness — the rule is the point, not the wiring.
 *
 * Only `registering` polls. It is the one status backed by a live lease, i.e.
 * the only one with a provider call actually in flight for a refetch to observe.
 * A `pending` row was created but never claimed and never sent, so polling it
 * every few seconds forever describes something that is not happening; the
 * operator's own "Register receipt" action is what moves it. The two terminal
 * statuses need no poll at all.
 *
 * @module apps/web/src/features/fiscalization/lib
 */
import type {
  FiscalRegistrationProgress,
  FiscalRegistrationStatus,
} from '../api/fiscalization.types';

/** Poll cadence while a registration is genuinely in flight. */
export const FISCAL_POLL_MS = 5000;

/**
 * Refetch interval for the newest record's status, or `false` when nothing is
 * in flight. An absent status (empty list, not yet loaded) never polls.
 */
export function fiscalPollInterval(status: FiscalRegistrationStatus | undefined): number | false {
  return status === 'registering' ? FISCAL_POLL_MS : false;
}

/**
 * Refetch interval for the per-order registration progress read (#2527).
 *
 * `queued` and `running` are the two states with work outstanding, and both must
 * poll: `queued` covers the window between the request being accepted and the
 * job running, which is precisely the window the operator is watching and the
 * one the record cannot describe.
 *
 * `stalled` and `interrupted` do NOT poll. Nothing is running in either, so
 * refetching would describe something that is not happening; only asking again
 * moves them. The three terminal states need no poll either.
 *
 * An absent progress value (not yet loaded) does not poll.
 */
export function fiscalProgressPollInterval(
  progress: FiscalRegistrationProgress | undefined,
): number | false {
  return progress === 'queued' || progress === 'running' ? FISCAL_POLL_MS : false;
}
