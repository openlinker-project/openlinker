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
 * ## Focus survives the press that disables the button under it
 *
 * A keyboard user nudges a row upwards by pressing the same arrow repeatedly.
 * On the press that lands it at position 1 that arrow becomes `disabled`, and
 * the browser drops focus to `<body>` - so the one press that completes the
 * task is the one that strands the user, with nothing announced and no way
 * back except re-tabbing the whole table. After the reordered set renders,
 * focus is put back on the arrow that was pressed, or on its opposite when
 * that arrow is now the disabled end-stop.
 *
 * @module apps/web/src/features/oms/components
 */
import { useEffect, useMemo, useRef } from 'react';
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
  /** Open the edit dialog (#3058). Never reached for an unrecognised rule. */
  onEdit?: (rule: SourcingRule) => void;
  /**
   * Called INSTEAD of `onEdit` for a rule this build cannot evaluate (#3061).
   *
   * The control stays enabled deliberately. A `disabled` button cannot be
   * focused in every browser and its `title` is not reliably announced, so the
   * explanation would be unreachable for exactly the operator who needs it —
   * and the remedy (delete and re-create) would go unsaid. Enabled-and-refusing
   * is what lets the refusal carry its own copy and its own action.
   */
  onEditRefused?: (rule: SourcingRule) => void;
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

type MoveDirection = 'up' | 'down' | 'top' | 'bottom';

/** The arrow a press hands focus to when the pressed one becomes the end-stop. */
const FOCUS_FALLBACK: Record<MoveDirection, MoveDirection> = {
  up: 'down',
  down: 'up',
  top: 'bottom',
  bottom: 'top',
};

interface MoveButtonProps {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
  /** Registers the element so focus can be restored after a reorder. */
  register: (element: HTMLButtonElement | null) => void;
}

function MoveButton({ label, glyph, disabled, onClick, register }: MoveButtonProps): ReactElement {
  return (
    <button
      type="button"
      ref={register}
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
  onEditRefused,
  onDelete,
  busy = false,
  now: nowProp,
}: SourcingRulesTableProps): ReactElement {
  /* A default-parameter `new Date()` is a fresh instant on every render, so the
     status and ceiling reads drift against each other while nothing schedules a
     re-render at a window boundary. One instant per mount instead. */
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;

  const { governingRuleIds } = resolveSplitCeiling(rules, now);
  const governing = new Set(governingRuleIds);

  /** The reorder set, in the order the table shows it. */
  const liveIds = rules.filter((rule) => isLiveSourcingRule(rule, now)).map((rule) => rule.id);

  const arrowsRef = useRef(new Map<string, HTMLButtonElement | null>());
  const pendingFocusRef = useRef<{ ruleId: string; direction: MoveDirection } | null>(null);

  /**
   * Keyed on the RENDERED order rather than on the click, because the caller's
   * reorder is a server round-trip: at click time the row has not moved yet, so
   * restoring focus there would put it back on a button that is about to be
   * disabled. A failed reorder leaves the order unchanged, the effect never
   * runs, and focus stays where the browser already had it.
   */
  const renderedOrder = liveIds.join(',');
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    pendingFocusRef.current = null;

    const pressed = arrowsRef.current.get(`${pending.ruleId}:${pending.direction}`);
    if (pressed && !pressed.disabled) {
      pressed.focus();
      return;
    }
    // The pressed arrow is now the end-stop, so the row's other arrow is the
    // nearest control that still means something for this row.
    arrowsRef.current.get(`${pending.ruleId}:${FOCUS_FALLBACK[pending.direction]}`)?.focus();
  }, [renderedOrder]);

  function registerArrow(ruleId: string, direction: MoveDirection) {
    return (element: HTMLButtonElement | null): void => {
      const key = `${ruleId}:${direction}`;
      if (element === null) arrowsRef.current.delete(key);
      else arrowsRef.current.set(key, element);
    };
  }

  function move(ruleId: string, to: MoveDirection): void {
    const from = liveIds.indexOf(ruleId);
    if (from === -1) return;

    const next = [...liveIds];
    next.splice(from, 1);
    const target =
      to === 'top' ? 0 : to === 'bottom' ? next.length : to === 'up' ? from - 1 : from + 1;
    if (target < 0 || target > next.length) return;
    next.splice(target, 0, ruleId);

    pendingFocusRef.current = { ruleId, direction: to };
    onReorder(next);
  }

  return (
    <div className="data-table__container">
      <table className="data-table">
        {/* A real <caption> rather than `title` on two <th>s: a `title` is not
            reliably announced, never appears on touch, and needs a hover-and-
            wait on desktop - so the two sentences that explain what the screen
            IS were the least reachable text on it. The caption also labels the
            table natively, which is why the `aria-label` is gone rather than
            kept alongside it. */}
        <caption className="sourcing-rules-table__caption">
          {COPY.caption}
          <span className="sourcing-rules-table__caption-hint">{COPY.stepHint}</span>
          <span className="sourcing-rules-table__caption-hint">{COPY.splittingHint}</span>
        </caption>
        <thead>
          <tr>
            <th style={{ width: '96px' }}>{COPY.stepHeader}</th>
            <th>{COPY.ruleHeader}</th>
            <th style={{ width: '140px' }}>{COPY.splittingHeader}</th>
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
                        register={registerArrow(rule.id, 'up')}
                      />
                      <MoveButton
                        label={COPY.moveDown}
                        glyph="▼"
                        disabled={busy || !live || liveIndex === liveIds.length - 1}
                        onClick={() => move(rule.id, 'down')}
                        register={registerArrow(rule.id, 'down')}
                      />
                    </span>
                    <span className="rule-position__jump">
                      <MoveButton
                        label={COPY.moveToTop}
                        glyph="⤒"
                        disabled={busy || !live || liveIndex === 0}
                        onClick={() => move(rule.id, 'top')}
                        register={registerArrow(rule.id, 'top')}
                      />
                      <MoveButton
                        label={COPY.moveToBottom}
                        glyph="⤓"
                        disabled={busy || !live || liveIndex === liveIds.length - 1}
                        onClick={() => move(rule.id, 'bottom')}
                        register={registerArrow(rule.id, 'bottom')}
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
                    {renderEdit(rule, onEdit, onEditRefused, busy)}
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
 * imply it routes. The control therefore stays ENABLED and routes to
 * `onEditRefused` (#3061), which explains why and offers the one remedy there
 * is. Disabling it instead would put the explanation somewhere an operator
 * cannot reliably read it, and hiding it would read as a rendering bug.
 *
 * With no `onEditRefused` supplied the control falls back to disabled, so a
 * caller that has not wired the explanation still cannot open the form on a
 * rule the server will refuse — and only THERE does it keep the refusal as its
 * name. An enabled control announces the affordance instead, because a button
 * whose accessible name says it cannot act, and then acts, sends a sighted
 * operator and a screen-reader user past the only remedy the row has.
 */
function renderEdit(
  rule: SourcingRule,
  onEdit: ((rule: SourcingRule) => void) | undefined,
  onEditRefused: ((rule: SourcingRule) => void) | undefined,
  busy: boolean
): ReactNode {
  // Either handler is enough to render something; a caller that wires only the
  // refusal still has an unrecognised row to explain.
  if (onEdit === undefined && onEditRefused === undefined) return null;

  const refused = !rule.recognised;
  // A recognised rule has nothing to offer without the edit handler itself.
  if (!refused && onEdit === undefined) return null;

  const label = sourcingRuleNameLabel(rule.name);
  const inert = refused && onEditRefused === undefined;
  const title = refused ? (inert ? COPY.editLocked : COPY.editRefusedAction) : `Edit ${label}`;

  return (
    <button
      type="button"
      className="button button--ghost button--icon button--sm"
      title={title}
      aria-label={title}
      disabled={busy || inert}
      onClick={() => (refused ? onEditRefused?.(rule) : onEdit?.(rule))}
    >
      <span aria-hidden="true">✎</span>
    </button>
  );
}
