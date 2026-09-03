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
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { ApiError } from '../../shared/api/api-error';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { ConnectionEntityLabel, useConnectionsQuery } from '../../features/connections';
import { useDemoMode } from '../../features/system/hooks/use-demo-mode';
import {
  RETURNS_ORPHAN_COPY,
  RETURNS_ROW_COPY,
  RETURN_DETAIL_COPY,
  RETURN_DETAIL_HEADER_COPY,
  RETURN_LINES_COPY,
  RETURN_SOURCE_PANEL_COPY,
  ReturnCustodyPanel,
  ReturnMoneyPanel,
  ReturnProposalPanel,
  useReturnProposalQuery,
  ReturnDeclineAction,
  ReturnRailsNote,
  ReturnOrphanBanner,
  ReturnSourceStatus,
  ReturnDetailUnreadableError,
  describeUnreadableLines,
  useReturnQuery,
  type ReturnDetail,
} from '../../features/returns';

/** The header facts, as a definition list. */
function buildHeaderItems(
  detail: ReturnDetail,
  connectionName: string | null,
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'channelReference',
      label: RETURN_DETAIL_HEADER_COPY.channelReference,
      value:
        detail.externalReturnId !== null ? (
          <span className="mono-text">{detail.externalReturnId}</span>
        ) : (
          <span className="text-muted">{RETURN_DETAIL_HEADER_COPY.noChannelReference}</span>
        ),
    },
    {
      id: 'openLinkerId',
      label: RETURN_DETAIL_HEADER_COPY.openLinkerId,
      value: <span className="mono-text">{detail.id}</span>,
    },
    {
      id: 'source',
      label: RETURN_DETAIL_HEADER_COPY.source,
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
      label: RETURN_DETAIL_HEADER_COPY.order,
      value:
        detail.internalOrderId !== null ? (
          <Link to={`/orders/${detail.internalOrderId}`} className="link mono-text">
            {detail.internalOrderId}
          </Link>
        ) : (
          // Never a blank: the orphan banner above carries the explanation, and
          // the channel's own reference is the operator's only lead.
          <span className="text-muted" title={RETURNS_ORPHAN_COPY.explanation}>
            {RETURNS_ORPHAN_COPY.short}
            {detail.externalOrderId !== null ? ` · ${detail.externalOrderId}` : ''}
          </span>
        ),
    },
    {
      id: 'origin',
      label: RETURN_DETAIL_HEADER_COPY.origin,
      value:
        detail.origin === 'operator_authored'
          ? RETURN_DETAIL_HEADER_COPY.originOperator
          : RETURN_DETAIL_HEADER_COPY.originSource,
    },
    {
      id: 'opened',
      label: RETURN_DETAIL_HEADER_COPY.opened,
      value:
        detail.openedAt !== null ? (
          <TimeDisplay iso={detail.openedAt} format="datetime" className="mono-text" />
        ) : (
          // Labelled, never substituted: `createdAt` is OpenLinker's clock and
          // passing it off as the channel's would misdate the return by however
          // long ingestion lagged.
          <span className="text-muted" title={RETURNS_ROW_COPY.recordedAtFallback}>
            <TimeDisplay iso={detail.createdAt} format="datetime" className="mono-text" />
          </span>
        ),
    },
  ];

  if (detail.authorizedAt !== null) {
    items.push({
      id: 'authorized',
      label: RETURN_DETAIL_HEADER_COPY.authorized,
      value: <TimeDisplay iso={detail.authorizedAt} format="datetime" className="mono-text" />,
    });
  }

  if (detail.declinedAt !== null) {
    items.push({
      id: 'declined',
      label: RETURN_DETAIL_HEADER_COPY.declined,
      value: <TimeDisplay iso={detail.declinedAt} format="datetime" className="mono-text" />,
    });
  }

  if (detail.closedAt !== null) {
    items.push({
      id: 'closed',
      label: RETURN_DETAIL_HEADER_COPY.closed,
      value: <TimeDisplay iso={detail.closedAt} format="datetime" className="mono-text" />,
    });
  }

  items.push({
    id: 'updated',
    label: RETURN_DETAIL_HEADER_COPY.lastUpdated,
    value: <TimeDisplay iso={detail.updatedAt} format="relative" />,
  });

  return items;
}

export function ReturnDetailPage(): ReactElement {
  const { returnId = '' } = useParams<{ returnId: string }>();
  const demoMode = useDemoMode();
  const writeAccess = useWriteAccess('orders:write', demoMode);

  const query = useReturnQuery(returnId);
  // Gated on attribution: the proposal route answers 409 for an orphan, and the
  // page already explains that state with its own banner.
  const proposalQuery = useReturnProposalQuery(
    returnId,
    query.data !== undefined && query.data.bucket !== 'orphan'
  );
  const connectionsQuery = useConnectionsQuery();
  const detail = query.data ?? null;

  const connection =
    detail === null
      ? null
      : ((connectionsQuery.data ?? []).find((c) => c.id === detail.sourceConnectionId) ?? null);

  if (query.isLoading) {
    return (
      <PageLayout
        eyebrow={RETURN_DETAIL_COPY.eyebrow}
        title={RETURN_DETAIL_COPY.titleFallback}
        backTo={{ to: '/returns', label: RETURN_DETAIL_COPY.backToList }}
      >
        <LoadingState
          liveRegion="off"
          title={RETURN_DETAIL_COPY.loading}
          message={RETURN_DETAIL_COPY.loadingMessage}
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
        eyebrow={RETURN_DETAIL_COPY.eyebrow}
        title={isNotFound ? RETURN_DETAIL_COPY.notFoundTitle : RETURN_DETAIL_COPY.titleFallback}
        backTo={{ to: '/returns', label: RETURN_DETAIL_COPY.backToList }}
      >
        {isNotFound ? (
          <EmptyState
            liveRegion="off"
            title={RETURN_DETAIL_COPY.notFoundTitle}
            message={RETURN_DETAIL_COPY.notFoundMessage}
          />
        ) : (
          <ErrorState
            title={
              isUnreadable ? RETURN_DETAIL_COPY.unreadableTitle : RETURN_DETAIL_COPY.errorTitle
            }
            message={isUnreadable ? RETURN_DETAIL_COPY.unreadableMessage : error.message}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {RETURN_DETAIL_COPY.retry}
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
        eyebrow={RETURN_DETAIL_COPY.eyebrow}
        title={RETURN_DETAIL_COPY.notFoundTitle}
        backTo={{ to: '/returns', label: RETURN_DETAIL_COPY.backToList }}
      >
        <EmptyState
          liveRegion="off"
          title={RETURN_DETAIL_COPY.notFoundTitle}
          message={RETURN_DETAIL_COPY.notFoundMessage}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow={RETURN_DETAIL_COPY.eyebrow}
      title={detail.externalReturnId ?? RETURN_DETAIL_COPY.titleFallback}
      backTo={{ to: '/returns', label: RETURN_DETAIL_COPY.backToList }}
      actions={
        detail.declinedAt !== null ? (
          <StatusBadge tone="warning" compact>
            {RETURNS_ROW_COPY.declined}
          </StatusBadge>
        ) : null
      }
    >
      {detail.bucket === 'orphan' ? (
        <ReturnOrphanBanner externalOrderId={detail.externalOrderId} />
      ) : null}

      <KeyValueList items={buildHeaderItems(detail, connection?.name ?? null)} />

      <section className="returns-detail__lines">
        <h2 className="section-title">{RETURN_LINES_COPY.sectionTitle}</h2>
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

      <ReturnMoneyPanel detail={detail} writeAccess={writeAccess} />

      {/* Not fetched for an ORPHAN — the backend answers 409 (attribute it
          first), and asking anyway would render an error for a state the page
          already explains with its own banner. */}
      {proposalQuery.data !== undefined ? (
        <ReturnProposalPanel
          outcome={proposalQuery.data.outcome}
          proposal={proposalQuery.data.proposal}
        />
      ) : null}

      <section className="returns-detail__source">
        <h2 className="section-title">{RETURN_SOURCE_PANEL_COPY.sectionTitle}</h2>
        <p className="text-muted">{RETURN_SOURCE_PANEL_COPY.explainer}</p>
        <KeyValueList
          items={[
            {
              id: 'rawStatus',
              label: RETURN_SOURCE_PANEL_COPY.statusLabel,
              value: (
                <ReturnSourceStatus
                  rawStatus={detail.rawStatus}
                  sourceName={connection?.name ?? null}
                />
              ),
            },
          ]}
        />
      </section>

      <ReturnDeclineAction detail={detail} writeAccess={writeAccess} />
    </PageLayout>
  );
}
