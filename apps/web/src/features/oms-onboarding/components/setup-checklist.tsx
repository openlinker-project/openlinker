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

export function SetupChecklist({
  rows,
  testId,
}: {
  readonly rows: readonly SetupChecklistRow[];
  readonly testId: string;
}): ReactElement {
  return (
    <ul className="oms-onboarding__checks" data-testid={testId}>
      {rows.map((row) => (
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
