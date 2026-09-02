/**
 * Automations index (#2364, spec §5.1)
 *
 * The eight triggers, the first-run suggestion, and an honest statement of what
 * automation steps can do in this build.
 *
 * ## Four async branches, and why the order matters
 *
 * The vocabulary and the summary are two reads, and conflating their failures
 * makes false claims. A failed VOCABULARY read routes the whole page to its
 * error branch rather than rendering an empty availability panel — an empty
 * panel reads as "this build ships no automation steps", which is a claim, not
 * a gap, and it is the opposite of the truth. A failed SUMMARY read is likewise
 * an error, never an empty index: eight rows reading `No rules` would tell an
 * operator their automations had vanished.
 *
 * The suggestion card waits for the summary to SETTLE. Rendering it while the
 * counts are loading would flash "You have no automations yet." at an operator
 * who has ten, then swap it away — two contradictory claims in one second, the
 * defect the returns list documents at length.
 *
 * @module apps/web/src/pages/automations
 */
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Button } from '../../shared/ui/button';
import { Alert } from '../../shared/ui/alert';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import {
  AUTOMATIONS_PAGE_COPY,
  AUTOMATION_ERROR_COPY,
  AUTOMATION_INDEX_COPY,
  AutomationActionAvailabilityPanel,
  AutomationSuggestionCard,
  AutomationTriggerIndex,
  buildTriggerRows,
  useAutomationSummaryQuery,
  useAutomationVocabularyQuery,
} from '../../features/automation';

/**
 * The trigger the §5.1 suggestion is built on (T5 → A2 → A3).
 *
 * The composer (#2365) reads `compose=suggested` to pre-fill; nothing is
 * created by navigating, which is what makes the card a suggestion rather than
 * a rule that exists before the operator saved it.
 */
const SUGGESTED_TRIGGER = 'order.packed';

export function AutomationsPage(): ReactElement {
  const navigate = useNavigate();
  const vocabularyQuery = useAutomationVocabularyQuery();
  const summaryQuery = useAutomationSummaryQuery();

  const rows = useMemo(
    () => buildTriggerRows(summaryQuery.data?.items ?? [], vocabularyQuery.data),
    [summaryQuery.data, vocabularyQuery.data],
  );

  const header = (
    <Button tone="secondary" onClick={() => void navigate('/automations/activity')}>
      {AUTOMATIONS_PAGE_COPY.runLogAction}
    </Button>
  );

  if (vocabularyQuery.isLoading || summaryQuery.isLoading) {
    return (
      <PageLayout
        eyebrow={AUTOMATIONS_PAGE_COPY.eyebrow}
        title={AUTOMATIONS_PAGE_COPY.title}
        description={AUTOMATIONS_PAGE_COPY.description}
        actions={header}
      >
        <LoadingState
          title={AUTOMATION_ERROR_COPY.loadingTitle}
          message={AUTOMATION_ERROR_COPY.loadingMessage}
        />
      </PageLayout>
    );
  }

  // The vocabulary is checked FIRST and on its own: without it the page cannot
  // say which steps work, and it must not guess.
  if (vocabularyQuery.error) {
    return (
      <PageLayout
        eyebrow={AUTOMATIONS_PAGE_COPY.eyebrow}
        title={AUTOMATIONS_PAGE_COPY.title}
        actions={header}
      >
        <ErrorState
          title={AUTOMATION_ERROR_COPY.vocabularyTitle}
          message={AUTOMATION_ERROR_COPY.vocabularyMessage}
        />
      </PageLayout>
    );
  }

  if (summaryQuery.error) {
    return (
      <PageLayout
        eyebrow={AUTOMATIONS_PAGE_COPY.eyebrow}
        title={AUTOMATIONS_PAGE_COPY.title}
        actions={header}
      >
        <ErrorState
          title={AUTOMATION_ERROR_COPY.summaryTitle}
          message={summaryQuery.error.message}
        />
      </PageLayout>
    );
  }

  // The envelope itself was unreadable: zero items AND zero drops, which the
  // `hasNoRules` test below reads as "you have no automations". Showing the
  // first-run suggestion card there tells an operator with ten rules that they
  // have none — the same false claim `droppedCount` exists to prevent, arriving
  // by the one route a row counter cannot see (`returns.schema.ts` precedent).
  if (summaryQuery.data?.envelopeUnreadable === true) {
    return (
      <PageLayout
        eyebrow={AUTOMATIONS_PAGE_COPY.eyebrow}
        title={AUTOMATIONS_PAGE_COPY.title}
        actions={header}
      >
        <ErrorState
          title={AUTOMATION_ERROR_COPY.unreadableTitle}
          message={AUTOMATION_ERROR_COPY.unreadableEnvelopeMessage}
        />
      </PageLayout>
    );
  }

  const droppedCount = summaryQuery.data?.droppedCount ?? 0;
  // Settled, and genuinely zero across every trigger — never merely "the page
  // has not loaded yet". The card disappears the moment any rule exists and
  // does not come back after the last one is deleted, because it is derived
  // from the live counts rather than from a dismissal flag.
  const hasNoRules = rows.length > 0 && rows.every((row) => row.ruleCount === 0);

  return (
    <PageLayout
      eyebrow={AUTOMATIONS_PAGE_COPY.eyebrow}
      title={AUTOMATIONS_PAGE_COPY.title}
      description={AUTOMATIONS_PAGE_COPY.description}
      actions={header}
    >
      {hasNoRules ? (
        <AutomationSuggestionCard
          onSetUp={() =>
            void navigate(
              `/automations/${encodeURIComponent(SUGGESTED_TRIGGER)}?compose=suggested`,
            )
          }
          onStartFromScratch={() =>
            void navigate(`/automations/${encodeURIComponent(SUGGESTED_TRIGGER)}?compose=new`)
          }
        />
      ) : null}

      {droppedCount > 0 ? (
        <Alert tone="warning">{AUTOMATION_INDEX_COPY.droppedRows(droppedCount)}</Alert>
      ) : null}

      <AutomationTriggerIndex rows={rows} />

      {vocabularyQuery.data ? (
        <AutomationActionAvailabilityPanel actions={vocabularyQuery.data.actions} />
      ) : null}
    </PageLayout>
  );
}
