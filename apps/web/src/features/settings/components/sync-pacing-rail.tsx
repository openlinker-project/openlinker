/**
 * Sync Pacing Rail
 *
 * One summary of EVERY section on the sync-pacing page, in page order, with
 * the live effect of the values being edited: hosting (will a run finish),
 * the catalogue and stock sweeps, the deletion audit, and job retention. A
 * row whose value differs from the saved one reads `before → after` and is
 * highlighted, so the operator can see the whole change set in one place
 * before saving it. Each group's heading jumps to its section.
 *
 * Everything shown is derived: projections come from the pure
 * `projectSyncPacing` model (no request of its own, so dragging a slider
 * stays responsive) and cadences are rendered from what the API reported,
 * never from a literal. The save controls are passed in as `footer`, so the
 * rail stays a view and the page keeps owning what a save does.
 *
 * @module apps/web/src/features/settings/components
 */
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { describeCadence } from '../lib/deletion-audit-cadence';
import type { SyncPacingValues } from '../lib/sync-pacing-changes';
import {
  formatDays,
  formatSeconds,
  suggestCatalogueValueWithin,
  type SyncPacingProjection,
} from '../lib/sync-pacing-model';
import type { ValueLimits } from '../lib/resolve-value-limits';
import type { RetentionValues } from '../hooks/use-sync-job-retention-draft';
import { TickBudgetBar } from './tick-budget-bar';

interface SyncPacingRailProps {
  saved: SyncPacingValues;
  draft: SyncPacingValues;
  before: SyncPacingProjection;
  after: SyncPacingProjection;
  /** Sweep cadences as the API reported them; `undefined` when it did not. */
  catalogueSweepCadence?: string;
  inventorySweepCadence?: string;
  hostLimitSeconds: number;
  catalogueLimits: ValueLimits;
  catalogueSizeKnown: boolean;
  retentionSaved: RetentionValues | null;
  retentionDraft: RetentionValues | null;
  /** Scrolls the page to a section by its element id. */
  onJump: (sectionId: string) => void;
  footer: ReactNode;
}

const UNKNOWN = '—';

interface RailRowProps {
  label: string;
  before: string;
  after: string;
  hint?: string;
}

function RailRow({ label, before, after, hint }: RailRowProps): ReactElement {
  const changed = before !== after;
  return (
    <div className="pacing-rail__row" data-changed={String(changed)}>
      <dt className="pacing-rail__label">{label}</dt>
      <dd className="pacing-rail__value">
        {changed ? (
          <>
            <span className="pacing-rail__before">{before}</span>
            <span className="pacing-rail__arrow" aria-hidden="true">
              →
            </span>
            <span className="sr-only">changes to</span>
            <span className="pacing-rail__after">{after}</span>
          </>
        ) : (
          <span className="pacing-rail__after">{after}</span>
        )}
      </dd>
      {hint ? <dd className="pacing-rail__hint">{hint}</dd> : null}
    </div>
  );
}

interface RailGroupProps {
  id: string;
  sectionId: string;
  title: string;
  changed: boolean;
  onJump: (sectionId: string) => void;
  children: ReactNode;
  /** Rendered under the rows, inside the group. */
  extra?: ReactNode;
}

function RailGroup({
  id,
  sectionId,
  title,
  changed,
  onJump,
  children,
  extra,
}: RailGroupProps): ReactElement {
  return (
    <section className="pacing-rail__group" data-changed={String(changed)} aria-labelledby={id}>
      <h4 className="pacing-rail__group-title">
        {/* The link, not the heading, names the group, so the "edited"
            badge never becomes part of its accessible name. */}
        <a
          id={id}
          className="pacing-rail__jump"
          href={`#${sectionId}`}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            // An in-page jump that leaves the router's URL alone.
            event.preventDefault();
            onJump(sectionId);
          }}
        >
          {title}
        </a>
        {changed ? <span className="pacing-rail__edited">edited</span> : null}
      </h4>
      <dl className="pacing-rail__rows">{children}</dl>
      {extra}
    </section>
  );
}

function cadenceLabel(expression: string | undefined, assumed: string): string {
  return expression === undefined ? assumed : describeCadence(expression).toLowerCase();
}

function days(value: number): string {
  return `${String(value)} ${value === 1 ? 'day' : 'days'}`;
}

export function SyncPacingRail({
  saved,
  draft,
  before,
  after,
  catalogueSweepCadence,
  inventorySweepCadence,
  hostLimitSeconds,
  catalogueLimits,
  catalogueSizeKnown,
  retentionSaved,
  retentionDraft,
  onJump,
  footer,
}: SyncPacingRailProps): ReactElement {
  // Clamped to the ABSOLUTE ceiling, not the recommended one: the suggestion
  // answers "what fits your host", and a host that can take more than we
  // suggest should be told the number that fits it. Crossing the
  // recommendation still costs an acknowledgement at the control.
  const suggestion = suggestCatalogueValueWithin(hostLimitSeconds, {
    min: catalogueLimits.min,
    max: catalogueLimits.absoluteMax,
  });

  const catalogueChanged =
    draft.catalogueSweepBudget !== saved.catalogueSweepBudget ||
    draft.sweepPageSize !== saved.sweepPageSize;
  const stockChanged = draft.inventorySweepBudget !== saved.inventorySweepBudget;
  const auditChanged =
    draft.deletionAuditBudget !== saved.deletionAuditBudget ||
    draft.deletionAuditCadence !== saved.deletionAuditCadence;
  const retentionChanged =
    retentionSaved !== null &&
    retentionDraft !== null &&
    (retentionDraft.syncJobRetentionDays !== retentionSaved.syncJobRetentionDays ||
      retentionDraft.syncJobDeadRetentionDays !== retentionSaved.syncJobDeadRetentionDays);

  const catalogueCadence = cadenceLabel(catalogueSweepCadence, 'every 20 min (assumed)');
  const stockCadence = cadenceLabel(inventorySweepCadence, 'every 15 min (assumed)');

  return (
    <aside className="pacing-rail" aria-label="Summary of these settings">
      <div className="pacing-rail__body">
        <header className="pacing-rail__header">
          <p className="eyebrow">Summary</p>
          <h3 className="section-title">What these values do</h3>
          <p className="pacing-rail__lede">
            Live for what you have typed. Changed rows show the saved value first.
          </p>
        </header>

        <RailGroup
          id="pacing-rail-hosting"
          sectionId="pacing-hosting"
          title="Hosting"
          changed={before.catalogueRunSeconds !== after.catalogueRunSeconds}
          onJump={onJump}
          extra={
            <div className="pacing-rail__bar">
              <TickBudgetBar
                runSeconds={after.catalogueRunSeconds}
                windowSeconds={after.catalogueWindowSeconds}
                hostLimitSeconds={hostLimitSeconds}
                over={after.exceedsHostLimit}
              />
              {after.exceedsHostLimit ? (
                <p className="pacing-rail__warning" data-tone="error" role="status">
                  <strong>This run will be cut short.</strong> At {draft.catalogueSweepBudget}{' '}
                  products a run takes about {formatSeconds(after.catalogueRunSeconds)}, past your
                  host&apos;s {formatSeconds(hostLimitSeconds)}. Try {suggestion} or fewer.
                </p>
              ) : null}
              {after.exceedsInterval ? (
                <p className="pacing-rail__warning" data-tone="warning" role="status">
                  <strong>Runs will overlap.</strong> A run takes about{' '}
                  {formatSeconds(after.catalogueRunSeconds)}, but the next one starts after{' '}
                  {formatSeconds(after.catalogueWindowSeconds)}.
                </p>
              ) : null}
            </div>
          }
        >
          <RailRow
            label="Process time limit"
            before={formatSeconds(hostLimitSeconds)}
            after={formatSeconds(hostLimitSeconds)}
            hint="Kept in this browser."
          />
          <RailRow
            label="Longest run (catalogue)"
            before={formatSeconds(before.catalogueRunSeconds)}
            after={formatSeconds(after.catalogueRunSeconds)}
          />
        </RailGroup>

        <RailGroup
          id="pacing-rail-catalogue"
          sectionId="pacing-catalogue"
          title="Catalogue sweep"
          changed={catalogueChanged}
          onJump={onJump}
        >
          <RailRow
            label="Products per run"
            before={String(saved.catalogueSweepBudget)}
            after={String(draft.catalogueSweepBudget)}
          />
          <RailRow
            label="Products per shop request"
            before={String(saved.sweepPageSize)}
            after={String(draft.sweepPageSize)}
          />
          <RailRow
            label="Shop requests per run"
            before={String(before.catalogueRequestsPerRun)}
            after={String(after.catalogueRequestsPerRun)}
          />
          <RailRow
            label="Full catalogue pass"
            before={formatDays(before.cataloguePassDays) ?? UNKNOWN}
            after={formatDays(after.cataloguePassDays) ?? UNKNOWN}
          />
          <RailRow label="Runs" before={catalogueCadence} after={catalogueCadence} />
        </RailGroup>

        <RailGroup
          id="pacing-rail-stock"
          sectionId="pacing-stock"
          title="Stock sweep"
          changed={stockChanged}
          onJump={onJump}
        >
          <RailRow
            label="Products per run"
            before={String(saved.inventorySweepBudget)}
            after={String(draft.inventorySweepBudget)}
          />
          <RailRow
            label="Shop requests per run"
            before={String(before.stockRequestsPerRun)}
            after={String(after.stockRequestsPerRun)}
          />
          <RailRow
            label="Full stock pass"
            before={formatDays(before.stockPassDays) ?? UNKNOWN}
            after={formatDays(after.stockPassDays) ?? UNKNOWN}
          />
          <RailRow label="Runs" before={stockCadence} after={stockCadence} />
        </RailGroup>

        <RailGroup
          id="pacing-rail-deletions"
          sectionId="pacing-deletions"
          title="Deletion audit"
          changed={auditChanged}
          onJump={onJump}
        >
          <RailRow
            label="Products checked per run"
            before={String(saved.deletionAuditBudget)}
            after={String(draft.deletionAuditBudget)}
          />
          <RailRow
            label="Runs"
            before={describeCadence(saved.deletionAuditCadence).toLowerCase()}
            after={describeCadence(draft.deletionAuditCadence).toLowerCase()}
          />
          {/* Named for what it measures — the AUDIT's cycle — with the outcome
              qualified rather than promised (#2627 review): a shop that
              reports deletions as they happen finds one in about a minute,
              and this page cannot tell per connection whether it does. */}
          <RailRow
            label="Full audit cycle"
            before={formatDays(before.deletionWindowDays) ?? UNKNOWN}
            after={formatDays(after.deletionWindowDays) ?? UNKNOWN}
            hint="The longest a deleted product can keep selling when the shop does not report the deletion itself."
          />
        </RailGroup>

        {retentionSaved !== null && retentionDraft !== null ? (
          <RailGroup
            id="pacing-rail-retention"
            sectionId="pacing-retention"
            title="Job retention"
            changed={retentionChanged}
            onJump={onJump}
          >
            <RailRow
              label="Completed jobs kept for"
              before={days(retentionSaved.syncJobRetentionDays)}
              after={days(retentionDraft.syncJobRetentionDays)}
            />
            <RailRow
              label="Failed jobs kept for"
              before={days(retentionSaved.syncJobDeadRetentionDays)}
              after={days(retentionDraft.syncJobDeadRetentionDays)}
              hint="Older job records are removed by the background worker's regular clean-up."
            />
          </RailGroup>
        ) : null}

        <details className="pacing-rail__caveats">
          <summary className="pacing-rail__caveats-summary">
            What these numbers cannot tell you
          </summary>
          <ul className="limits-list">
            <li>
              <span>
                Not where your shop breaks. These figures come from OpenLinker&apos;s own pacing,
                never from pushing a shop until it failed. They show load, they do not predict an
                outage.
              </span>
            </li>
            <li>
              <span>One background worker. If you run two, every request count here doubles.</span>
            </li>
            <li>
              <span>
                Measured on a test catalogue of 100 000 products, 3 variants each, 9 categories, no
                bundles. Your shop will differ.
              </span>
            </li>
            <li>
              {/* The pass lengths are derived from the count of products
                  OPENLINKER has replicated — the only number the browser can
                  read. Mid-first-sync that is a floor, and the gap is not
                  small (#2627 review). */}
              <span>
                {catalogueSizeKnown
                  ? 'Pass lengths count the products OpenLinker has already copied over, not the products your shop holds. While a first sync is still running the real pass is longer, often far longer. The per-run figures are exact either way.'
                  : 'OpenLinker does not know yet how many products this shop holds, so pass lengths cannot be worked out. The per-run figures are still exact.'}
              </span>
            </li>
          </ul>
        </details>
      </div>

      <div className="pacing-rail__footer">{footer}</div>
    </aside>
  );
}
