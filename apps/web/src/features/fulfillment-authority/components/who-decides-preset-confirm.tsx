/**
 * Who-Decides Preset Confirm
 *
 * The body of the confirm dialog, generated from `POST …/presets/preview`.
 *
 * ## An empty diff and a refused save are different states, and read differently
 *
 * An **empty diff** means saving is allowed and would change nothing — one
 * neutral sentence, Save enabled. A **refusal** means the resulting arrangement
 * would leave two systems deciding the same thing, so nothing may be written —
 * an error Alert naming the conflicting connections, Save disabled. The two are
 * independent, because the server's guard is over the RESULT rather than the
 * delta: on an install that is already contradictory even the option that
 * changes nothing is refused. That case renders as the refusal, not as
 * "nothing changes", because the operator's next action is to fix the clash.
 *
 * ## Nothing may be saved before the dialog can say what saving does
 *
 * Loading and unreadable both disable Save. A confirm dialog whose whole
 * purpose is to explain a change must not let the change out while it cannot.
 *
 * ## An unresolvable connection renders as its id
 *
 * Never a friendly placeholder: the id is what the response actually said, and
 * two unresolvable connections must stay tellable apart — which is the entire
 * point of naming them on the one screen where the operator has to act on them.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 3.4 (S1-2 / S1-3 / S1-4)
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import type { AuthorityPresetPreview } from '../api/who-decides.types';
import { isAuthorityAttentionReason } from '../lib/attention-reason';
import { ATTENTION_REASON_COPY, ATTENTION_UNKNOWN_COPY } from '../lib/attention-reason.copy';
import { buildPresetDiff } from '../lib/preset-diff';
import type { AnswerRendering } from '../lib/who-decides-view';
import {
  ANSWER_COPY,
  PRESET_CONFIRM_COPY,
  WHO_DECIDES_PAGE_COPY,
} from '../lib/who-decides.copy';

interface WhoDecidesPresetConfirmProps {
  preview: AuthorityPresetPreview | null | undefined;
  isLoading: boolean;
  isError: boolean;
  connectionNames: ReadonlyMap<string, string>;
  onRetry: () => void;
}

/**
 * Whether the dialog may let a save through.
 *
 * Exported so the panel passes the SAME answer to `confirmDisabled` that this
 * component renders — one function, two readers, so the button and the
 * explanation beside it can never disagree about whether saving is allowed.
 */
export function isPresetConfirmBlocked(
  preview: AuthorityPresetPreview | null | undefined,
  isLoading: boolean,
  isError: boolean,
): boolean {
  return isLoading || isError || !preview || preview.blocked;
}

function renderAnswer(
  answer: AnswerRendering,
  nameFor: (id: string) => string,
): ReactNode {
  switch (answer.kind) {
    case 'text':
      return answer.text;
    case 'link':
      return ANSWER_COPY.configuredElsewhere;
    case 'parties':
      return answer.connectionIds.map(nameFor).join(ANSWER_COPY.separator);
  }
}

export function WhoDecidesPresetConfirm({
  preview,
  isLoading,
  isError,
  connectionNames,
  onRetry,
}: WhoDecidesPresetConfirmProps): ReactElement {
  const nameFor = (id: string): string => connectionNames.get(id) ?? id;

  if (isLoading) {
    return (
      <p className="who-decides-confirm__note" aria-busy="true">
        {PRESET_CONFIRM_COPY.loading}
      </p>
    );
  }

  // A response this build cannot read is reported as exactly that. Rendering
  // "nothing changes" here would be a positive claim about a change we did not
  // manage to look at.
  if (isError || !preview) {
    return (
      <Alert
        tone="error"
        title={WHO_DECIDES_PAGE_COPY.errorTitle}
        action={
          <button className="button button--secondary button--sm" type="button" onClick={onRetry}>
            {PRESET_CONFIRM_COPY.retryLabel}
          </button>
        }
      >
        {PRESET_CONFIRM_COPY.unreadable}
      </Alert>
    );
  }

  if (preview.blocked) {
    return (
      <Alert tone="error" title={PRESET_CONFIRM_COPY.blockedTitle}>
        <p>{PRESET_CONFIRM_COPY.blockedIntro}</p>
        {/*
          The §4.2 body for each conflict — the same copy the ambiguous row's
          why-line renders, so the dialog and the table say one thing about one
          fact. A reason this build does not recognise degrades to the shared
          unknown sentence rather than to silence.
        */}
        <ul className="who-decides-confirm__blocks">
          {preview.resultingAmbiguities.map((item) => (
            <li key={`${item.reason}:${item.question ?? 'none'}`}>
              <span className="who-decides-confirm__block-body">
                {isAuthorityAttentionReason(item.reason)
                  ? ATTENTION_REASON_COPY[item.reason].body
                  : ATTENTION_UNKNOWN_COPY.body}
              </span>
              {/*
                A real list, not the panel's `who-decides__id-list`: that class
                is a `<ul>` indent (`padding-left`, a vertical `margin`), and on
                an inline `<span>` the margin is ignored and the links render
                run together with no separator — `conn-aaaconn-bbb` on the one
                screen where the operator has to tell two connections apart.
                The stylesheet-coverage test cannot catch that (the class does
                exist), which is the failure its own docblock describes.
              */}
              <ul className="who-decides-confirm__block-links">
                {item.connectionIds.map((id) => (
                  <li key={id}>
                    <Link to={`/connections/${id}`}>{nameFor(id)}</Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Alert>
    );
  }

  const diff = buildPresetDiff(preview.changes);

  if (diff.lines.length === 0) {
    return <p className="who-decides-confirm__note">{PRESET_CONFIRM_COPY.noChanges}</p>;
  }

  return (
    <div className="who-decides-confirm">
      <p className="who-decides-confirm__heading">{PRESET_CONFIRM_COPY.changesHeading}</p>
      <ul className="who-decides-confirm__lines">
        {diff.lines.map((line) => (
          <li className="who-decides-confirm__line" key={line.question} data-question={line.question}>
            <span className="who-decides-confirm__question">{line.label}</span>
            <span className="who-decides-confirm__move">
              <span className="who-decides-confirm__from">{renderAnswer(line.before, nameFor)}</span>
              {/*
                The arrow carries the whole meaning of the line visually, so a
                screen reader gets the word instead — without it the row reads
                as two answers with no relationship between them.
              */}
              <span className="who-decides-confirm__arrow" aria-hidden="true">
                →
              </span>
              <span className="sr-only">{PRESET_CONFIRM_COPY.becomes}</span>
              <span className="who-decides-confirm__to">{renderAnswer(line.after, nameFor)}</span>
            </span>
            <span className="who-decides-confirm__meaning">{line.meaning}</span>
          </li>
        ))}
      </ul>
      {diff.preservesAssignment ? (
        <p className="who-decides-confirm__note">{PRESET_CONFIRM_COPY.assignmentPreserved}</p>
      ) : null}
    </div>
  );
}
