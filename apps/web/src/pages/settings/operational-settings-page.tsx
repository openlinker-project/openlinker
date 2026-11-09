/**
 * Sync Pacing Page (#2653)
 *
 * The operator-facing screen for the values #2651 made settable: how many
 * products OpenLinker reads from a shop per run, and how often it checks for
 * products that were deleted there.
 *
 * A plain form would not do. These values are not intuitive and getting one
 * wrong is not obviously wrong - raising the catalogue value from 500 to 2000
 * sounds like "sync faster", and on a host that kills processes at 300 s it
 * means every run is killed part-way. So the page says what a change DOES,
 * beside the control that makes it.
 *
 * Three properties are load-bearing:
 *
 * - The projection is a pure function (`lib/sync-pacing-model.ts`) of the form
 *   values plus the catalogue size, with no request of its own, so dragging a
 *   slider stays responsive and the arithmetic is testable without a DOM.
 * - `source` is rendered from what the API said. Comparing against a
 *   hardcoded default in the browser is a second copy of it, wrong the day the
 *   default moves.
 * - The confirmation is built from the diff. Only changed values, each with
 *   its own consequence, and no modal at all when nothing changed.
 *
 * @module apps/web/src/pages/settings
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { RangeNumberInput } from '../../shared/ui/range-number-input';
import { Select } from '../../shared/ui/select';
import { useToast } from '../../shared/ui/toast-provider';
import { useSession } from '../../shared/auth/use-session';
import { PacingValueField } from '../../features/settings/components/pacing-value-field';
import { InventoryMovementRetentionSection } from '../../features/settings/components/inventory-movement-retention-section';
import { StockStalenessSection } from '../../features/settings/components/stock-staleness-section';
import { SyncJobRetentionSection } from '../../features/settings/components/sync-job-retention-section';
import { SyncPacingConfirmDialog } from '../../features/settings/components/sync-pacing-confirm-dialog';
import { SyncPacingRail } from '../../features/settings/components/sync-pacing-rail';
import { useCatalogueSizeQuery } from '../../features/settings/hooks/use-catalogue-size-query';
import { useOperationalSettingsQuery } from '../../features/settings/hooks/use-operational-settings-query';
import { useInventoryMovementRetentionDraft } from '../../features/settings/hooks/use-inventory-movement-retention-draft';
import { useSyncJobRetentionDraft } from '../../features/settings/hooks/use-sync-job-retention-draft';
import { useUpdateOperationalSettingsMutation } from '../../features/settings/hooks/use-update-operational-settings-mutation';
import {
  describeCadence,
  resolveCadenceOptions,
} from '../../features/settings/lib/deletion-audit-cadence';
import {
  mapOperationalSettingsErrors,
  NO_OPERATIONAL_SETTINGS_ERRORS,
} from '../../features/settings/lib/map-operational-settings-errors';
import { diffSyncPacing, type SyncPacingValues } from '../../features/settings/lib/sync-pacing-changes';
import {
  DEFAULT_HOST_PROCESS_LIMIT_SECONDS,
  projectSyncPacing,
} from '../../features/settings/lib/sync-pacing-model';
import {
  isAboveRecommended,
  limitsFor,
  type ValueLimits,
} from '../../features/settings/lib/resolve-value-limits';
import type {
  OperationalSettingKey,
  OperationalSettingsView,
  UpdateOperationalSettingsInput,
} from '../../features/settings/api/operational-settings.types';

/**
 * The host process limit is the operator's knowledge about their own server,
 * not something OpenLinker can discover, and #2651 does not store it. Keeping
 * it in this browser is honest about that: it feeds the warnings and nothing
 * else.
 */
const HOST_LIMIT_STORAGE_KEY = 'ol.syncPacing.hostProcessLimitSeconds';

const HOST_LIMIT_MIN_SECONDS = 10;
const HOST_LIMIT_MAX_SECONDS = 3600;

/** The in-page jump targets, in the order the sections appear. */
type SectionLinkKey =
  | 'hosting'
  | 'catalogue'
  | 'stock'
  | 'deletions'
  | 'retention'
  | 'inventoryHistory'
  | 'stockStaleness';

const SECTION_LINKS: readonly { id: string; key: SectionLinkKey }[] = [
  { id: 'pacing-hosting', key: 'hosting' },
  { id: 'pacing-catalogue', key: 'catalogue' },
  { id: 'pacing-stock', key: 'stock' },
  { id: 'pacing-deletions', key: 'deletions' },
  { id: 'pacing-retention', key: 'retention' },
  { id: 'pacing-inventory-history', key: 'inventoryHistory' },
  { id: 'pacing-stock-staleness', key: 'stockStaleness' },
];

/**
 * The sweep-pacing form's own numeric fields, in the order the page lays
 * them out - a NARROWER type than `OperationalSettingKey` on purpose
 * (#2946 widened that union with `syncJobRetentionDays` /
 * `syncJobDeadRetentionDays`, which have no place in `SyncPacingValues`'s
 * catalogue-size projection and are rendered by their own self-contained
 * `SyncJobRetentionSection` instead): the intersection of both unions is
 * exactly this form's 4 numeric fields, so `draft[key]` below stays sound
 * without widening `SyncPacingValues` itself.
 */
type SyncPacingNumericField = Extract<OperationalSettingKey, keyof SyncPacingValues>;

const NUMERIC_FIELDS: readonly SyncPacingNumericField[] = [
  'catalogueSweepBudget',
  'sweepPageSize',
  'inventorySweepBudget',
  'deletionAuditBudget',
];

function toValues(view: OperationalSettingsView): SyncPacingValues {
  return {
    catalogueSweepBudget: view.catalogueSweepBudget.value,
    inventorySweepBudget: view.inventorySweepBudget.value,
    sweepPageSize: view.sweepPageSize.value,
    deletionAuditBudget: view.deletionAuditBudget.value,
    deletionAuditCadence: view.deletionAuditCadence.value,
  };
}

function readStoredHostLimit(): number {
  try {
    const raw = window.localStorage.getItem(HOST_LIMIT_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.max(Math.round(parsed), HOST_LIMIT_MIN_SECONDS), HOST_LIMIT_MAX_SECONDS)
      : DEFAULT_HOST_PROCESS_LIMIT_SECONDS;
  } catch {
    return DEFAULT_HOST_PROCESS_LIMIT_SECONDS;
  }
}

export function OperationalSettingsPage(): ReactElement {
  const { isReady, session } = useSession();
  const isAdmin = isReady && session.status === 'authenticated' && session.user?.role === 'admin';
  const copy = useMessages('settings').operationalSettingsPage;
  const plural = usePlural();
  const format = useFormat();

  const query = useOperationalSettingsQuery();
  const catalogueSizeQuery = useCatalogueSizeQuery();
  const mutation = useUpdateOperationalSettingsMutation();
  const { showToast } = useToast();

  const [draft, setDraft] = useState<SyncPacingValues | null>(null);
  const [hostLimit, setHostLimit] = useState<number>(readStoredHostLimit);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /**
   * Which fields the operator has explicitly accepted going past our
   * recommendation on.
   *
   * Kept per FIELD even though the API flag is per request: each crossing has
   * its own reason, and one blanket checkbox would ask the operator to accept
   * a sentence they were never shown. The request flag is the OR of these,
   * and is never set from the value alone.
   */
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});

  const view = query.data ?? null;
  const retention = useSyncJobRetentionDraft(view);
  const historyRetention = useInventoryMovementRetentionDraft(view);
  // Built from the pacing fields themselves (value + source), not from the
  // row's `updatedAt`: retention saves on its own from the same rail, and a
  // retention save bumping `updatedAt` must not discard a pacing edit.
  const savedStamp =
    view === null
      ? null
      : [
          ...NUMERIC_FIELDS.map((key) => `${String(view[key].value)}:${view[key].source}`),
          `${view.deletionAuditCadence.value}:${view.deletionAuditCadence.source}`,
        ].join('|');

  // Adopt the server's values once, and again whenever the saved row changes
  // underneath us. Deliberately keyed on the saved stamp rather than on `view`
  // itself: a background refetch that changed nothing must not discard an
  // edit in progress (the #478 shape the settings dialogs already follow).
  useEffect(() => {
    if (view !== null) {
      setDraft(toValues(view));
      // A fresh saved row is a fresh decision; an acknowledgement must not
      // carry over to a value the operator has not looked at.
      setAcknowledged({});
    }
    // Dependency list is deliberately just the saved stamp; `view` is read
    // inside and must not re-trigger this.
  }, [savedStamp]);

  const errors = mutation.error
    ? mapOperationalSettingsErrors(mutation.error)
    : NO_OPERATIONAL_SETTINGS_ERRORS;

  const catalogueSize = catalogueSizeQuery.data ?? null;

  // True when at least one reported value is not stored, so the worker resolves
  // it from its own environment and this process cannot vouch for it. Read from
  // the API's own flag rather than re-derived from `source` here, so the two
  // cannot disagree about what "definite" means.
  const workerMayDiffer =
    view !== null &&
    (NUMERIC_FIELDS.some((key) => view[key].workerMayDiffer === true) ||
      view.deletionAuditCadence.workerMayDiffer === true);

  // Resolved once per render and threaded everywhere, so the slider's range,
  // the diff's crossing test and the save gate cannot disagree about where a
  // ceiling is.
  const limits = useMemo((): Partial<Record<OperationalSettingKey, ValueLimits>> => {
    if (view === null) {
      return {};
    }
    return Object.fromEntries(NUMERIC_FIELDS.map((key) => [key, limitsFor(view, key)]));
  }, [view]);

  const diff = useMemo(() => {
    if (view === null || draft === null) {
      return { changes: [], lengthensDeletionWindow: false };
    }
    return diffSyncPacing(toValues(view), draft, {
      hostProcessLimitSeconds: hostLimit,
      catalogueSize,
      catalogueSweepCadence: view.catalogueSweepCadence?.value,
      inventorySweepCadence: view.inventorySweepCadence?.value,
      cadenceAppliesAt: view.cadenceAppliesAt,
      limits,
    });
  }, [view, draft, hostLimit, catalogueSize, limits]);

  // The fields whose CURRENT draft value sits past our recommendation, and
  // which of those the operator has not yet accepted. Save is blocked on the
  // second list: a crossing nobody acknowledged would be refused by the API
  // anyway, and refusing it here says why while the control is still in view.
  const crossingFields = draft === null
    ? []
    : NUMERIC_FIELDS.filter((key) => {
        const fieldLimits = limits[key];
        return fieldLimits !== undefined && isAboveRecommended(draft[key], fieldLimits);
      });
  const unacknowledgedFields = crossingFields.filter((key) => acknowledged[key] !== true);

  // Read off the diff rather than restated here, so the sentence beside the
  // control and the sentence in the modal cannot drift apart.
  const cadenceTimingNote = diff.changes.find(
    (change) => change.field === 'deletionAuditCadence',
  )?.timing;

  const projections = useMemo(() => {
    if (view === null || draft === null) {
      return null;
    }
    const saved = toValues(view);
    const context = {
      hostProcessLimitSeconds: hostLimit,
      catalogueSize,
      // The cadences in force, when the API reported them. Without these the
      // pass lengths assume the shipped 20 / 15 minutes and are an order of
      // magnitude wrong on an install that changed one (#2660 review).
      catalogueSweepCadence: view.catalogueSweepCadence?.value,
      inventorySweepCadence: view.inventorySweepCadence?.value,
    };
    return {
      before: projectSyncPacing({ ...saved, ...context }),
      after: projectSyncPacing({ ...draft, ...context }),
    };
  }, [view, draft, hostLimit, catalogueSize]);

  if (isReady && !isAdmin) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.adminOnly.description}>
        <ErrorState
          title={copy.adminOnly.title}
          message={copy.adminOnly.message}
        />
      </PageLayout>
    );
  }

  const handleHostLimit = (next: number): void => {
    setHostLimit(next);
    try {
      window.localStorage.setItem(HOST_LIMIT_STORAGE_KEY, String(next));
    } catch {
      // A browser that refuses storage still gets a working calculator; the
      // value simply does not survive a reload.
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (view === null || draft === null) {
      return;
    }
    const saved = toValues(view);
    const payload: UpdateOperationalSettingsInput = {};
    if (draft.catalogueSweepBudget !== saved.catalogueSweepBudget) {
      payload.catalogueSweepBudget = draft.catalogueSweepBudget;
    }
    if (draft.inventorySweepBudget !== saved.inventorySweepBudget) {
      payload.inventorySweepBudget = draft.inventorySweepBudget;
    }
    if (draft.sweepPageSize !== saved.sweepPageSize) {
      payload.sweepPageSize = draft.sweepPageSize;
    }
    if (draft.deletionAuditBudget !== saved.deletionAuditBudget) {
      payload.deletionAuditBudget = draft.deletionAuditBudget;
    }
    if (draft.deletionAuditCadence !== saved.deletionAuditCadence) {
      payload.deletionAuditCadence = draft.deletionAuditCadence;
    }
    // Set from the operator's own acknowledgement, never from the value being
    // high. Inferring it would make the gate a formality.
    if (crossingFields.length > 0 && unacknowledgedFields.length === 0) {
      payload.acknowledgeAboveRecommended = true;
    }

    try {
      await mutation.mutateAsync(payload);
      setConfirmOpen(false);
      showToast({
        tone: 'success',
        title: copy.savedToast.title,
        description:
          payload.deletionAuditCadence === undefined
            ? copy.savedToast.description
            : copy.savedToast.descriptionWithCadence,
      });
    } catch {
      // Kept open so the per-field messages below the form are reachable
      // without redoing the edit; surfaced via `errors`.
      setConfirmOpen(false);
    }
  };

  const changeCount = diff.changes.length;
  const totalChanges = changeCount + retention.changeCount;
  const pacingSavable =
    changeCount > 0 && unacknowledgedFields.length === 0 && !mutation.isPending;
  // The bar's one button saves the pacing set first (through its confirm),
  // then retention on the next press; it never skips the confirmation.
  const mobileSavable = changeCount > 0 ? pacingSavable : !retention.saving;

  const jumpTo = (sectionId: string): void => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const saveStatus =
    changeCount === 0
      ? copy.saveStatus.noChanges
      : unacknowledgedFields.length > 0
        ? unacknowledgedFields.length === 1
          ? copy.saveStatus.oneUnacknowledged
          : copy.saveStatus.someUnacknowledged
        : copy.saveStatus.ready;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      summary={
        <nav className="pacing-nav" aria-label={copy.sectionsNavLabel}>
          {SECTION_LINKS.map((link) => (
            <a
              key={link.id}
              className="toolbar-chip pacing-nav__link"
              href={`#${link.id}`}
              onClick={(event) => {
                // An in-page jump that leaves the router's URL alone.
                event.preventDefault();
                jumpTo(link.id);
              }}
            >
              {copy.sections[link.key]}
            </a>
          ))}
        </nav>
      }
    >
      {query.isPending ? (
        <LoadingState title={copy.loading.title} message={copy.loading.message} />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={query.error instanceof Error ? query.error.message : copy.error.unknown}
          action={
            <Button tone="secondary" onClick={() => void query.refetch()}>
              {copy.error.retry}
            </Button>
          }
        />
      ) : view !== null && draft !== null && projections !== null ? (
        <div className="pacing-layout" data-mobile-bar={String(totalChanges > 0)}>
          <div className="settings-column">
            {errors.formErrors.length > 0 ? (
              <Alert tone="error" title={copy.notSaved}>
                {errors.formErrors.join(' ')}
              </Alert>
            ) : null}

            {/* Stated once, not per field. OpenLinker runs as two processes with
                separate environments, and the sweeps run in the background
                worker - so a value this page read from an environment variable,
                or fell back to a default for, describes the API process rather
                than the one doing the work. Only a saved value is definite for
                both (#2660 review). Rendered when ANY value is unsaved, which
                on a fresh install is all of them, and is exactly when the
                caveat is worth reading. */}
            {workerMayDiffer ? (
              <Alert tone="info" title={copy.workerMayDiffer.title}>
                {copy.workerMayDiffer.body}
              </Alert>
            ) : null}

            {/* ── Hosting ──────────────────────────────────────────────── */}
            <section
              className="panel pacing-card"
              id="pacing-hosting"
              aria-labelledby="pacing-hosting-title"
            >
              <header className="pacing-card__header">
                <div>
                  <p className="eyebrow">{copy.hosting.eyebrow}</p>
                  <h3 className="section-title" id="pacing-hosting-title">
                    {copy.hosting.title}
                  </h3>
                </div>
                <span className="panel__meta">{copy.hosting.meta}</span>
              </header>

              <div className="pacing-card__fields">
                <div className="pacing-field">
                  <div className="pacing-field__head">
                    <label className="form-field__label" htmlFor="host-process-limit">
                      {copy.hosting.processTimeLimit}
                    </label>
                    <span className="form-field__source pacing-field__source">
                      {copy.hosting.keptInBrowser}
                    </span>
                  </div>
                  <RangeNumberInput
                    id="host-process-limit"
                    value={hostLimit}
                    min={HOST_LIMIT_MIN_SECONDS}
                    max={HOST_LIMIT_MAX_SECONDS}
                    step={10}
                    unit={copy.hosting.secondsUnit}
                    ariaLabel={copy.hosting.processTimeLimitAria}
                    describedBy="host-process-limit-description"
                    onChange={handleHostLimit}
                  />
                  <p
                    className="form-field__description pacing-field__description"
                    id="host-process-limit-description"
                  >
                    {copy.hosting.processTimeLimitDescription}
                  </p>
                </div>

                <div className="pacing-field">
                  <div className="pacing-field__head">
                    <span className="form-field__label">{copy.hosting.catalogueSize}</span>
                    <span className="form-field__source pacing-field__source">
                      {copy.hosting.fromCatalogue}
                    </span>
                  </div>
                  <p className="pacing-stat">
                    {catalogueSizeQuery.isPending
                      ? '…'
                      : catalogueSize === null
                        ? copy.hosting.notKnownYet
                        : format.number(catalogueSize)}
                  </p>
                  <p className="form-field__description pacing-field__description">
                    {copy.hosting.catalogueSizeDescription}
                  </p>
                </div>
              </div>
            </section>

            {/* ── Catalogue ────────────────────────────────────────────── */}
            <section
              className="panel pacing-card"
              id="pacing-catalogue"
              aria-labelledby="pacing-catalogue-title"
            >
              <header className="pacing-card__header">
                <div>
                  <p className="eyebrow">{copy.catalogue.eyebrow}</p>
                  <h3 className="section-title" id="pacing-catalogue-title">
                    {copy.catalogue.title}
                  </h3>
                </div>
                {/* Rendered from what the API reported, never a literal: both
                    sweep cadences are settable in the worker's environment, so a
                    hardcoded badge states as fact something an operator may have
                    changed (#2660 review). */}
                <span className="panel__meta">
                  {view.catalogueSweepCadence === undefined
                    ? copy.catalogue.assumedCadence
                    : describeCadence(view.catalogueSweepCadence.value).toLowerCase()}
                </span>
              </header>

              <div className="pacing-card__fields">
                <PacingValueField
                  label={copy.productsPerRun}
                  ariaLabel={copy.catalogue.budget.ariaLabel}
                  description={copy.catalogue.budget.description}
                  value={draft.catalogueSweepBudget}
                  limits={limitsFor(view, 'catalogueSweepBudget')}
                  savedValue={view.catalogueSweepBudget.value}
                  savedSource={view.catalogueSweepBudget.source}
                  savedAboveRecommended={view.catalogueSweepBudget.aboveRecommended === true}
                  acknowledged={acknowledged['catalogueSweepBudget'] === true}
                  onAcknowledgedChange={(next) => {
                    setAcknowledged({ ...acknowledged, catalogueSweepBudget: next });
                  }}
                  error={errors.fieldErrors.catalogueSweepBudget}
                  onChange={(value) => {
                    setDraft({ ...draft, catalogueSweepBudget: value });
                  }}
                />

                <PacingValueField
                  label={copy.catalogue.pageSize.label}
                  ariaLabel={copy.catalogue.pageSize.ariaLabel}
                  description={copy.catalogue.pageSize.description}
                  value={draft.sweepPageSize}
                  limits={limitsFor(view, 'sweepPageSize')}
                  step={10}
                  savedValue={view.sweepPageSize.value}
                  savedSource={view.sweepPageSize.source}
                  savedAboveRecommended={view.sweepPageSize.aboveRecommended === true}
                  acknowledged={acknowledged['sweepPageSize'] === true}
                  onAcknowledgedChange={(next) => {
                    setAcknowledged({ ...acknowledged, sweepPageSize: next });
                  }}
                  error={errors.fieldErrors.sweepPageSize}
                  onChange={(value) => {
                    setDraft({ ...draft, sweepPageSize: value });
                  }}
                />
              </div>

              {/* The API's own sentence. A cap restated here would have to be
                  kept in step with every adapter, and would be wrong first. */}
              {view.adapterClampNote !== undefined &&
              view.adapterClampNote.trim().length > 0 ? (
                <p className="pacing-card__note">{view.adapterClampNote}</p>
              ) : null}
            </section>

            {/* ── Stock ────────────────────────────────────────────────── */}
            <section
              className="panel pacing-card"
              id="pacing-stock"
              aria-labelledby="pacing-stock-title"
            >
              <header className="pacing-card__header">
                <div>
                  <p className="eyebrow">{copy.stock.eyebrow}</p>
                  <h3 className="section-title" id="pacing-stock-title">
                    {copy.stock.title}
                  </h3>
                </div>
                <span className="panel__meta">
                  {view.inventorySweepCadence === undefined
                    ? copy.stock.assumedCadence
                    : describeCadence(view.inventorySweepCadence.value).toLowerCase()}
                </span>
              </header>

              <div className="pacing-card__fields">
                <PacingValueField
                  label={copy.productsPerRun}
                  ariaLabel={copy.stock.budget.ariaLabel}
                  description={copy.stock.budget.description}
                  value={draft.inventorySweepBudget}
                  limits={limitsFor(view, 'inventorySweepBudget')}
                  savedValue={view.inventorySweepBudget.value}
                  savedSource={view.inventorySweepBudget.source}
                  savedAboveRecommended={view.inventorySweepBudget.aboveRecommended === true}
                  acknowledged={acknowledged['inventorySweepBudget'] === true}
                  onAcknowledgedChange={(next) => {
                    setAcknowledged({ ...acknowledged, inventorySweepBudget: next });
                  }}
                  error={errors.fieldErrors.inventorySweepBudget}
                  onChange={(value) => {
                    setDraft({ ...draft, inventorySweepBudget: value });
                  }}
                />
              </div>
            </section>

            {/* ── Deleted products ─────────────────────────────────────── */}
            <section
              className="panel pacing-card"
              id="pacing-deletions"
              aria-labelledby="pacing-deletions-title"
            >
              <header className="pacing-card__header">
                <div>
                  <p className="eyebrow">{copy.deletions.eyebrow}</p>
                  <h3 className="section-title" id="pacing-deletions-title">
                    {copy.deletions.title}
                  </h3>
                </div>
                {view.deletionAuditAlwaysEnabled ? (
                  <span className="panel__meta">{copy.deletions.noOffSwitch}</span>
                ) : null}
              </header>

              <div className="pacing-card__copy">
                <p>{copy.deletions.intro}</p>
                <p>{copy.deletions.noSwitch}</p>
              </div>

              <div className="pacing-card__fields">
                <PacingValueField
                  label={copy.deletions.budget.label}
                  ariaLabel={copy.deletions.budget.ariaLabel}
                  description={copy.deletions.budget.description}
                  value={draft.deletionAuditBudget}
                  limits={limitsFor(view, 'deletionAuditBudget')}
                  savedValue={view.deletionAuditBudget.value}
                  savedSource={view.deletionAuditBudget.source}
                  savedAboveRecommended={view.deletionAuditBudget.aboveRecommended === true}
                  acknowledged={acknowledged['deletionAuditBudget'] === true}
                  onAcknowledgedChange={(next) => {
                    setAcknowledged({ ...acknowledged, deletionAuditBudget: next });
                  }}
                  error={errors.fieldErrors.deletionAuditBudget}
                  onChange={(value) => {
                    setDraft({ ...draft, deletionAuditBudget: value });
                  }}
                />

                <div className="pacing-field">
                  <div className="pacing-field__head">
                    <label className="form-field__label" htmlFor="audit-cadence">
                      {copy.deletions.cadenceLabel}
                    </label>
                    <span
                      className="form-field__source pacing-field__source"
                      data-source={
                        draft.deletionAuditCadence === view.deletionAuditCadence.value
                          ? view.deletionAuditCadence.source
                          : 'setting'
                      }
                    >
                      {draft.deletionAuditCadence === view.deletionAuditCadence.value
                        ? interpolate(copy.deletions.cadenceWithSource, {
                            cadence: describeCadence(view.deletionAuditCadence.value).toLowerCase(),
                            source:
                              view.deletionAuditCadence.source === 'setting'
                                ? copy.deletions.sourceSetting
                                : view.deletionAuditCadence.source === 'env'
                                  ? copy.deletions.sourceEnv
                                  : copy.deletions.sourceDefault,
                          })
                        : interpolate(copy.deletions.cadenceNotSaved, {
                            cadence: describeCadence(draft.deletionAuditCadence).toLowerCase(),
                          })}
                    </span>
                  </div>
                  <Select
                    id="audit-cadence"
                    value={draft.deletionAuditCadence}
                    invalid={Boolean(errors.fieldErrors.deletionAuditCadence)}
                    aria-describedby="audit-cadence-description"
                    onChange={(event) => {
                      setDraft({ ...draft, deletionAuditCadence: event.target.value });
                    }}
                  >
                    {resolveCadenceOptions(view.deletionAuditCadence.value).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <p
                    className="form-field__description pacing-field__description"
                    id="audit-cadence-description"
                  >
                    {copy.deletions.cadenceDescription}
                  </p>
                  {draft.deletionAuditCadence !== view.deletionAuditCadence.value ? (
                    <>
                      <span className="field-changed">
                        {interpolate(copy.deletions.changedFrom, {
                          cadence: describeCadence(view.deletionAuditCadence.value).toLowerCase(),
                        })}
                      </span>
                      {cadenceTimingNote !== undefined ? (
                        <Alert tone="info" title={copy.deletions.whenThisStarts}>
                          {cadenceTimingNote}
                        </Alert>
                      ) : null}
                    </>
                  ) : null}
                  {errors.fieldErrors.deletionAuditCadence ? (
                    <p className="form-field__error" role="alert">
                      {errors.fieldErrors.deletionAuditCadence}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            {retention.draft !== null ? (
              <SyncJobRetentionSection
                view={view}
                draft={retention.draft}
                errors={retention.errors}
                onChange={retention.setDraft}
              />
            ) : null}

            <InventoryMovementRetentionSection view={view} retention={historyRetention} />

            <StockStalenessSection view={view} />
          </div>

          <SyncPacingRail
            saved={toValues(view)}
            draft={draft}
            before={projections.before}
            after={projections.after}
            catalogueSweepCadence={view.catalogueSweepCadence?.value}
            inventorySweepCadence={view.inventorySweepCadence?.value}
            hostLimitSeconds={hostLimit}
            catalogueLimits={limitsFor(view, 'catalogueSweepBudget')}
            catalogueSizeKnown={catalogueSize !== null}
            retentionSaved={retention.saved}
            retentionDraft={retention.draft}
            onJump={jumpTo}
            footer={
              <>
                <div className="pacing-save" data-dirty={String(changeCount > 0)}>
                  <div className="pacing-save__text">
                    <p className="pacing-save__count">
                      {changeCount === 0 ? copy.title : plural(changeCount, copy.unsavedChanges)}
                    </p>
                    <p className="pacing-save__status" aria-live="polite">
                      {saveStatus}
                    </p>
                  </div>
                  <div className="pacing-save__actions">
                    <Button
                      tone="secondary"
                      disabled={changeCount === 0}
                      onClick={() => {
                        setDraft(toValues(view));
                      }}
                    >
                      {copy.footer.undo}
                    </Button>
                    <Button
                      disabled={!pacingSavable}
                      onClick={() => {
                        setConfirmOpen(true);
                      }}
                    >
                      {copy.footer.save}
                    </Button>
                  </div>
                </div>

                {/* Retention saves on its own, with no confirmation: it has
                    no catalogue-size consequence to confirm. Offered only
                    once there is something to save. */}
                {retention.changeCount > 0 ? (
                  <div className="pacing-save pacing-save--inline" data-dirty="true">
                    <div className="pacing-save__text">
                      <p className="pacing-save__count">{copy.footer.retentionChanged}</p>
                      <p className="pacing-save__status">{copy.footer.savesOnItsOwn}</p>
                    </div>
                    <div className="pacing-save__actions">
                      <Button tone="secondary" onClick={retention.reset}>
                        {copy.footer.retentionUndo}
                      </Button>
                      <Button disabled={retention.saving} onClick={retention.save}>
                        {copy.footer.retentionSave}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            }
          />

          {/* Below 1024px the rail is an ordinary section after the form, so
              its footer can be a long way down: this bar keeps the save in
              reach, and only exists while there is something to save. */}
          {totalChanges > 0 ? (
            <div className="pacing-mobilebar" role="region" aria-label={copy.mobileBar.ariaLabel}>
              <p className="pacing-mobilebar__count">
                {plural(totalChanges, copy.unsavedChanges)}
              </p>
              <Button
                className="pacing-mobilebar__save"
                disabled={!mobileSavable}
                onClick={() => {
                  if (changeCount > 0) {
                    setConfirmOpen(true);
                  } else {
                    retention.save();
                  }
                }}
              >
                {copy.mobileBar.save}
              </Button>
            </div>
          ) : null}

          <SyncPacingConfirmDialog
            open={confirmOpen}
            diff={diff}
            saving={mutation.isPending}
            onCancel={() => {
              setConfirmOpen(false);
            }}
            onConfirm={() => {
              void handleConfirm();
            }}
          />
        </div>
      ) : null}
    </PageLayout>
  );
}
