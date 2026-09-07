/**
 * Analytics Coverage Alert
 *
 * The dismissible, green, inline success banner (`.coverage-alert`) shown
 * inside the Data Coverage panel once a currency remediation run resolves
 * (#2478, epic #2452 Phase 7 Task 7.4). Deliberately its own component and
 * NOT `shared/ui/toast-provider.tsx` — a toast was explicitly rejected
 * during the mockup's own design review, and keeping this file free of any
 * `toast-provider` import is the regression guard the task's own AC names.
 *
 * Dismissal is local component state, owned by the caller — reloading the
 * page and finding a fresh `resolved` transition must always show the
 * alert again; this is per-transition feedback, not a permanently
 * dismissable banner.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';

interface AnalyticsCoverageAlertProps {
  /**
   * `AnalyticsRemediationRunResponseDto.affectedCount` is a point-in-time
   * figure taken when the run was opened, not a count of what it actually
   * repaired (completion is decided by re-reading the population, not by
   * counting down from this) — so the banner names it as the population the
   * run was authorized against, never as a confirmed "recalculated" count
   * (#2668 review, finding 17). A `0` here is real (the run found nothing
   * to do at open time), not a fallback masking a missing figure.
   */
  affectedCount: number;
  onDismiss: () => void;
}

export function AnalyticsCoverageAlert({
  affectedCount,
  onDismiss,
}: AnalyticsCoverageAlertProps): ReactElement {
  return (
    <div className="coverage-alert" role="status">
      <span className="coverage-alert__icon" aria-hidden="true">
        ✓
      </span>
      <span className="coverage-alert__body">
        <span className="coverage-alert__title">
          Recalculation finished for the {affectedCount} order{affectedCount === 1 ? '' : 's'} you
          selected
        </span>
        <span className="coverage-alert__sub">
          The real exchange rate from each order&rsquo;s own date, saved for good. Logged in Jobs &amp;
          Logs with who ran it and when.
        </span>
      </span>
      <button type="button" className="coverage-alert__close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
