/**
 * Return Detail Page (#2336)
 *
 * One return: what came back, against which order, what the channel says, and
 * the one write OpenLinker can make.
 *
 * The panel order answers the operator's questions in the order they are asked
 * (returns spec §5): who/what is this → why can nothing be done (if orphan) →
 * what came back → what the channel says → the action.
 *
 * Three rules shape it.
 *
 * **`rawStatus` renders verbatim and attributed.** It is the channel's own word,
 * quoted — never mapped onto an OpenLinker vocabulary, never given a
 * traffic-light tone. `null` is a different fact from any status and reads as
 * "not reported". The rendering is `ReturnSourceStatus`, shared with the list,
 * so there is exactly one component that decides what a channel status looks
 * like.
 *
 * **Four failure branches, and they are not interchangeable.** Not-found (404)
 * is a fact about the id in the URL; unreadable is a fact about this build;
 * everything else is a fact about the request. Collapsing them would point the
 * operator at a problem they do not have.
 *
 * **The header states the record, never the last attempt.** The `Declined`
 * badge is driven by `declinedAt` alone — the same rule the list's
 * `ReturnStatusCell` applies — so a `decline-sent` outcome, which leaves
 * `declinedAt` null, cannot make this page claim the channel declined.
 *
 * @module apps/web/src/pages/returns
 */
import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { ApiError } from '../../shared/api/api-error';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { ConnectionEntityLabel, useConnectionsQuery } from '../../features/connections';
// The barrel, not the deep hook path — every other in-tree consumer imports
// it this way (`orphan-returns-worklist.tsx` among them), and `pages/` deep
// imports are a documented gap, not an allowance (tech-lead review on
// #3285, SUGGESTION).
import { useDemoMode } from '../../features/system';
import { GiftsGuide } from '../../features/gifts';
import { parseOrderSnapshot, useOrderQuery } from '../../features/orders';
import { shortenId } from '../../shared/ui/entity-label';
import { useMessages, type Messages, type ResolvedCopy } from '../../shared/i18n';
import {
  ReturnCustodyPanel,
  ReturnMoneyPanel,
  ReturnGiftsPanel,
  CorrectionProposalPanel,
  useReturnProposalQuery,
  ReturnDeclineAction,
  ReturnRailsNote,
  ReturnActivityTimeline,
  ReturnOrphanBanner,
  MatchReturnDialog,
  ReturnSourceStatus,
  ReturnDetailUnreadableError,
  describeUnreadableLines,
  useReturnQuery,
  type ReturnDetail,
} from '../../features/returns';

/** The header facts, as a definition list. */
type ReturnsCopy = ResolvedCopy<Messages['returns']>;

function buildHeaderItems(
  detail: ReturnDetail,
  connectionName: string | null,
  returnsCopy: ReturnsCopy,
  orderNumber: string | null = null,
): KeyValueItem[] {
  const headerCopy = returnsCopy.detail.header;
  const orphanCopy = returnsCopy.list.orphan;
  const rowCopy = returnsCopy.list.row;
  const items: KeyValueItem[] = [
    {
      id: 'channelReference',
      label: headerCopy.channelReference,
      value:
        detail.externalReturnId !== null ? (
          <span className="mono-text">{detail.externalReturnId}</span>
        ) : (
          <span className="text-muted">{headerCopy.noChannelReference}</span>
        ),
    },
    {
      id: 'openLinkerId',
      label: headerCopy.openLinkerId,
      value: <span className="mono-text">{detail.id}</span>,
    },
    {
      id: 'source',
      label: headerCopy.source,
      value: (
        <ConnectionEntityLabel
          connectionId={detail.sourceConnectionId}
          name={connectionName}
          linkToDetail
          showCopy={false}
        />
      ),
    },
    {
      id: 'order',
      label: headerCopy.order,
      value:
        detail.internalOrderId !== null ? (
          <Link to={`/orders/${detail.internalOrderId}`} className="link mono-text">
            {orderNumber ?? shortenId(detail.internalOrderId)}
          </Link>
        ) : (
          // Never a blank: the orphan banner above carries the explanation, and
          // the channel's own reference is the operator's only lead.
          <span className="text-muted" title={orphanCopy.explanation}>
            {orphanCopy.short}
            {detail.externalOrderId !== null ? ` · ${detail.externalOrderId}` : ''}
          </span>
        ),
    },
    {
      id: 'origin',
      label: headerCopy.origin,
      value:
        detail.origin === 'operator_authored'
          ? headerCopy.originOperator
          : headerCopy.originSource,
    },
    {
      id: 'opened',
      label: headerCopy.opened,
      value:
        detail.openedAt !== null ? (
          <TimeDisplay iso={detail.openedAt} format="datetime" className="mono-text" />
        ) : (
          // Labelled, never substituted: `createdAt` is OpenLinker's clock and
          // passing it off as the channel's would misdate the return by however
          // long ingestion lagged.
          <span className="text-muted" title={rowCopy.recordedAtFallback}>
            <TimeDisplay iso={detail.createdAt} format="datetime" className="mono-text" />
          </span>
        ),
    },
  ];

  if (detail.authorizedAt !== null) {
    items.push({
      id: 'authorized',
      label: headerCopy.authorized,
      value: <TimeDisplay iso={detail.authorizedAt} format="datetime" className="mono-text" />,
    });
  }

  if (detail.declinedAt !== null) {
    items.push({
      id: 'declined',
      label: headerCopy.declined,
      value: <TimeDisplay iso={detail.declinedAt} format="datetime" className="mono-text" />,
    });
  }

  if (detail.closedAt !== null) {
    items.push({
      id: 'closed',
      label: headerCopy.closed,
      value: <TimeDisplay iso={detail.closedAt} format="datetime" className="mono-text" />,
    });
  }

  items.push({
    id: 'updated',
    label: headerCopy.lastUpdated,
    value: <TimeDisplay iso={detail.updatedAt} format="relative" />,
  });

  return items;
}

export function ReturnDetailPage(): ReactElement {
  const { returnId = '' } = useParams<{ returnId: string }>();
  const returnsCopy = useMessages('returns');
  const pageCopy = returnsCopy.detail.page;
  const linesCopy = returnsCopy.detail.lines;
  const orphanBannerCopy = returnsCopy.detail.orphanBanner;
  const sourcePanelCopy = returnsCopy.detail.sourcePanel;
  const rowCopy = returnsCopy.list.row;
  const demoMode = useDemoMode();
  const writeAccess = useWriteAccess('orders:write', demoMode);
  // #3078/#3085 — the match dialog's detail-page mount point. A single slot:
  // only this return's own orphan banner can ever open it.
  const [isMatchDialogOpen, setIsMatchDialogOpen] = useState(false);

  const [declineNotes, setDeclineNotes] = useState<HTMLElement | null>(null);
  const query = useReturnQuery(returnId);
  // Gated on attribution: the proposal route answers 409 for an orphan, and the
  // page already explains that state with its own banner.
  const proposalQuery = useReturnProposalQuery(
    returnId,
    query.data !== undefined && query.data.bucket !== 'orphan'
  );
  const connectionsQuery = useConnectionsQuery();
  // The order number, not its internal id: the return already knows the order (#3935).
  const orderQuery = useOrderQuery(query.data?.internalOrderId ?? '');
  const orderNumber =
    orderQuery.data === undefined || orderQuery.data === null
      ? null
      : (parseOrderSnapshot(orderQuery.data.orderSnapshot).orderNumber?.trim() || null);
  const detail = query.data ?? null;

  const connection =
    detail === null
      ? null
      : ((connectionsQuery.data ?? []).find((c) => c.id === detail.sourceConnectionId) ?? null);

  if (query.isLoading) {
    return (
      <PageLayout
        eyebrow={pageCopy.eyebrow}
        title={pageCopy.titleFallback}
        backTo={{ to: '/returns', label: pageCopy.backToList }}
      >
        <LoadingState
          liveRegion="off"
          title={pageCopy.loading}
          message={pageCopy.loadingMessage}
        />
      </PageLayout>
    );
  }

  if (query.error !== null) {
    const error = query.error;
    const isNotFound = error instanceof ApiError && error.status === 404;
    const isUnreadable = error instanceof ReturnDetailUnreadableError;

    return (
      <PageLayout
        eyebrow={pageCopy.eyebrow}
        title={isNotFound ? pageCopy.notFoundTitle : pageCopy.titleFallback}
        backTo={{ to: '/returns', label: pageCopy.backToList }}
      >
        {isNotFound ? (
          <EmptyState
            liveRegion="off"
            title={pageCopy.notFoundTitle}
            message={pageCopy.notFoundMessage}
          />
        ) : (
          <ErrorState
            title={
              isUnreadable ? pageCopy.unreadableTitle : pageCopy.errorTitle
            }
            message={isUnreadable ? pageCopy.unreadableMessage : error.message}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {pageCopy.retry}
              </Button>
            }
          />
        )}
      </PageLayout>
    );
  }

  if (detail === null) {
    // Reached when the query never ran: `useReturnQuery` is disabled on an empty
    // id, and a disabled query settles as not-loading, not-errored, no data.
    // Unreachable through the router today, but the honest reading of an empty
    // id is "no such return" — a permanently `aria-busy` skeleton would claim
    // the page is still loading something that was never requested.
    return (
      <PageLayout
        eyebrow={pageCopy.eyebrow}
        title={pageCopy.notFoundTitle}
        backTo={{ to: '/returns', label: pageCopy.backToList }}
      >
        <EmptyState
          liveRegion="off"
          title={pageCopy.notFoundTitle}
          message={pageCopy.notFoundMessage}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow={pageCopy.eyebrow}
      title={detail.externalReturnId ?? pageCopy.titleFallback}
      backTo={{ to: '/returns', label: pageCopy.backToList }}
      actions={
        <>
          <GiftsGuide variant="returns" />
          <ReturnDeclineAction detail={detail} writeAccess={writeAccess} placement="header" notesTarget={declineNotes} />
          {detail.declinedAt !== null ? (
            <StatusBadge tone="warning" compact>
              {rowCopy.declined}
            </StatusBadge>
          ) : null}
        </>
      }
    >
      {/* ONE `detail.bucket === 'orphan'` check for both the banner and its
          dialog, folded into a single block — the two were adjacent, separate
          conditions that could drift from each other for no reason (tech-lead
          review on #3285, SUGGESTION). The dialog renders nothing while
          `open` is false, so folding it in costs nothing. */}
      {detail.bucket === 'orphan' ? (
        <>
          <ReturnOrphanBanner
            externalOrderId={detail.externalOrderId}
            action={
              writeAccess.visible ? (
                <ReadOnlyLock
                  active={writeAccess.demoReadOnly}
                  message={orphanBannerCopy.matchActionReadOnly}
                >
                  <Button
                    tone="secondary"
                    disabled={writeAccess.demoReadOnly}
                    onClick={() => {
                      setIsMatchDialogOpen(true);
                    }}
                  >
                    {orphanBannerCopy.matchAction}
                  </Button>
                </ReadOnlyLock>
              ) : null
            }
          />
          <MatchReturnDialog
            returnId={detail.id}
            open={isMatchDialogOpen}
            onOpenChange={setIsMatchDialogOpen}
            writeAccess={writeAccess}
            // Cache invalidation is the mechanism (useMatchReturnToOrderMutation
            // already invalidates on settle) — no explicit refetch needed
            // here (tech-lead review on #3285, SUGGESTION).
          />
        </>
      ) : null}

      <dl className="returns-detail__strip">
        {buildHeaderItems(detail, connection?.name ?? null, returnsCopy, orderNumber)
          .filter((item) => item.id !== 'openLinkerId' && item.id !== 'updated')
          .map((item) => (
            <div key={item.id} className="returns-detail__fact">
              <dt className="returns-detail__fact-label">{item.label}</dt>
              <dd className="returns-detail__fact-value">{item.value}</dd>
            </div>
          ))}
      </dl>

      <div className="returns-detail__notes" ref={setDeclineNotes} data-testid="returns-decline-notes" />

      <div className="returns-detail__cols">
      <div className="returns-detail__main">

      <section className="returns-detail__lines">
        <h2 className="section-title">{linesCopy.sectionTitle}</h2>
        {/* Once, above the table: the two rails move independently, and that is
            the single most misread thing about the model. */}
        <ReturnRailsNote />
        {/* The table plus its inline receive/dispose flows (#2380). The panel
            owns the write posture, so a read-only session gets the same table
            with no expander rather than an expander onto disabled controls. */}
        <ReturnCustodyPanel
          detail={detail}
          sourceName={connection?.name ?? null}
          writeAccess={writeAccess}
        />
        {detail.droppedLineCount > 0 ? (
          <p className="text-muted">{describeUnreadableLines(detail.droppedLineCount)}</p>
        ) : null}
      </section>

      <ReturnGiftsPanel returnId={detail.id} writeAccess={writeAccess} />
      </div>

      <div className="returns-detail__side">
      <ReturnMoneyPanel detail={detail} writeAccess={writeAccess} />

      {/* Section 5 of 8, at the shipped #correction anchor, between Money and
          "What the channel says" (returns spec § 5.8). Not FETCHED for an
          ORPHAN — the backend answers 409 (attribute it first) — but the
          section still renders, with a fixed message rather than silently
          disappearing: `credit-absent-orphan` keeps the page's section count
          stable instead of making #correction a dead anchor. The orphan
          shell is owned by the panel itself (`orphan` prop) — see that
          component's docblock for why the page must not rebuild it. */}
      {detail.bucket === 'orphan' ? (
        <CorrectionProposalPanel
          returnId={returnId}
          outcome=""
          proposal={null}
          changeId={null}
          writeAccess={writeAccess}
          orphan
        />
      ) : proposalQuery.data !== undefined ? (
        <CorrectionProposalPanel
          returnId={returnId}
          outcome={proposalQuery.data.outcome}
          proposal={proposalQuery.data.proposal}
          changeId={proposalQuery.data.changeId ?? null}
          writeAccess={writeAccess}
        />
      ) : null}

      {/* #2646 — returns spec § 5's activity panel, last in the panel order:
          the record, then what came back, then the money, then the channel's
          own word, then the action, and finally what has actually happened.
          Works for an orphan, which is why it is keyed on the return. */}
      <ReturnActivityTimeline returnId={detail.id} />
      <details className="returns-detail__source returns-detail__disclosure" data-testid="returns-source-disclosure">
        <summary className="returns-detail__disclosure-summary">{sourcePanelCopy.sectionTitle}</summary>
        <p className="text-muted">{sourcePanelCopy.explainer}</p>
        <KeyValueList
          items={[
            {
              id: 'rawStatus',
              label: sourcePanelCopy.statusLabel,
              value: (
                <ReturnSourceStatus
                  rawStatus={detail.rawStatus}
                  sourceName={connection?.name ?? null}
                />
              ),
            },
          ]}
        />
      </details>

      </div>
      </div>
    </PageLayout>
  );
}
