/**
 * Who-Decides Panel
 *
 * The page body: the three arrangement cards, the always-rendered seven-row
 * table, and the apply flow with its three distinguishable outcomes.
 *
 * ## No arrangement is pre-selected, deliberately
 *
 * The status payload does not report which arrangement is in force, and it
 * CANNOT: `openlinker-decides` means every assignable claim is switched off,
 * which on a fresh install is indistinguishable from nobody having configured
 * anything. Pre-selecting a card would therefore assert something OpenLinker
 * does not know. The spec's own wording settles the rendering — the `Current`
 * badge is "shown only while selected" — so the operator's choice in this
 * session is what carries it.
 *
 * ## The selection is component-local state
 *
 * Not a `?preset=` search param: this is a transient pre-submit choice, and a
 * URL param would make a half-made decision look linkable and restorable.
 * Server state is the query; this is the only local piece.
 *
 * ## The confirm dialog is generated, and it can refuse
 *
 * Its body comes from the server's own diff (#2355), so a new arrangement or a
 * new decision row cannot ship a dialog that says something untrue. It also
 * carries the refusal: when the RESULT would leave two systems deciding the
 * same thing the save is blocked before it is attempted, rather than reported
 * afterwards. `isPresetConfirmBlocked` answers that once and both the button
 * and the body read it, so they cannot disagree.
 *
 * ## Three outcomes, not one
 *
 * A save can succeed, be REFUSED (422 — the result would leave two systems
 * deciding the same thing, and nothing was written), or land PARTIALLY (the
 * write is N independent saves and cannot be atomic). Reporting a flat success
 * for the third would tell the operator the arrangement is in place when part
 * of it is not; the remedy is to choose the same arrangement again, which
 * converges.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { ApiError } from '../../../shared/api/api-error';
import { useConnectionsQuery } from '../../connections';
import { useDemoMode } from '../../system';
import { useApplyPresetMutation } from '../hooks/use-apply-preset-mutation';
import { usePresetPreviewQuery } from '../hooks/use-preset-preview-query';
import { useWhoDecidesStatusQuery } from '../hooks/use-who-decides-status-query';
import type { AuthorityPresetId } from '../api/who-decides.types';
import {
  PRESET_ACTION_COPY,
  PRESET_CARD_COPY,
  QUESTION_ORDER,
  WHO_DECIDES_PAGE_COPY,
} from '../lib/who-decides.copy';
import { AttentionSection } from './attention-section';
import {
  WhoDecidesPresetConfirm,
  isPresetConfirmBlocked,
} from './who-decides-preset-confirm';
import { WhoDecidesPresetCards } from './who-decides-preset-cards';
import { WhoDecidesQuestionRow } from './who-decides-question-row';

/** What the last save attempt produced, in the operator's terms. */
type ApplyOutcome =
  | { kind: 'none' }
  | { kind: 'saved' }
  | { kind: 'partial'; connectionIds: readonly string[] }
  | { kind: 'ambiguous'; connectionIds: readonly string[] }
  | { kind: 'rejected' }
  | { kind: 'failed' }
  /**
   * The request succeeded and its body could not be read.
   *
   * Never `saved`: `parseAuthorityStatus` yields `null` on any whole-envelope
   * parse failure, so `result?.applied?.failedConnectionIds ?? []` would report
   * an empty failure list for a partially-applied write and announce success
   * for it. The preview path already gets this right and says so in its own
   * docblock; this is the same rule on the write.
   */
  | { kind: 'unreadable' };

/**
 * The connections whose competing claims caused a 422.
 *
 * The service throws `{ message, presetId, ambiguities }`, where `ambiguities`
 * is a list of inert states and **the ids live one level down**, on each item's
 * `connectionIds` (`authority-status.service.ts`). An earlier version of this
 * read a top-level `candidateConnectionIds`, which the endpoint never sends —
 * so a real refusal named nobody, on the one screen whose whole job is telling
 * the operator which two systems are fighting. Its test passed because the
 * fixture asserted that same invented shape; the fixture is now built from the
 * real envelope.
 *
 * Ids are flattened across items and deduped: two authorities can be ambiguous
 * because of the same pair of connections, and naming a connection twice reads
 * as two different problems.
 *
 * Read defensively — this is an error body, so a shape this build does not
 * recognise degrades to naming none rather than throwing inside the error path.
 */
function readAmbiguousConnectionIds(error: unknown): readonly string[] {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null) {
    return [];
  }
  const details = error.details as Record<string, unknown>;
  if (!Array.isArray(details.ambiguities)) {
    return [];
  }

  const ids: string[] = [];
  for (const item of details.ambiguities) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const connectionIds = (item as Record<string, unknown>).connectionIds;
    if (!Array.isArray(connectionIds)) {
      continue;
    }
    for (const id of connectionIds) {
      if (typeof id === 'string' && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

export function WhoDecidesPanel(): ReactElement {
  const statusQuery = useWhoDecidesStatusQuery();
  const connectionsQuery = useConnectionsQuery();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const applyPreset = useApplyPresetMutation();

  const [selected, setSelected] = useState<AuthorityPresetId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<ApplyOutcome>({ kind: 'none' });
  // The dry run. A read, and gated on the dialog being open — merely selecting
  // an arrangement is not the operator asking what it would do.
  const previewQuery = usePresetPreviewQuery(selected, confirming);

  // A failed connections read costs NAMES, not correctness: every row still
  // renders its answer, its why-line and its badge, and an unresolved id falls
  // back to the id itself — which is what the response actually said.
  const connectionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const connection of connectionsQuery.data ?? []) {
      map.set(connection.id, connection.name);
    }
    return map;
  }, [connectionsQuery.data]);

  // Falls back to the id, not a placeholder: two unresolvable connections must
  // stay tellable apart, which is the whole point of naming them here.
  const nameFor = (id: string): string => connectionNames.get(id) ?? id;

  if (statusQuery.isLoading) {
    return (
      <LoadingState
        title={WHO_DECIDES_PAGE_COPY.loadingTitle}
        message={WHO_DECIDES_PAGE_COPY.loading}
      />
    );
  }

  const status = statusQuery.data;
  // An unreadable envelope renders an error, never an empty table: § 2.3
  // promises seven rows on any install, so an empty table would be a false
  // claim about the operator's own setup.
  if (statusQuery.isError || !status) {
    return (
      <ErrorState
        title={WHO_DECIDES_PAGE_COPY.errorTitle}
        message={WHO_DECIDES_PAGE_COPY.errorMessage}
        action={
          <button
            className="button button--secondary button--sm"
            type="button"
            onClick={() => void statusQuery.refetch()}
          >
            {WHO_DECIDES_PAGE_COPY.retryLabel}
          </button>
        }
      />
    );
  }

  const rowsByQuestion = new Map(status.rows.map((row) => [row.question, row]));

  const runApply = (presetId: AuthorityPresetId): void => {
    applyPreset.mutate(presetId, {
      onSuccess: (result) => {
        if (result === null) {
          setOutcome({ kind: 'unreadable' });
          return;
        }
        const failed = result.applied?.failedConnectionIds ?? [];
        setOutcome(
          failed.length > 0 ? { kind: 'partial', connectionIds: failed } : { kind: 'saved' },
        );
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 422) {
          setOutcome({ kind: 'ambiguous', connectionIds: readAmbiguousConnectionIds(error) });
          return;
        }
        if (error instanceof ApiError && error.status === 400) {
          setOutcome({ kind: 'rejected' });
          return;
        }
        setOutcome({ kind: 'failed' });
      },
    });
  };

  return (
    <div className="who-decides">
      <section className="who-decides__section" aria-labelledby="who-decides-presets-heading">
        <p className="eyebrow">{WHO_DECIDES_PAGE_COPY.presetsEyebrow}</p>
        <h2 className="section-title" id="who-decides-presets-heading">
          {WHO_DECIDES_PAGE_COPY.presetsHeading}
        </h2>

        <WhoDecidesPresetCards
          presets={status.presets}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setOutcome({ kind: 'none' });
          }}
          disabled={!write.canWrite}
        />

        {outcome.kind === 'saved' ? (
          <Alert tone="success" title={PRESET_ACTION_COPY.successTitle}>
            {PRESET_ACTION_COPY.successMessage}
          </Alert>
        ) : null}
        {outcome.kind === 'partial' ? (
          <Alert tone="warning" title={PRESET_ACTION_COPY.partialTitle}>
            {PRESET_ACTION_COPY.partialMessage}
            <ul className="who-decides__id-list">
              {outcome.connectionIds.map((id) => (
                <li key={id}>
                  <Link to={`/connections/${id}`}>{nameFor(id)}</Link>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {outcome.kind === 'ambiguous' ? (
          <Alert tone="error" title={PRESET_ACTION_COPY.ambiguousTitle}>
            {PRESET_ACTION_COPY.ambiguousMessage}
            <ul className="who-decides__id-list">
              {outcome.connectionIds.map((id) => (
                <li key={id}>
                  <Link to={`/connections/${id}`}>{nameFor(id)}</Link>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {outcome.kind === 'rejected' ? (
          <Alert tone="error" title={PRESET_ACTION_COPY.rejectedTitle}>
            {PRESET_ACTION_COPY.rejectedMessage}
          </Alert>
        ) : null}
        {outcome.kind === 'failed' ? (
          <Alert tone="error" title={PRESET_ACTION_COPY.failedTitle}>
            {PRESET_ACTION_COPY.failedMessage}
          </Alert>
        ) : null}
        {outcome.kind === 'unreadable' ? (
          <Alert tone="warning" title={PRESET_ACTION_COPY.unreadableTitle}>
            {PRESET_ACTION_COPY.unreadableMessage}
          </Alert>
        ) : null}

        {write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <button
              className="button button--primary who-decides__apply"
              type="button"
              disabled={write.demoReadOnly || selected === null || applyPreset.isPending}
              onClick={() => setConfirming(true)}
            >
              {applyPreset.isPending
                ? PRESET_ACTION_COPY.applyingLabel
                : PRESET_ACTION_COPY.applyLabel}
            </button>
          </ReadOnlyLock>
        ) : (
          <p className="muted-text">{PRESET_ACTION_COPY.readOnly}</p>
        )}
      </section>

      <section className="who-decides__section" aria-labelledby="who-decides-questions-heading">
        <div className="who-decides__section-head">
          <div>
            <p className="eyebrow">{WHO_DECIDES_PAGE_COPY.questionsEyebrow}</p>
            <h2 className="section-title" id="who-decides-questions-heading">
              {WHO_DECIDES_PAGE_COPY.questionsHeading}
            </h2>
          </div>
          <span className="panel__meta">{WHO_DECIDES_PAGE_COPY.questionsCounter}</span>
        </div>

        {/*
          Iterate the declared question order, not the response array — the
          server sends them in that order today and the page must not silently
          depend on it.
        */}
        <div className="who-decides__rows">
          {QUESTION_ORDER.map((question) => {
            const row = rowsByQuestion.get(question);
            return row ? (
              <WhoDecidesQuestionRow
                key={question}
                row={row}
                attention={status.attention}
                connectionNames={connectionNames}
              />
            ) : null;
          })}
        </div>
      </section>

      {/*
        Below the questions, deliberately: the table answers "who decides what",
        and this answers "what is consequently not happening". Reading the second
        before the first would ask the operator to act on a consequence whose
        cause is further down the page.
      */}
      <AttentionSection attention={status.attention} nameFor={nameFor} />

      <ConfirmDialog
        open={confirming && selected !== null}
        onOpenChange={setConfirming}
        title={PRESET_ACTION_COPY.confirmTitle}
        confirmLabel={PRESET_ACTION_COPY.confirmLabel}
        cancelLabel={PRESET_ACTION_COPY.cancelLabel}
        isConfirming={applyPreset.isPending}
        confirmDisabled={isPresetConfirmBlocked(
          previewQuery.data,
          previewQuery.isLoading,
          previewQuery.isError,
        )}
        /*
          The description is a `<p>`, so it carries only the always-present P7
          sentence — which is exactly the sentence that should be the dialog's
          accessible description. Everything with structure goes in `body`.
        */
        description={WHO_DECIDES_PAGE_COPY.prospectiveOnly}
        body={
          <>
            {selected ? (
              <p className="who-decides-confirm__preset">{PRESET_CARD_COPY[selected].title}</p>
            ) : null}
            <WhoDecidesPresetConfirm
              preview={previewQuery.data}
              isLoading={previewQuery.isLoading}
              isError={previewQuery.isError}
              connectionNames={connectionNames}
              onRetry={() => void previewQuery.refetch()}
            />
          </>
        }
        onConfirm={() => {
          setConfirming(false);
          if (selected) {
            runApply(selected);
          }
        }}
      />
    </div>
  );
}
