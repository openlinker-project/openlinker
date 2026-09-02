/**
 * Who-Decides Question Row
 *
 * One row of the § 3.3 table: the question, the current answer, WHY that is the
 * answer, and one badge from the closed vocabulary.
 *
 * Every rendering decision here reads `state` / `source` through
 * `../lib/who-decides-view`, never the question itself — which row is the
 * refunds row is a rule that lives in core.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { AuthorityAnswerRow, AuthorityAttention } from '../api/who-decides.types';
import {
  resolveAnswer,
  resolveCandidateConnectionIds,
  resolveRowBadge,
  resolveWhyLine,
  rowBadgeTone,
} from '../lib/who-decides-view';
import {
  ANSWER_COPY,
  QUESTION_LABEL_COPY,
  ROW_BADGE_COPY,
  ROW_DETAIL_COPY,
} from '../lib/who-decides.copy';

export interface WhoDecidesQuestionRowProps {
  row: AuthorityAnswerRow;
  attention: AuthorityAttention;
  /** Connection id -> display name, for rows answered by one or more systems. */
  connectionNames: ReadonlyMap<string, string>;
}

export function WhoDecidesQuestionRow({
  row,
  attention,
  connectionNames,
}: WhoDecidesQuestionRowProps): ReactElement {
  const badge = resolveRowBadge(row);
  const answer = resolveAnswer(row);
  const why = resolveWhyLine(row, attention);
  const candidates = resolveCandidateConnectionIds(row);
  const inactive = row.inactiveClaimantConnectionIds;

  // Read off `source`, not the question — A6's lock is core's statement, not ours.
  const isLocked = row.source === 'fixed-by-design';

  return (
    <article className="who-decides-row" data-question={row.question} data-badge={badge}>
      <h3 className="who-decides-row__question">{QUESTION_LABEL_COPY[row.question]}</h3>

      <div className="who-decides-row__answer">
        {answer.kind === 'link' ? (
          <Link className="who-decides-row__link" to="/settings/sales-documents">
            {ROW_DETAIL_COPY.elsewhereLinkLabel}
          </Link>
        ) : answer.kind === 'parties' ? (
          <span>
            {answer.connectionIds.map((id, index) => (
              <span key={id}>
                {index > 0 ? ANSWER_COPY.separator : null}
                {connectionNames.has(id) ? (
                  connectionNames.get(id)
                ) : (
                  // The id IS what the backend said; a placeholder would assert
                  // less than the response contains.
                  <span className="mono-text">{id}</span>
                )}
              </span>
            ))}
          </span>
        ) : (
          <span>{answer.text}</span>
        )}
      </div>

      {/*
        The badge stays `Always` — § 3.3's badge vocabulary is closed, so the
        lock is a SEPARATE affordance rather than a seventh badge value. It
        reads as reassurance, not a restriction, which is why the row is
        rendered locked rather than hidden.
      */}
      {isLocked ? <p className="who-decides-row__locked">{ROW_DETAIL_COPY.lockedLabel}</p> : null}

      <p className="who-decides-row__why">{why}</p>

      {candidates.length > 0 ? (
        <ul className="who-decides-row__candidates">
          {candidates.map((id) => (
            <li key={id}>
              <Link to={`/connections/${id}`}>
                {connectionNames.get(id) ?? id}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {inactive.length > 0 ? (
        <p className="who-decides-row__inactive">
          {inactive.length === 1
            ? ROW_DETAIL_COPY.inactiveClaimOne
            : ROW_DETAIL_COPY.inactiveClaimMany}
        </p>
      ) : null}

      <div className="who-decides-row__badge">
        <StatusBadge tone={rowBadgeTone(badge)} compact>
          {ROW_BADGE_COPY[badge]}
        </StatusBadge>
      </div>
    </article>
  );
}
