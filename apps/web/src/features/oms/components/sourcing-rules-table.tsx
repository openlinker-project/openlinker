/**
 * Sourcing-rules table (#3057)
 *
 * The ordered ruleset, in the order it runs. Rendering order IS evaluation
 * order — the API returns rows sorted by `position` then `id`, the same
 * tie-break the router applies, and nothing here re-sorts them. A client-side
 * sort would be a second opinion about the one thing this screen exists to
 * state, which is why the table is a plain `<table className="data-table">`
 * rather than the sortable, virtualised `DataTable`.
 *
 * ## Reorder is ARROW BUTTONS, never drag-and-drop
 *
 * Settled on #3055 (§ Decisions) in the mockup's favour. `apps/web` ships no
 * DnD library and this screen does not justify adding one; arrows are keyboard-
 * and touch-operable with no second code path, whereas a DnD implementation
 * would need exactly these buttons as its accessibility fallback anyway. The
 * `⠿` glyph is a STATIC indicator (`aria-hidden`, `cursor: default`) — it must
 * not promise an interaction nothing backs.
 *
 * ## The reorder body is EXHAUSTIVE and is built from the LIVE rows
 *
 * `PUT /order` refuses a body naming a subset and writes nothing. When the
 * caller has asked for retired rules (`includeSuperseded`), those rows are on
 * screen and must NOT be in the body — the backend's live predicate is date-
 * based, so `isLiveSourcingRule` reads the dates and not the display status.
 * A rendered-but-retired row therefore has its arrows disabled: moving a row
 * that cannot be in the body is an action with no expressible result.
 *
 * ## A disabled arrow is disabled, not hidden
 *
 * The first row's "up" and the last row's "down" stay in the DOM so the row's
 * control group does not change width as rules move, and so a keyboard user's
 * tab order is stable.
 *
 * @module apps/web/src/features/oms/components
 */
import type { ReactElement, ReactNode } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { resolveSplitCeiling } from '../lib/sourcing-rule-ceiling';
import {
  SOURCING_RULES_TABLE_COPY as COPY,
  sourcingAfterActionHint,
  sourcingAfterActionLabel,
  sourcingRuleKindHint,
  sourcingRuleNameHint,
  sourcingRuleNameLabel,
} from '../lib/sourcing-rule.copy';
import { isLiveSourcingRule, resolveSourcingRuleStatus } from '../lib/sourcing-rule-status';

export interface SourcingRulesTableProps {
  rules: readonly SourcingRule[];
  /**
   * The live ids in their new order, whenever an arrow moves a row. Always the
   * FULL live set — the caller hands it to the reorder mutation verbatim.
   */
  onReorder: (ruleIds: string[]) => void;
  /** Open the edit dialog (#3058). Never offered for an unrecognised rule. */
  onEdit?: (rule: SourcingRule) => void;
  /** Open the delete/retire flow (#3059). Offered for every rule. */
  onDelete?: (rule: SourcingRule) => void;
  /** Disables every control while a write is in flight. */
  busy?: boolean;
  /** Injected so a window boundary is pinnable in a test. */
  now?: Date;
}

/** `from … · to …`, or the honest "Always" when the rule has no bounds. */
function formatWindow(rule: SourcingRule): string {
  const parts: string[] = [];
  if (rule.effectiveFrom !== null) parts.push(`from ${formatDate(rule.effectiveFrom)}`);
  if (rule.effectiveTo !== null) parts.push(`to ${formatDate(rule.effectiveTo)}`);
  return parts.length > 0 ? parts.join(' · ') : COPY.alwaysActive;
}

/**
 * A bound the browser cannot parse is shown VERBATIM rather than as "Invalid
 * Date" — the raw value is at least quotable in a support ticket.
 */
function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface MoveButtonProps {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}

function MoveButton({ label, glyph, disabled, onClick }: MoveButtonProps): ReactElement {
  return (
    <button
      type="button"
      className="button button--ghost button--icon button--sm"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

export function SourcingRulesTable({
  rules,
  onReorder,
  onEdit,
  onDelete,
  busy = false,
  now = new Date(),
}: SourcingRulesTableProps): ReactElement {
  const { governingRuleIds } = resolveSplitCeiling(rules, now);
  const governing = new Set(governingRuleIds);

  /** The reorder set, in the order the table shows it. */
  const liveIds = rules.filter((rule) => isLiveSourcingRule(rule, now)).map((rule) => rule.id);

  function move(ruleId: string, to: 'up' | 'down' | 'top' | 'bottom'): void {
    const from = liveIds.indexOf(ruleId);
    if (from === -1) return;

    const next = [...liveIds];
    next.splice(from, 1);
    const target =
      to === 'top' ? 0 : to === 'bottom' ? next.length : to === 'up' ? from - 1 : from + 1;
    if (target < 0 || target > next.length) return;
    next.splice(target, 0, ruleId);

    onReorder(next);
  }

  return (
    <div className="data-table__container">
      <table className="data-table" aria-label={COPY.caption}>
        <thead>
          <tr>
            <th style={{ width: '96px' }} title={COPY.stepHint}>
              {COPY.stepHeader}
            </th>
            <th>{COPY.ruleHeader}</th>
            <th style={{ width: '140px' }} title={COPY.splittingHint}>
              {COPY.splittingHeader}
            </th>
            <th style={{ width: '150px' }}>{COPY.windowHeader}</th>
            <th style={{ width: '120px' }}>{COPY.statusHeader}</th>
            <th style={{ width: '96px' }}>
              <span className="sr-only">{COPY.actionsHeader}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => {
            const status = resolveSourcingRuleStatus(rule, now);
            const live = isLiveSourcingRule(rule, now);
            const liveIndex = liveIds.indexOf(rule.id);
            const isGoverning = governing.has(rule.id);
            const label = sourcingRuleNameLabel(rule.name);
            const hint = sourcingRuleNameHint(rule.name);

            const rowClasses = [
              'sourcing-rule-row',
              rule.recognised ? '' : 'sourcing-rule-row--unrecognised',
              isGoverning ? 'sourcing-rule-row--governing' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <tr key={rule.id} className={rowClasses} data-rule-id={rule.id}>
                <td>
                  <div className="rule-position">
                    <span
                      className="rule-position__handle"
                      aria-hidden="true"
                      title={COPY.stepHint}
                    >
                      ⠿
                    </span>
                    <span className="rule-position__num">{live ? liveIndex + 1 : '—'}</span>
                    <span className="rule-position__nudge">
                      <MoveButton
                        label={COPY.moveUp}
                        glyph="▲"
                        disabled={busy || !live || liveIndex === 0}
                        onClick={() => move(rule.id, 'up')}
                      />
                      <MoveButton
                        label={COPY.moveDown}
                        glyph="▼"
                        disabled={busy || !live || liveIndex === liveIds.length - 1}
                        onClick={() => move(rule.id, 'down')}
                      />
                    </span>
                  </div>
                </td>
                <td>
                  <div className="rule-cell__kind">
                    <span className="rule-cell__kind-badge" title={sourcingRuleKindHint(rule.kind) ?? undefined}>
                      {rule.kind}
                    </span>
                    <span className="rule-cell__label">{label}</span>
                  </div>
                  {isGoverning ? (
                    <div className="rule-cell__governs">
                      <span className="rule-cell__governs-dot" aria-hidden="true" />
                      {COPY.governs}
                    </div>
                  ) : null}
                  {hint === null ? null : <div className="rule-cell__desc">{hint}</div>}
                </td>
                <td>
                  <span
                    className="split-chip"
                    title={sourcingAfterActionHint(rule.afterAction) ?? undefined}
                  >
                    {sourcingAfterActionLabel(rule.afterAction)}
                  </span>
                </td>
                <td className="mono-text">{formatWindow(rule)}</td>
                <td>
                  {status.status === 'active' ? (
                    <span className="rule-state--plain" title={status.hint}>
                      <span aria-hidden="true">✓</span> {status.label}
                    </span>
                  ) : (
                    <StatusBadge tone={status.tone} withDot={status.status !== 'retired'}>
                      <span title={status.hint}>{status.label}</span>
                    </StatusBadge>
                  )}
                </td>
                <td>
                  <div className="rule-actions">
                    {renderEdit(rule, onEdit, busy)}
                    {onDelete === undefined ? null : (
                      <button
                        type="button"
                        className="button button--ghost button--icon button--sm"
                        title={`Delete ${label}`}
                        aria-label={`Delete ${label}`}
                        disabled={busy}
                        onClick={() => onDelete(rule)}
                      >
                        <span aria-hidden="true">🗑</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Edit is REFUSED, not hidden, for an unrecognised rule.
 *
 * The API rejects a patch on such a row outright — a successful edit would
 * imply it routes. A disabled control that says why is what sends the operator
 * to Delete; an absent one reads as a rendering bug.
 */
function renderEdit(
  rule: SourcingRule,
  onEdit: ((rule: SourcingRule) => void) | undefined,
  busy: boolean
): ReactNode {
  if (onEdit === undefined) return null;

  const label = sourcingRuleNameLabel(rule.name);
  const title = rule.recognised ? `Edit ${label}` : COPY.editLocked;

  return (
    <button
      type="button"
      className="button button--ghost button--icon button--sm"
      title={title}
      aria-label={title}
      disabled={busy || !rule.recognised}
      onClick={() => onEdit(rule)}
    >
      <span aria-hidden="true">✎</span>
    </button>
  );
}
