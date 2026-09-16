/**
 * Orphan Returns Worklist (#3078/#3081)
 *
 * Two groups an operator can act on directly, each with exactly ONE primary
 * action per row — the acceptance criterion this file exists to satisfy.
 *
 * **"Needs an order"** is the orphan bucket (`bucket === 'orphan'`), read with
 * an exact server-side filter — `RETURN_BUCKET_VALUES` names it, so this group
 * can never miss a row or include one that does not belong.
 *
 * **"Waiting for your OK"** has no server-side filter at all: nothing in
 * `ReturnFilters` narrows by `origin` or `authorizedAt`, because the backend
 * contract this epic wires up (#2372/#2376) was never asked to grow one. This
 * group therefore reads the `attributed` bucket at the API's own page-size
 * ceiling (`RETURNS_MAX_LIMIT`) and filters CLIENT-SIDE for
 * `origin === 'operator_authored' && authorizedAt === null`. That is an
 * approximation, not a bug worth hiding: a truncated page is disclosed with a
 * caveat rather than a precise count, because the client-side filter cannot
 * say how many of the rows past the page boundary would also qualify.
 *
 * **The primary action is a `Link` to the return's own detail page, never an
 * inline dialog.** `return-orphan-banner.tsx`'s docblock records that a match
 * action had nowhere to live before this epic; #3082/#3083 are what give the
 * detail page real match/approve affordances. Routing there rather than
 * duplicating those flows here means this component works today AND still
 * works, unchanged, once those two land — the destination gains the dialog,
 * not this list.
 *
 * Two independent queries, two independent four-state reads (loading / error /
 * unreadable envelope / confirmed-empty) — matching `order-returns-panel.tsx`'s
 * discipline that a failed read must never render as "nothing needs
 * attention", which is a claim about the operator's own data this component is
 * not entitled to make on a failure.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useReturnsQuery } from '../hooks/use-returns-query';
import { RETURNS_MAX_LIMIT } from '../api/returns.types';
import type { ReturnListItem } from '../api/returns.types';
import { ORPHAN_RETURNS_WORKLIST_COPY as COPY } from '../lib/orphan-returns-worklist.copy';

/** One page. Exact filter, so the count IS the whole story past this page. */
const NEEDS_ORDER_LIMIT = 20;

interface WorklistGroupProps {
  title: string;
  description: string;
  actionLabel: string;
  items: ReturnListItem[];
  isLoading: boolean;
  isError: boolean;
  isEnvelopeUnreadable: boolean;
  emptyMessage: string;
  truncationNote: string | null;
  onRetry: () => void;
}

function WorklistGroup({
  title,
  description,
  actionLabel,
  items,
  isLoading,
  isError,
  isEnvelopeUnreadable,
  emptyMessage,
  truncationNote,
  onRetry,
}: WorklistGroupProps): ReactElement {
  return (
    <section className="orphan-returns-worklist__group" aria-label={title}>
      <h3 className="orphan-returns-worklist__group-title">{title}</h3>
      <p className="text-muted orphan-returns-worklist__group-description">{description}</p>

      {isLoading ? (
        <LoadingState liveRegion="off" title={COPY.loading} />
      ) : isError ? (
        <ErrorState
          title={COPY.errorTitle}
          message={COPY.errorMessage}
          action={<Button onClick={onRetry}>{COPY.retry}</Button>}
        />
      ) : isEnvelopeUnreadable ? (
        <ErrorState title={COPY.unreadableTitle} message={COPY.unreadableMessage} />
      ) : items.length === 0 ? (
        <p className="text-muted">{emptyMessage}</p>
      ) : (
        <>
          <ul className="orphan-returns-worklist__list">
            {items.map((item) => (
              <li key={item.id} className="orphan-returns-worklist__row">
                <span className="mono-text">{item.externalReturnId ?? item.id}</span>
                <Link
                  to={`/returns/${item.id}`}
                  className="button button--secondary button--sm"
                >
                  {actionLabel}
                </Link>
              </li>
            ))}
          </ul>
          {truncationNote !== null ? <p className="text-muted">{truncationNote}</p> : null}
        </>
      )}
    </section>
  );
}

export function OrphanReturnsWorklist(): ReactElement {
  const needsOrderQuery = useReturnsQuery(
    { bucket: 'orphan' },
    { limit: NEEDS_ORDER_LIMIT, offset: 0 },
  );

  // No server-side filter exists for "operator-authored, not yet approved" —
  // see the module docblock. Reading at the API's own ceiling is the best this
  // component can do without a backend change this epic never asked for.
  const approvalScanQuery = useReturnsQuery(
    { bucket: 'attributed' },
    { limit: RETURNS_MAX_LIMIT, offset: 0 },
  );

  const needsOrderResult = needsOrderQuery.data ?? null;
  const needsOrderItems = needsOrderResult?.items ?? [];

  const approvalScanResult = approvalScanQuery.data ?? null;
  const needsApprovalItems = (approvalScanResult?.items ?? []).filter(
    (item) => item.origin === 'operator_authored' && item.authorizedAt === null,
  );
  const approvalScanTruncated =
    approvalScanResult !== null && approvalScanResult.total > approvalScanResult.items.length;

  return (
    <div className="orphan-returns-worklist">
      <h2 className="section-title">{COPY.sectionTitle}</h2>

      <WorklistGroup
        title={COPY.needsOrderTitle}
        description={COPY.needsOrderDescription}
        actionLabel={COPY.needsOrderAction}
        items={needsOrderItems}
        isLoading={needsOrderQuery.isLoading}
        isError={needsOrderQuery.error !== null}
        isEnvelopeUnreadable={needsOrderResult?.envelopeUnreadable ?? false}
        emptyMessage={COPY.needsOrderEmpty}
        truncationNote={null}
        onRetry={() => {
          void needsOrderQuery.refetch();
        }}
      />

      <WorklistGroup
        title={COPY.needsApprovalTitle}
        description={COPY.needsApprovalDescription}
        actionLabel={COPY.needsApprovalAction}
        items={needsApprovalItems}
        isLoading={approvalScanQuery.isLoading}
        isError={approvalScanQuery.error !== null}
        isEnvelopeUnreadable={approvalScanResult?.envelopeUnreadable ?? false}
        emptyMessage={COPY.needsApprovalEmpty}
        truncationNote={approvalScanTruncated ? COPY.approvalScanTruncated : null}
        onRetry={() => {
          void approvalScanQuery.refetch();
        }}
      />
    </div>
  );
}
