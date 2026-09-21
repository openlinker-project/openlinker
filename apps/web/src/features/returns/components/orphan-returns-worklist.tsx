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
 * **"Needs an order" is an EXACT filter, so its truncation notice states both
 * numbers — it must NOT skip disclosure just because the filter is precise.**
 * `order-returns-panel.tsx` discloses the identical "single page, exact
 * filter" shape (`result.total > PANEL_PAGE_SIZE`); an orphan return blocks
 * every downstream trigger, so silently capping this group at one page would
 * let an operator believe the queue is clear while more sit unshown.
 *
 * **"Needs an order"'s primary action stays a `Link` to the return's own
 * detail page.** `return-orphan-banner.tsx`'s docblock records that a match
 * action had nowhere to live before this epic; #3082 is what gives the
 * detail page a real match affordance. Routing there rather than duplicating
 * that flow here means this row works today AND still works, unchanged, once
 * #3082 lands — the destination gains the dialog, not this list.
 *
 * **"Waiting for your OK"'s primary action instead opens
 * `AuthorizeReturnDialog` inline** (#3083) — that write carries no form
 * (`POST .../authorize` takes nothing beyond the return id), so there is no
 * detail-page destination this group needs to defer to. Confirming needs no
 * manual row-removal here: `useAuthorizeReturnMutation`'s own `onSettled`
 * invalidates `returnsQueryKeys.all`, so this group's own
 * `bucket: 'attributed'` scan refetches and the now-approved return stops
 * matching `authorizedAt === null` — the acceptance criterion is satisfied by
 * cache invalidation, not by this component splicing an array.
 *
 * Two independent queries, two independent four-state reads (loading / error /
 * unreadable envelope / confirmed-empty) — matching `order-returns-panel.tsx`'s
 * discipline that a failed read must never render as "nothing needs
 * attention", which is a claim about the operator's own data this component is
 * not entitled to make on a failure.
 *
 * **The "Approve" row action is gated on `orders:write`, the same permission
 * `POST /returns/:returnId/authorize` enforces server-side** (tech-lead
 * review on #3283, IMPORTANT). Without it, a `viewer`/`packer` session saw an
 * enabled button that answered 403 as the generic "try again" error — advice
 * that cannot work, because retrying does not change the session's role.
 * `return-decline-action.tsx` is the precedent this mirrors: hidden entirely
 * for a session with no write access at all, disabled with a `ReadOnlyLock`
 * tooltip for a demo read-only viewer. "Needs an order"'s `Link` is left
 * ungated — it is navigation to a read surface, not a write.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useReturnsQuery } from '../hooks/use-returns-query';
import { RETURNS_MAX_LIMIT, RETURNS_PAGE_SIZE } from '../api/returns.types';
import type { ReturnListItem } from '../api/returns.types';
import { AuthorizeReturnDialog } from './authorize-return-dialog';
// Cross-feature import goes through the system barrel — the same route
// `price-changes-queue-table.tsx` already takes into `../../system`.
import { useDemoMode } from '../../system';
import { ORPHAN_RETURNS_WORKLIST_COPY as COPY } from '../lib/orphan-returns-worklist.copy';
import { describeUnreadableRows } from '../lib/returns-list.copy';

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
  /**
   * Rows this build could not parse individually — distinct from
   * `truncationNote`, which discloses rows past the page boundary.
   * `order-returns-panel.tsx` surfaces this whenever items exist; omitting
   * it here would silently drop a row this component's own docblock
   * elsewhere promises never to hide.
   */
  droppedCount: number;
  onRetry: () => void;
  /**
   * Overrides the default `Link`-to-detail row action. Only "Waiting for
   * your OK" supplies one — the confirm-only authorize dialog has no
   * detail-page destination to defer to.
   */
  renderAction?: (item: ReturnListItem) => ReactNode;
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
  droppedCount,
  onRetry,
  renderAction,
}: WorklistGroupProps): ReactElement {
  const titleId = `orphan-returns-worklist__group-title-${title.replace(/\s+/g, '-').toLowerCase()}`;
  // `droppedCount` and `truncationNote` are facts about the READ, not about the
  // rows, so they must survive a zero-row result — a truncated or
  // partially-unreadable page must never render as a confirmed-empty list
  // (tech-lead review on #3280, BLOCKING + IMPORTANT). The confirmed-empty
  // message is therefore withheld whenever either fact is present: it asserts
  // "nothing needs attention", and that claim is unavailable off a page this
  // build knows was incomplete.
  const isConfirmedEmpty = items.length === 0 && droppedCount === 0 && truncationNote === null;

  return (
    <section className="orphan-returns-worklist__group" aria-labelledby={titleId}>
      <h3 id={titleId} className="orphan-returns-worklist__group-title">
        {title}
      </h3>
      <p className="text-muted orphan-returns-worklist__group-description">{description}</p>

      {isLoading ? (
        <LoadingState liveRegion="off" title={COPY.loading} message={COPY.loadingMessage} />
      ) : isError ? (
        <ErrorState
          title={COPY.errorTitle}
          message={COPY.errorMessage}
          action={<Button onClick={onRetry}>{COPY.retry}</Button>}
        />
      ) : isEnvelopeUnreadable ? (
        <ErrorState title={COPY.unreadableTitle} message={COPY.unreadableMessage} />
      ) : (
        <>
          {items.length > 0 ? (
            <ul className="orphan-returns-worklist__list">
              {items.map((item) => (
                <li key={item.id} className="orphan-returns-worklist__row">
                  <span className="mono-text">{item.externalReturnId ?? item.id}</span>
                  {renderAction ? (
                    renderAction(item)
                  ) : (
                    <Link
                      to={`/returns/${item.id}`}
                      className="button button--secondary button--sm"
                    >
                      {actionLabel}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : isConfirmedEmpty ? (
            <p className="text-muted">{emptyMessage}</p>
          ) : null}
          {droppedCount > 0 ? (
            <p className="text-muted">{describeUnreadableRows(droppedCount)}</p>
          ) : null}
          {truncationNote !== null ? <p className="text-muted">{truncationNote}</p> : null}
        </>
      )}
    </section>
  );
}

export function OrphanReturnsWorklist(): ReactElement {
  // The one return currently offered the authorize dialog, or null. A single
  // slot is enough: only one row's dialog can be open at a time.
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);

  const demoMode = useDemoMode();
  const writeAccess = useWriteAccess('orders:write', demoMode);

  const needsOrderQuery = useReturnsQuery(
    { bucket: 'orphan' },
    { limit: RETURNS_PAGE_SIZE, offset: 0 },
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
  // Result-shaped absence (`result === null`) reads as an error too, matching
  // `order-returns-panel.tsx`'s `query.error !== null || result === null`
  // guard: a settled, non-loading query with no data is not a confirmed empty.
  const needsOrderIsError = needsOrderQuery.error !== null || (!needsOrderQuery.isLoading && needsOrderResult === null);
  // Gated on the PAGE SIZE this group asked for, never on `items.length` or
  // `result.items.length`: an unreadable row is excluded from `items` and
  // counted in `droppedCount`, so comparing against the item count would
  // report the SAME row twice — once as unreadable and once as a page limit
  // that was never reached (tech-lead review on #3280, IMPORTANT).
  const needsOrderTruncated = needsOrderResult !== null && needsOrderResult.total > RETURNS_PAGE_SIZE;

  const approvalScanResult = approvalScanQuery.data ?? null;
  const needsApprovalItems = (approvalScanResult?.items ?? []).filter(
    (item) => item.origin === 'operator_authored' && item.authorizedAt === null,
  );
  const approvalScanIsError =
    approvalScanQuery.error !== null || (!approvalScanQuery.isLoading && approvalScanResult === null);
  const approvalScanTruncated =
    approvalScanResult !== null && approvalScanResult.total > RETURNS_MAX_LIMIT;

  return (
    <div className="orphan-returns-worklist">
      <h2 className="section-title">{COPY.sectionTitle}</h2>

      <WorklistGroup
        title={COPY.needsOrderTitle}
        description={COPY.needsOrderDescription}
        actionLabel={COPY.needsOrderAction}
        items={needsOrderItems}
        isLoading={needsOrderQuery.isLoading}
        isError={needsOrderIsError}
        isEnvelopeUnreadable={needsOrderResult?.envelopeUnreadable ?? false}
        emptyMessage={COPY.needsOrderEmpty}
        droppedCount={needsOrderResult?.droppedCount ?? 0}
        truncationNote={
          needsOrderResult !== null && needsOrderTruncated
            ? COPY.needsOrderTruncated(needsOrderItems.length, needsOrderResult.total)
            : null
        }
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
        isError={approvalScanIsError}
        isEnvelopeUnreadable={approvalScanResult?.envelopeUnreadable ?? false}
        emptyMessage={COPY.needsApprovalEmpty}
        droppedCount={approvalScanResult?.droppedCount ?? 0}
        truncationNote={approvalScanTruncated ? COPY.approvalScanTruncated : null}
        onRetry={() => {
          void approvalScanQuery.refetch();
        }}
        // `undefined` when the session cannot write at all (and is not a demo
        // viewer either) — `WorklistGroup` then falls back to its default
        // `Link`-to-detail action, which is read-only navigation and needs no
        // gate. Only when the session CAN write (or is a locked demo viewer)
        // does this render the write affordance, wrapped for the demo case.
        renderAction={
          writeAccess.visible
            ? (item) => (
                <ReadOnlyLock active={writeAccess.demoReadOnly} message={COPY.approveReadOnly}>
                  <Button
                    tone="secondary"
                    className="button--sm"
                    disabled={writeAccess.demoReadOnly}
                    onClick={() => {
                      setAuthorizingId(item.id);
                    }}
                  >
                    {COPY.needsApprovalAction}
                  </Button>
                </ReadOnlyLock>
              )
            : undefined
        }
      />

      {authorizingId !== null ? (
        <AuthorizeReturnDialog
          // Keyed on the return id: the mutation's error/success state is
          // component-local, so without this React would reuse the same
          // instance across two different rows opened in sequence and could
          // paint a fresh row as already-refused (tech-lead review on #3283,
          // SUGGESTION). Unreachable today — Radix's modal overlay makes the
          // rows behind inert, so nothing can retarget the dialog without
          // passing through `null` first — but this makes it a structural
          // guarantee rather than a consequence of the overlay.
          key={authorizingId}
          returnId={authorizingId}
          open
          onOpenChange={(open) => {
            if (!open) setAuthorizingId(null);
          }}
          onAuthorized={() => {
            setAuthorizingId(null);
          }}
        />
      ) : null}
    </div>
  );
}
