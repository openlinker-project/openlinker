/**
 * Tick Budget Bar
 *
 * The signature element of the operational-settings page (#2653), and the
 * reason the page is not a table of numbers.
 *
 * The track is the gap between two runs. The fill is how long the next run is
 * projected to take. The host's process limit is drawn as a hard edge, with
 * everything past it hatched - struck out rather than tinted, so it reads as
 * "not yours" rather than "a different colour of yours".
 *
 * The operator's real question is containment - will this finish before the
 * next one starts, and will the host kill it — and one bar answers both at
 * once, which no pair of numbers does.
 *
 * @module apps/web/src/features/settings/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { formatSeconds } from '../lib/sync-pacing-model';

interface TickBudgetBarProps {
  runSeconds: number;
  windowSeconds: number;
  hostLimitSeconds: number;
  over: boolean;
}

export function TickBudgetBar({
  runSeconds,
  windowSeconds,
  hostLimitSeconds,
  over,
}: TickBudgetBarProps): ReactElement {
  const fillPercent = Math.min(100, Math.max(0, (runSeconds / windowSeconds) * 100));
  const ceilingPercent = Math.min(100, Math.max(0, (hostLimitSeconds / windowSeconds) * 100));
  const forbiddenPercent = Math.max(0, 100 - ceilingPercent);
  const copy = useMessages('settings').tickBudgetBar;
  const run = formatSeconds(runSeconds);
  const next = formatSeconds(windowSeconds);
  const limit = formatSeconds(hostLimitSeconds);

  return (
    <div className="impact-metric">
      <div className="impact-metric__head">
        <span className="impact-metric__name">{copy.runLength}</span>
        <span className="impact-metric__value">
          {interpolate(copy.runOfWindow, { run, window: next })}
        </span>
      </div>

      <div
        className="budget-bar"
        data-over={String(over)}
        role="img"
        aria-label={[
          interpolate(copy.ariaRun, { run }),
          interpolate(copy.ariaNext, { window: next }),
          interpolate(over ? copy.ariaHostLimitPassed : copy.ariaHostLimit, { limit }),
        ].join(' ')}
      >
        <div className="budget-bar__fill" style={{ width: `${fillPercent.toFixed(1)}%` }} />
        {forbiddenPercent > 0 ? (
          <div
            className="budget-bar__forbidden"
            style={{ width: `${forbiddenPercent.toFixed(1)}%` }}
          >
            <span className="budget-bar__ceiling-label">
              {interpolate(copy.hostStopsAt, { limit })}
            </span>
          </div>
        ) : null}
      </div>

      <div className="budget-bar__scale">
        <span>{formatSeconds(0)}</span>
        <span>{interpolate(copy.nextRun, { window: next })}</span>
      </div>
    </div>
  );
}
