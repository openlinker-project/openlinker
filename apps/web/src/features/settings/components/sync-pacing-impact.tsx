/**
 * Sync Pacing Impact
 *
 * The right-hand column of the operational-settings page: the containment bar,
 * the two warnings it can raise, a plain before/after list, and the panel that
 * states what none of these numbers can tell you.
 *
 * The two warnings are deliberately separate. "The host will kill this run"
 * and "runs will queue behind each other" are different failures with
 * different fixes, and sharing one sentence between them would let an
 * operator apply the wrong remedy.
 *
 * @module apps/web/src/features/settings/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import {
  formatDays,
  formatSeconds,
  suggestCatalogueValueWithin,
  type SyncPacingProjection,
} from '../lib/sync-pacing-model';
import type { ValueLimits } from '../lib/resolve-value-limits';
import { TickBudgetBar } from './tick-budget-bar';

interface SyncPacingImpactProps {
  before: SyncPacingProjection;
  after: SyncPacingProjection;
  catalogueValue: number;
  catalogueLimits: ValueLimits;
  hostLimitSeconds: number;
  catalogueSizeKnown: boolean;
}

type RowTone = 'better' | 'worse' | null;

interface ImpactRow {
  key: string;
  label: string;
  from: string;
  to: string;
  tone: RowTone;
}

/** Shorter waiting and lighter load are better; the caller never decides this per row. */
function toneFor(before: number | null, after: number | null): RowTone {
  if (before === null || after === null || before === after) {
    return null;
  }
  return after > before ? 'worse' : 'better';
}

const UNKNOWN = '—';

export function SyncPacingImpact({
  before,
  after,
  catalogueValue,
  catalogueLimits,
  hostLimitSeconds,
  catalogueSizeKnown,
}: SyncPacingImpactProps): ReactElement {
  // Clamped to the ABSOLUTE ceiling, not the recommended one: the suggestion
  // answers "what fits your host", and a host that can take more than we
  // suggest should be told the number that fits it. Crossing the
  // recommendation still costs an acknowledgement at the control.
  const suggestion = suggestCatalogueValueWithin(hostLimitSeconds, {
    min: catalogueLimits.min,
    max: catalogueLimits.absoluteMax,
  });

  const rows: ImpactRow[] = [
    {
      key: 'catalogueRequests',
      label: 'Shop requests per catalogue run',
      from: String(before.catalogueRequestsPerRun),
      to: String(after.catalogueRequestsPerRun),
      tone: toneFor(before.catalogueRequestsPerRun, after.catalogueRequestsPerRun),
    },
    {
      key: 'cataloguePass',
      label: 'Full catalogue pass',
      from: formatDays(before.cataloguePassDays) ?? UNKNOWN,
      to: formatDays(after.cataloguePassDays) ?? UNKNOWN,
      tone: toneFor(before.cataloguePassDays, after.cataloguePassDays),
    },
    {
      key: 'stockPass',
      label: 'Full stock pass',
      from: formatDays(before.stockPassDays) ?? UNKNOWN,
      to: formatDays(after.stockPassDays) ?? UNKNOWN,
      tone: toneFor(before.stockPassDays, after.stockPassDays),
    },
    {
      key: 'deletionWindow',
      label: 'Deleted product still selling',
      from: formatDays(before.deletionWindowDays) ?? UNKNOWN,
      to: formatDays(after.deletionWindowDays) ?? UNKNOWN,
      tone: toneFor(before.deletionWindowDays, after.deletionWindowDays),
    },
  ];

  return (
    <>
      <article className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">One catalogue run</p>
            <h3 className="section-title">Will it finish?</h3>
          </div>
        </div>

        <TickBudgetBar
          runSeconds={after.catalogueRunSeconds}
          windowSeconds={after.catalogueWindowSeconds}
          hostLimitSeconds={hostLimitSeconds}
          over={after.exceedsHostLimit}
        />

        {after.exceedsHostLimit ? (
          <Alert tone="error" title="This run will be cut short" className="impact-alert">
            At {catalogueValue} products a run takes about{' '}
            {formatSeconds(after.catalogueRunSeconds)}. You told us your host stops processes at{' '}
            <strong>{formatSeconds(hostLimitSeconds)}</strong>. The run will be killed part-way and
            its work is held until OpenLinker picks it up again. Try {suggestion} or fewer.
          </Alert>
        ) : null}

        {after.exceedsInterval ? (
          <Alert tone="warning" title="Runs will overlap" className="impact-alert">
            A run takes about {formatSeconds(after.catalogueRunSeconds)}, but the next one starts
            after {formatSeconds(after.catalogueWindowSeconds)}. Runs will queue behind each other
            instead of finishing sooner.
          </Alert>
        ) : null}
      </article>

      <article className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">What changes</p>
            <h3 className="section-title">Before and after</h3>
          </div>
        </div>

        <div className="impact-rows">
          {rows.map((row) => (
            <div
              key={row.key}
              className={['impact-row', row.tone ? `impact-row--${row.tone}` : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className="impact-row__label">{row.label}</span>
              <span className="impact-row__from">{row.from}</span>
              <span className="impact-row__arrow" aria-hidden="true">
                &rarr;
              </span>
              <span className="impact-row__to">{row.to}</span>
            </div>
          ))}
        </div>

        {!catalogueSizeKnown ? (
          <p className="form-field__description impact-rows__note">
            OpenLinker does not know yet how many products this shop holds, so how long a full pass
            takes cannot be worked out. The per-run figures above are still exact.
          </p>
        ) : null}
      </article>

      <article className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Read this</p>
            <h3 className="section-title">What these numbers cannot tell you</h3>
          </div>
        </div>
        <ul className="limits-list">
          <li>
            <span>
              Not where your shop breaks. These figures come from OpenLinker&apos;s own pacing,
              never from pushing a shop until it failed. They show load, they do not predict an
              outage.
            </span>
          </li>
          <li>
            <span>
              One background worker. If you run two, every request count here doubles.
            </span>
          </li>
          <li>
            <span>
              Measured on a test catalogue of 100 000 products, 3 variants each, 9 categories, no
              bundles. Your shop will differ.
            </span>
          </li>
        </ul>
      </article>
    </>
  );
}
