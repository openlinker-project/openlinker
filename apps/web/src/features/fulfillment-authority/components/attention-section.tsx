/**
 * Needs-Attention Section
 *
 * Spec §4's counted, badged table of inert states, rendered below the
 * who-decides questions. The half of §4 that answers *what is OpenLinker not
 * doing, and what is each one waiting on*.
 *
 * ## The count is TWO numbers, and saying so is the point
 *
 * `attention.counted` counts STATES (one per ambiguous authority, install-wide);
 * `attention.affectedOrderCount` counts ORDERS. The API's own type says adding
 * them is the caller's job precisely because they measure different things — so
 * the heading shows the sum and the sub-line names both parts. One opaque total
 * would be a number an operator cannot act on.
 *
 * ## `attention.routine` is never read
 *
 * It is ALWAYS empty (every descriptor is `counted: true`) and the wire type's
 * own docblock forbids inventing a client-side split. §4.3's routine half lives
 * on the who-decides ROW as an `AuthorityState` / `AuthoritySource` /
 * `AuthorityAnswer` instead — which is also why the A2-`none` regression cannot
 * be counted here: `nobody-to-route` produces `state: 'default'`, never
 * `'ambiguous'`, so it never enters `counted` at all.
 *
 * ## Render order is the declared array
 *
 * `AuthorityAttentionReasonValues`, never the response order and never
 * `Object.keys`. The server sends them in that order today and this must not
 * silently depend on it.
 *
 * ## An unrecognised reason renders and is not counted
 *
 * Spec §4.4 S2-5. It keeps its place in the list — dropping it would hide that
 * OpenLinker stopped doing something — under `ATTENTION_UNKNOWN_COPY`, and it is
 * excluded from the number.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 4
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { AuthorityAttentionReasonValues } from '../lib/attention-reason';
import {
  ATTENTION_BADGE_COPY,
  ATTENTION_SECTION_COPY,
  ATTENTION_UNKNOWN_COPY,
} from '../lib/attention-reason.copy';
import { toAttentionEntryView } from '../lib/attention-entry';
import type { AuthorityAttention, AuthorityAttentionItem } from '../api/who-decides.types';

interface AttentionSectionProps {
  attention: AuthorityAttention;
  /** Resolves a connection id to its name; falls back to the id itself. */
  nameFor: (connectionId: string) => string;
}

/**
 * The counted items in declared render order.
 *
 * An item whose reason this build does not recognise sorts LAST rather than
 * being dropped: it has no position in the declared array, and the alternative
 * — hiding it — is the silence §4.4 exists to prevent.
 */
function orderItems(items: readonly AuthorityAttentionItem[]): readonly AuthorityAttentionItem[] {
  const rank = new Map<string, number>(
    AuthorityAttentionReasonValues.map((reason, index) => [reason, index])
  );
  const unknownRank = AuthorityAttentionReasonValues.length;
  return [...items].sort(
    (a, b) => (rank.get(a.reason) ?? unknownRank) - (rank.get(b.reason) ?? unknownRank)
  );
}

export function AttentionSection({ attention, nameFor }: AttentionSectionProps): ReactElement {
  const items = orderItems(attention.counted);
  const views = items.map((item) => toAttentionEntryView(item));
  // Counted STATES, excluding anything this build cannot name (§4.4 S2-5).
  const stateCount = views.filter((view) => view.known).length;
  const orderCount = attention.affectedOrderCount;
  const total = stateCount + orderCount;

  return (
    <section
      className="who-decides__section who-decides-attention"
      aria-labelledby="who-decides-attention-heading"
    >
      <div className="who-decides__section-head">
        <div>
          <h2 className="section-title" id="who-decides-attention-heading">
            {`${ATTENTION_SECTION_COPY.heading} (${String(total)})`}
          </h2>
          <p className="muted-text">{ATTENTION_SECTION_COPY.description}</p>
        </div>
      </div>

      {/*
        Both parts are named rather than summed silently — see the module
        docblock. Rendered only when something is counted, so a healthy install
        gets the one reassuring line and nothing else.
      */}
      {total > 0 ? (
        <p className="who-decides-attention__counts">
          {`${ATTENTION_SECTION_COPY.statesLabel}: ${String(stateCount)} · ${ATTENTION_SECTION_COPY.ordersLabel}: ${String(orderCount)}`}
        </p>
      ) : null}

      {/*
        Rendered independently of `total`, which is the whole point: the case
        that reads worst is exactly `total === 0` with an unrecognised card
        below it — `Needs attention (0)` over something visibly there.
      */}
      {views.some((view) => !view.known) ? (
        <p className="who-decides-attention__counts">{ATTENTION_SECTION_COPY.unknownNote}</p>
      ) : null}

      {items.length === 0 ? (
        /* Zero-state is one reassuring line, never an illustration (§4). */
        <p className="who-decides-attention__empty">{ATTENTION_SECTION_COPY.empty}</p>
      ) : (
        <ul className="who-decides-attention__list">
          {views.map((view, index) => {
            const item = items[index];
            return (
              <li
                // Keyed on `(reason, question)`. The reason alone is unique only
                // by today's accident that at most one counted item is derived
                // per question; a persisted producer contributing two items with
                // one reason would make React silently drop one, from the
                // section that exists to surface it.
                key={`${item.reason}:${item.question ?? String(index)}`}
                className="who-decides-attention__item"
              >
                <div className="who-decides-attention__head">
                  <StatusBadge tone={view.known ? view.tone : 'neutral'} withDot compact>
                    {view.known ? ATTENTION_BADGE_COPY[view.badge] : ATTENTION_UNKNOWN_COPY.badgeLabel}
                  </StatusBadge>
                  <span className="who-decides-attention__title">{view.title}</span>
                </div>
                <p className="who-decides-attention__body">{view.body}</p>
                <p className="who-decides-attention__action">{view.action}</p>
                {/*
                  The raw value survives the round trip so an operator can quote
                  it in a support ticket — the #2231 rule.
                */}
                {!view.known && view.rawReason ? (
                  <p className="who-decides-attention__raw mono-text">{view.rawReason}</p>
                ) : null}
                {item.connectionIds.length > 0 ? (
                  <ul className="who-decides__id-list">
                    {item.connectionIds.map((id) => (
                      <li key={id}>
                        <Link to={`/connections/${id}`}>{nameFor(id)}</Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
