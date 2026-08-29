/**
 * The trigger index (#2364)
 *
 * The eight v1 triggers as scannable rows: what the event is, how many rules
 * the operator has on it, what those rules could actually do in this build, and
 * a way in. Mirrors `sales-document-country-index.tsx` in shape and reuses
 * `DataTable`, whose `cardView` gives the mobile layout and whose `rowHref`
 * makes the whole row the tap target — so no row height outside the documented
 * density table is introduced.
 *
 * ## The `Last acted` column says "not recorded", not "never"
 *
 * There is no field to read. `GET /automations/summary` returns a trigger and
 * a count; whether a firing was recorded at all is a per-rule fact
 * (`recordingAvailable`), and there is no combined run-log route. A dash in
 * this column would be read as "nothing has ever happened" — a claim about the
 * operator's own history that no response supports. The column states what is
 * true instead, which is that OpenLinker is not keeping this yet.
 *
 * ## `What it can do now` is derived from the vocabulary, not guessed
 *
 * Per trigger: of the actions the §5.4 matrix declares legal for it, how many
 * can actually run. A trigger whose every legal action is unavailable is worth
 * knowing about BEFORE building a rule on it.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { AUTOMATION_FIRING_MODE_COPY, AUTOMATION_INDEX_COPY, AUTOMATIONS_PAGE_COPY } from '../lib/automation.copy';
import { describeTrigger } from '../lib/automation-trigger-labels';
import type {
  AutomationTrigger,
  AutomationTriggerSummary,
  AutomationVocabulary,
} from '../api/automation.types';

export interface AutomationTriggerRow {
  trigger: AutomationTrigger;
  ruleCount: number;
  /** Legal actions for this trigger that can actually run (`available` or `partial`). */
  runnableActionCount: number;
  legalActionCount: number;
  firingMode: string | null;
}

/**
 * Join the summary counts to the vocabulary.
 *
 * Driven by the SUMMARY's own row order, which the backend guarantees covers
 * every trigger including the zeros — a trigger absent from the index reads as
 * "not supported" rather than "nothing configured", and only the second is
 * something an operator can act on.
 */
export function buildTriggerRows(
  summary: AutomationTriggerSummary[],
  vocabulary: AutomationVocabulary | undefined,
): AutomationTriggerRow[] {
  const byTrigger = new Map(vocabulary?.triggers.map((entry) => [entry.value, entry]) ?? []);
  const runnable = new Set(
    vocabulary?.actions
      .filter((action) => action.availability !== 'unavailable')
      .map((action) => action.action) ?? [],
  );

  return summary.map((entry) => {
    const vocab = byTrigger.get(entry.trigger);
    const legalActions = vocab?.legalActions ?? [];
    return {
      trigger: entry.trigger,
      ruleCount: entry.ruleCount,
      legalActionCount: legalActions.length,
      runnableActionCount: legalActions.filter((action) => runnable.has(action)).length,
      firingMode: vocab?.firingMode ?? null,
    };
  });
}

function describeRuleCount(count: number): string {
  if (count === 0) return AUTOMATION_INDEX_COPY.ruleCountNone;
  if (count === 1) return AUTOMATION_INDEX_COPY.ruleCountOne;
  return AUTOMATION_INDEX_COPY.ruleCountMany(count);
}

interface AutomationTriggerIndexProps {
  rows: AutomationTriggerRow[];
}

export function AutomationTriggerIndex({ rows }: AutomationTriggerIndexProps): ReactElement {
  const columns: DataTableColumn<AutomationTriggerRow>[] = [
    {
      id: 'trigger',
      header: AUTOMATION_INDEX_COPY.triggerHeader,
      cell: (row): ReactElement => {
        const described = describeTrigger(row.trigger);
        return (
          <div className="automation-index__trigger">
            <span>{described.label}</span>
            {described.description === null ? null : (
              <span className="muted-text">{described.description}</span>
            )}
            <span className="mono-text">{row.trigger}</span>
          </div>
        );
      },
    },
    {
      id: 'rules',
      header: AUTOMATION_INDEX_COPY.rulesHeader,
      cell: (row) => <span>{describeRuleCount(row.ruleCount)}</span>,
    },
    {
      id: 'can-do',
      header: AUTOMATION_INDEX_COPY.canDoHeader,
      hideBelow: 1024,
      cell: (row): ReactElement => {
        if (row.legalActionCount === 0) return <EmptyValue label={AUTOMATION_INDEX_COPY.canDoHeader} />;
        const tone = row.runnableActionCount === 0 ? 'error' : 'success';
        return (
          <StatusBadge tone={tone} withDot compact>
            {AUTOMATION_INDEX_COPY.runnableSteps(
              row.runnableActionCount,
              row.legalActionCount,
            )}
          </StatusBadge>
        );
      },
    },
    {
      id: 'last-fired',
      header: AUTOMATION_INDEX_COPY.lastFiredHeader,
      hideBelow: 1024,
      cell: () => (
        <span title={AUTOMATION_INDEX_COPY.lastFiredUnknownHint}>
          <EmptyValue label={AUTOMATION_INDEX_COPY.lastFiredUnknown} />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={AUTOMATIONS_PAGE_COPY.tableCaption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.trigger}
      rowHref={(row) => encodeURIComponent(row.trigger)}
      rowLinkDisplay="block"
      cardView={{
        title: (row) => describeTrigger(row.trigger).label,
        subtitle: (row) => describeTrigger(row.trigger).description,
        meta: (row) => (
          <span>
            {describeRuleCount(row.ruleCount)}
            {row.firingMode === null
              ? ''
              : ` · ${(AUTOMATION_FIRING_MODE_COPY as Record<string, string>)[row.firingMode] ?? row.firingMode}`}
          </span>
        ),
      }}
    />
  );
}
