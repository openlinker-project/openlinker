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
import { renderRich, useMessages, usePlural } from '../../../shared/i18n';
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
  const copy = useMessages('settings').syncPacingRail;
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
            <span className="sr-only">{copy.changesTo}</span>
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
  const copy = useMessages('settings').syncPacingRail;
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
        {changed ? <span className="pacing-rail__edited">{copy.edited}</span> : null}
      </h4>
      <dl className="pacing-rail__rows">{children}</dl>
      {extra}
    </section>
  );
}

function cadenceLabel(expression: string | undefined, assumed: string): string {
  return expression === undefined ? assumed : describeCadence(expression).toLowerCase();
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
  const copy = useMessages('settings').syncPacingRail;
  const plural = usePlural();
  const days = (value: number): string => plural(value, copy.days);
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

  const catalogueCadence = cadenceLabel(catalogueSweepCadence, copy.assumedCatalogueCadence);
  const stockCadence = cadenceLabel(inventorySweepCadence, copy.assumedStockCadence);

  return (
    <aside className="pacing-rail" aria-label={copy.ariaLabel}>
      <div className="pacing-rail__body">
        <header className="pacing-rail__header">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
          <p className="pacing-rail__lede">
            {copy.lede}
          </p>
        </header>

        <RailGroup
          id="pacing-rail-hosting"
          sectionId="pacing-hosting"
          title={copy.hosting.title}
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
                  {renderRich(
                    copy.hosting.cutShort,
                    { strong: (text: string) => <strong>{text}</strong> },
                    {
                      budget: String(draft.catalogueSweepBudget),
                      run: formatSeconds(after.catalogueRunSeconds),
                      limit: formatSeconds(hostLimitSeconds),
                      suggestion: String(suggestion),
                    }
                  )}
                </p>
              ) : null}
              {after.exceedsInterval ? (
                <p className="pacing-rail__warning" data-tone="warning" role="status">
                  {renderRich(
                    copy.hosting.overlap,
                    { strong: (text: string) => <strong>{text}</strong> },
                    {
                      run: formatSeconds(after.catalogueRunSeconds),
                      window: formatSeconds(after.catalogueWindowSeconds),
                    }
                  )}
                </p>
              ) : null}
            </div>
          }
        >
          <RailRow
            label={copy.hosting.processTimeLimit}
            before={formatSeconds(hostLimitSeconds)}
            after={formatSeconds(hostLimitSeconds)}
            hint={copy.hosting.keptInBrowser}
          />
          <RailRow
            label={copy.hosting.longestRun}
            before={formatSeconds(before.catalogueRunSeconds)}
            after={formatSeconds(after.catalogueRunSeconds)}
          />
        </RailGroup>

        <RailGroup
          id="pacing-rail-catalogue"
          sectionId="pacing-catalogue"
          title={copy.catalogue.title}
          changed={catalogueChanged}
          onJump={onJump}
        >
          <RailRow
            label={copy.productsPerRun}
            before={String(saved.catalogueSweepBudget)}
            after={String(draft.catalogueSweepBudget)}
          />
          <RailRow
            label={copy.catalogue.productsPerRequest}
            before={String(saved.sweepPageSize)}
            after={String(draft.sweepPageSize)}
          />
          <RailRow
            label={copy.shopRequestsPerRun}
            before={String(before.catalogueRequestsPerRun)}
            after={String(after.catalogueRequestsPerRun)}
          />
          <RailRow
            label={copy.catalogue.fullPass}
            before={formatDays(before.cataloguePassDays) ?? UNKNOWN}
            after={formatDays(after.cataloguePassDays) ?? UNKNOWN}
          />
          <RailRow label={copy.runs} before={catalogueCadence} after={catalogueCadence} />
        </RailGroup>

        <RailGroup
          id="pacing-rail-stock"
          sectionId="pacing-stock"
          title={copy.stock.title}
          changed={stockChanged}
          onJump={onJump}
        >
          <RailRow
            label={copy.productsPerRun}
            before={String(saved.inventorySweepBudget)}
            after={String(draft.inventorySweepBudget)}
          />
          <RailRow
            label={copy.shopRequestsPerRun}
            before={String(before.stockRequestsPerRun)}
            after={String(after.stockRequestsPerRun)}
          />
          <RailRow
            label={copy.stock.fullPass}
            before={formatDays(before.stockPassDays) ?? UNKNOWN}
            after={formatDays(after.stockPassDays) ?? UNKNOWN}
          />
          <RailRow label={copy.runs} before={stockCadence} after={stockCadence} />
        </RailGroup>

        <RailGroup
          id="pacing-rail-deletions"
          sectionId="pacing-deletions"
          title={copy.deletions.title}
          changed={auditChanged}
          onJump={onJump}
        >
          <RailRow
            label={copy.deletions.checkedPerRun}
            before={String(saved.deletionAuditBudget)}
            after={String(draft.deletionAuditBudget)}
          />
          <RailRow
            label={copy.runs}
            before={describeCadence(saved.deletionAuditCadence).toLowerCase()}
            after={describeCadence(draft.deletionAuditCadence).toLowerCase()}
          />
          {/* Named for what it measures - the AUDIT's cycle — with the outcome
              qualified rather than promised (#2627 review): a shop that
              reports deletions as they happen finds one in about a minute,
              and this page cannot tell per connection whether it does. */}
          <RailRow
            label={copy.deletions.fullCycle}
            before={formatDays(before.deletionWindowDays) ?? UNKNOWN}
            after={formatDays(after.deletionWindowDays) ?? UNKNOWN}
            hint={copy.deletions.fullCycleHint}
          />
        </RailGroup>

        {retentionSaved !== null && retentionDraft !== null ? (
          <RailGroup
            id="pacing-rail-retention"
            sectionId="pacing-retention"
            title={copy.retention.title}
            changed={retentionChanged}
            onJump={onJump}
          >
            <RailRow
              label={copy.retention.completedKept}
              before={days(retentionSaved.syncJobRetentionDays)}
              after={days(retentionDraft.syncJobRetentionDays)}
            />
            <RailRow
              label={copy.retention.failedKept}
              before={days(retentionSaved.syncJobDeadRetentionDays)}
              after={days(retentionDraft.syncJobDeadRetentionDays)}
              hint={copy.retention.cleanUpHint}
            />
          </RailGroup>
        ) : null}

        <details className="pacing-rail__caveats">
          <summary className="pacing-rail__caveats-summary">
            {copy.caveats.summary}
          </summary>
          <ul className="limits-list">
            <li>
              <span>{copy.caveats.notWhereItBreaks}</span>
            </li>
            <li>
              <span>{copy.caveats.oneService}</span>
            </li>
            <li>
              <span>{copy.caveats.testCatalogue}</span>
            </li>
            <li>
              {/* The pass lengths are derived from the count of products
                  OPENLINKER has replicated - the only number the browser can
                  read. Mid-first-sync that is a floor, and the gap is not
                  small (#2627 review). */}
              <span>
                {catalogueSizeKnown
                  ? copy.caveats.sizeKnown
                  : copy.caveats.sizeUnknown}
              </span>
            </li>
          </ul>
        </details>
      </div>

      <div className="pacing-rail__footer">{footer}</div>
    </aside>
  );
}
