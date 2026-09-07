/**
 * Order Returns Panel (#2640, returns spec § 5.4 — the third required surface)
 *
 * One order's returns, on the order detail, so an operator handling an order
 * learns that goods are coming back without leaving for `/returns`.
 *
 * Three properties are load-bearing.
 *
 * **The `restock_blocked` badge is rendered by `ReturnStageCell`, the very
 * component the returns list uses.** § 5.4 requires the sentence to be
 * byte-identical across three surfaces; reusing the component rather than
 * re-importing `RETURN_RESTOCK_BLOCKED_COPY` and re-rendering it is one step
 * stronger than the issue asks for, because there is no second render that
 * could drift. The cross-feature import goes through the returns barrel
 * (`../../returns`) — the #2100 `sales-document-block-copy.ts` shape, and the
 * only route `.eslintrc.js` permits.
 *
 * **Four states, and none of them may be collapsed.** Loading; the read FAILED;
 * the envelope was UNREADABLE; and a confirmed empty. Only the last is a claim
 * about the operator's data — the other three are claims about this request or
 * this build, and rendering any of them as "no returns on this order" would
 * tell an operator their goods are not coming back when OpenLinker simply could
 * not say. An absent panel would be a fourth wrong answer (this order cannot
 * have returns), so the section always renders.
 *
 * **A truncated page says so, with both numbers.** The panel reads one page; an
 * order with more returns than that is disclosed rather than quietly trimmed.
 *
 * Read-only: no write affordance, so no `useWriteAccess` / `ReadOnlyLock` — the
 * writes live on the return detail, which every row links to.
 *
 * **It lives in `features/returns`, not `features/orders`, and that is a
 * deliberate deviation from #2640's text.** `features/returns` already
 * value-imports the orders barrel (`return-money-panel.tsx` → `../../orders`),
 * so a panel in `features/orders` that value-imported the returns barrel and
 * was re-exported from the orders barrel would close a runtime barrel↔barrel
 * cycle — the hazard `restock-blocked.copy.ts` names (#337/#359). Here it adds
 * no new edge direction at all: `pages/orders/order-detail-page.tsx` already
 * imports from `'../../returns'`.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useReturnsQuery } from '../hooks/use-returns-query';
import { ReturnStageCell } from './return-stage-cell';
import { RETURNS_ROW_COPY, describeUnreadableRows } from '../lib/returns-list.copy';
import { ORDER_RETURNS_PANEL_COPY as COPY } from '../lib/order-returns-panel.copy';

/**
 * One page. Deliberately well below the API's `@Max(100)`: an order with more
 * returns than this is not a real shape, and the truncation notice states both
 * numbers when it happens rather than the panel pretending it showed them all.
 */
const PANEL_PAGE_SIZE = 20;

interface OrderReturnsPanelProps {
  internalOrderId: string;
}

export function OrderReturnsPanel({ internalOrderId }: OrderReturnsPanelProps): ReactElement {
  // The read is DISABLED on an empty id rather than issued and ignored.
  // `buildQuery` omits a falsy filter, so an empty id would issue an unfiltered
  // `GET /returns` and render the whole installation's returns under this
  // order's heading. The router makes an empty id unlikely, not impossible, and
  // the return-detail page's own `detail === null` branch declined to trust the
  // router for the same reason.
  const scoped = internalOrderId.length > 0;
  const query = useReturnsQuery(
    { internalOrderId },
    { limit: PANEL_PAGE_SIZE, offset: 0 },
    scoped,
  );

  const result = query.data ?? null;
  const items = result?.items ?? [];

  return (
    <section className="detail-section" id="order-returns">
      <h3 className="detail-section__title">{COPY.sectionTitle}</h3>
      {renderBody()}
    </section>
  );

  function renderBody(): ReactElement {
    if (!scoped) {
      // Nothing was asked, so nothing may be claimed. An empty state here would
      // assert the order has no returns on the strength of a request never made.
      return <ErrorState title={COPY.unscopedTitle} message={COPY.unscopedMessage} />;
    }

    if (query.isLoading) {
      return <LoadingState liveRegion="off" title={COPY.loading} message={COPY.loadingMessage} />;
    }

    // A failed read is never an empty list. `ErrorState` rather than
    // `EmptyState` so nothing here reads as a fact about the order.
    if (query.error !== null || result === null) {
      return (
        <ErrorState
          title={COPY.errorTitle}
          message={COPY.errorMessage}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {COPY.retry}
            </Button>
          }
        />
      );
    }

    // Distinct from a dropped row: an unreadable envelope yields zero items AND
    // zero drops, so a caller testing only `droppedCount` renders it as a
    // confirmed-empty list — the exact conflation the returns list documents.
    if (result.envelopeUnreadable) {
      return <ErrorState title={COPY.unreadableTitle} message={COPY.unreadableMessage} />;
    }

    if (items.length === 0) {
      // The only positive claim on this panel: the read succeeded, the envelope
      // parsed, and it answered zero.
      return (
        <EmptyState liveRegion="off" title={COPY.emptyTitle} message={COPY.emptyMessage} />
      );
    }

    return (
      <>
        <ul className="returns-order-panel" aria-label={COPY.sectionTitle}>
          {items.map((item) => (
            <li key={item.id} className="returns-order-panel__item">
              <div className="returns-order-panel__identity">
                <Link to={`/returns/${item.id}`} className="link mono-text">
                  {item.externalReturnId ?? item.id}
                </Link>
                {item.externalReturnId === null ? (
                  <span className="text-muted">{COPY.noChannelReference}</span>
                ) : null}
              </div>
              {/* The § 5.4 badge lives inside this cell, beside the derived
                  stage. One component, three surfaces, no second sentence. */}
              <ReturnStageCell item={item} />
              {/* `openedAt` is the SOURCE's own instant. When it is absent the
                  fallback is LABELLED rather than substituted: `createdAt` is
                  OpenLinker's ingestion clock, and passing it off as the
                  channel's would misdate the return by however long ingestion
                  lagged. Same rule, same copy, as the return detail. */}
              {item.openedAt !== null ? (
                <span className="returns-order-panel__time">
                  <TimeDisplay iso={item.openedAt} format="datetime" />
                </span>
              ) : (
                <span
                  className="returns-order-panel__time text-muted"
                  title={RETURNS_ROW_COPY.recordedAtFallback}
                >
                  <TimeDisplay iso={item.createdAt} format="datetime" />
                </span>
              )}
            </li>
          ))}
        </ul>
        {/* Reported, never silently dropped — and reusing the returns list's
            own sentence rather than writing a second one. */}
        {result.droppedCount > 0 ? (
          <p className="text-muted">{describeUnreadableRows(result.droppedCount)}</p>
        ) : null}
        {/* Gated on the PAGE SIZE, never on `items.length`: an unreadable row
            is excluded from `items` and counted in `droppedCount`, so comparing
            against the item count would report the SAME row twice — once as
            unreadable and once as a page limit that was never reached. */}
        {result.total > PANEL_PAGE_SIZE ? (
          <p className="text-muted">{COPY.truncated(items.length, result.total)}</p>
        ) : null}
      </>
    );
  }
}
