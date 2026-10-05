/**
 * Setup checklist (#3457)
 *
 * The three facts the setup rests on — product masters, stock located, packers
 * — rendered the same way in step 4's summary and on the status page, so the
 * two cannot describe the setup differently. Each row carries its own action,
 * which differs between the two surfaces (go back to a step vs. open a page).
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement, ReactNode } from 'react';

export interface SetupChecklistRow {
  readonly key: string;
  readonly ok: boolean;
  readonly title: string;
  readonly detail: string;
  readonly action: ReactNode;
}

/**
 * The order the setup is shown in, the wizard's own: what the shop sells, then
 * which documents it issues, then who packs, then the rest. Every list reads it
 * through this one place, so the summary and the status page cannot order the
 * same setup differently from the steps that made it.
 */
const CHECKLIST_ORDER = ['masters', 'stock', 'salesDocuments', 'packers', 'automations', 'whoDecides'];

export function orderChecklistRows(rows: readonly SetupChecklistRow[]): SetupChecklistRow[] {
  const position = (key: string): number => {
    const index = CHECKLIST_ORDER.indexOf(key);
    return index === -1 ? CHECKLIST_ORDER.length : index;
  };
  return [...rows].sort((a, b) => position(a.key) - position(b.key));
}

export function SetupChecklist({
  rows,
  testId,
}: {
  readonly rows: readonly SetupChecklistRow[];
  readonly testId: string;
}): ReactElement {
  return (
    <ul className="oms-onboarding__checks" data-testid={testId}>
      {orderChecklistRows(rows).map((row) => (
        <li key={row.key} className="oms-onboarding__check">
          <span
            className={row.ok ? 'oms-onboarding__tick oms-onboarding__tick--ok' : 'oms-onboarding__tick oms-onboarding__tick--warn'}
            aria-hidden="true"
          >
            {row.ok ? '✓' : '…'}
          </span>
          <span className="oms-onboarding__check-text">
            <span className="oms-onboarding__check-title">{row.title}</span>
            <span className="oms-onboarding__check-detail">{row.detail}</span>
          </span>
          {row.action}
        </li>
      ))}
    </ul>
  );
}
