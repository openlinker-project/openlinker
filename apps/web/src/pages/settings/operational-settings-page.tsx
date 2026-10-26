/**
 * Sync Pacing Page (#2653)
 *
 * The operator-facing screen for the values #2651 made settable: how many
 * products OpenLinker reads from a shop per run, and how often it checks for
 * products that were deleted there.
 *
 * A plain form would not do. These values are not intuitive and getting one
 * wrong is not obviously wrong — raising the catalogue value from 500 to 2000
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
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { RangeNumberInput } from '../../shared/ui/range-number-input';
import { Select } from '../../shared/ui/select';
import { useToast } from '../../shared/ui/toast-provider';
import { useSession } from '../../shared/auth/use-session';
import { PacingValueField } from '../../features/settings/components/pacing-value-field';
import { SyncJobRetentionSection } from '../../features/settings/components/sync-job-retention-section';
import { SyncPacingConfirmDialog } from '../../features/settings/components/sync-pacing-confirm-dialog';
import { SyncPacingRail } from '../../features/settings/components/sync-pacing-rail';
import { useCatalogueSizeQuery } from '../../features/settings/hooks/use-catalogue-size-query';
import { useOperationalSettingsQuery } from '../../features/settings/hooks/use-operational-settings-query';
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
const SECTION_LINKS: readonly { id: string; label: string }[] = [
  { id: 'pacing-hosting', label: 'Hosting' },
  { id: 'pacing-catalogue', label: 'Catalogue' },
  { id: 'pacing-stock', label: 'Stock' },
  { id: 'pacing-deletions', label: 'Deleted products' },
  { id: 'pacing-retention', label: 'Job retention' },
];

/**
 * The sweep-pacing form's own numeric fields, in the order the page lays
 * them out — a NARROWER type than `OperationalSettingKey` on purpose
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
      <PageLayout eyebrow="Settings" title="Sync pacing" description="Admin-only access.">
        <ErrorState
          title="Admin role required"
          message="This page changes how hard OpenLinker works your shop — it requires an admin session."
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
        title: 'Sync pacing saved',
        description:
          payload.deletionAuditCadence === undefined
            ? 'The next run uses the new values.'
            : 'The next run uses the new values. How often deleted products are checked changes when the background worker next restarts.',
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
      ? 'No changes yet.'
      : unacknowledgedFields.length > 0
        ? `${
            unacknowledgedFields.length === 1 ? 'One value is' : 'Some values are'
          } past what we suggest. Tick the box next to ${
            unacknowledgedFields.length === 1 ? 'it' : 'each of them'
          } to continue.`
        : 'You will see what each one does before it saves.';

  return (
    <PageLayout
      eyebrow="Settings"
      title="Sync pacing"
      description="How hard OpenLinker works your shop, and how long a full pass takes. Changing these trades shop load against how quickly OpenLinker notices a change."
      summary={
        <nav className="pacing-nav" aria-label="Sections on this page">
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
              {link.label}
            </a>
          ))}
        </nav>
      }
    >
      {query.isPending ? (
        <LoadingState title="Loading sync pacing" message="Reading the values in force…" />
      ) : query.error ? (
        <ErrorState
          title="Unable to load sync pacing"
          message={query.error instanceof Error ? query.error.message : 'Unknown error'}
          action={
            <Button tone="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : view !== null && draft !== null && projections !== null ? (
        <div className="pacing-layout" data-mobile-bar={String(totalChanges > 0)}>
          <div className="settings-column">
            {errors.formErrors.length > 0 ? (
              <Alert tone="error" title="The change was not saved">
                {errors.formErrors.join(' ')}
              </Alert>
            ) : null}

            {/* Stated once, not per field. OpenLinker runs as two processes with
                separate environments, and the sweeps run in the background
                worker — so a value this page read from an environment variable,
                or fell back to a default for, describes the API process rather
                than the one doing the work. Only a saved value is definite for
                both (#2660 review). Rendered when ANY value is unsaved, which
                on a fresh install is all of them, and is exactly when the
                caveat is worth reading. */}
            {workerMayDiffer ? (
              <Alert tone="info" title="Some of these are not saved here yet">
                Values you have not saved come from this server&apos;s settings or from
                OpenLinker&apos;s defaults. The part of OpenLinker that does the syncing runs
                as a separate process and reads its own settings, so it may be using
                something else. Saving a value here makes it definite for both.
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
                  <p className="eyebrow">Your server</p>
                  <h3 className="section-title" id="pacing-hosting-title">
                    Hosting limits
                  </h3>
                </div>
                <span className="panel__meta">Used by the calculator</span>
              </header>

              <div className="pacing-card__fields">
                <div className="pacing-field">
                  <div className="pacing-field__head">
                    <label className="form-field__label" htmlFor="host-process-limit">
                      Process time limit
                    </label>
                    <span className="form-field__source pacing-field__source">
                      kept in this browser
                    </span>
                  </div>
                  <RangeNumberInput
                    id="host-process-limit"
                    value={hostLimit}
                    min={HOST_LIMIT_MIN_SECONDS}
                    max={HOST_LIMIT_MAX_SECONDS}
                    step={10}
                    unit="s"
                    ariaLabel="Process time limit in seconds"
                    describedBy="host-process-limit-description"
                    onChange={handleHostLimit}
                  />
                  <p
                    className="form-field__description pacing-field__description"
                    id="host-process-limit-description"
                  >
                    How long your host lets a single process run before killing it. Shared hosting
                    is often 300 seconds. Ask your provider, or leave it at 300. OpenLinker cannot
                    read it from your host.
                  </p>
                </div>

                <div className="pacing-field">
                  <div className="pacing-field__head">
                    <span className="form-field__label">Products OpenLinker holds</span>
                    <span className="form-field__source pacing-field__source">
                      read from your catalogue
                    </span>
                  </div>
                  <p className="pacing-stat">
                    {catalogueSizeQuery.isPending
                      ? '…'
                      : catalogueSize === null
                        ? 'not known yet'
                        : catalogueSize.toLocaleString()}
                  </p>
                  <p className="form-field__description pacing-field__description">
                    Used only to work out how long a full pass takes. This is what OpenLinker has
                    copied over so far, which during a first sync is fewer than your shop holds.
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
                  <p className="eyebrow">Catalogue</p>
                  <h3 className="section-title" id="pacing-catalogue-title">
                    Product sweep
                  </h3>
                </div>
                {/* Rendered from what the API reported, never a literal: both
                    sweep cadences are settable in the worker's environment, so a
                    hardcoded badge states as fact something an operator may have
                    changed (#2660 review). */}
                <span className="panel__meta">
                  {view.catalogueSweepCadence === undefined
                    ? 'every 20 min (assumed)'
                    : describeCadence(view.catalogueSweepCadence.value).toLowerCase()}
                </span>
              </header>

              <div className="pacing-card__fields">
                <PacingValueField
                  label="Products per run"
                  ariaLabel="Products per catalogue run"
                  description="How many products OpenLinker reads from the shop in one run. Raise it and a full pass finishes sooner, but each run leans harder on the shop."
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
                  label="Products per shop request"
                  ariaLabel="Products per shop request"
                  description="How many products OpenLinker asks the shop for in one request. Asking for fewer means more requests for the same work; asking for more makes a single failed request cost more."
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
                  <p className="eyebrow">Stock</p>
                  <h3 className="section-title" id="pacing-stock-title">
                    Stock sweep
                  </h3>
                </div>
                <span className="panel__meta">
                  {view.inventorySweepCadence === undefined
                    ? 'every 15 min (assumed)'
                    : describeCadence(view.inventorySweepCadence.value).toLowerCase()}
                </span>
              </header>

              <div className="pacing-card__fields">
                <PacingValueField
                  label="Products per run"
                  ariaLabel="Products per stock run"
                  description="How many products have their stock re-read in one run. On a shop that does not push stock changes to OpenLinker, this is the only thing that notices a quantity change."
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
                  <p className="eyebrow">Deleted products</p>
                  <h3 className="section-title" id="pacing-deletions-title">
                    Deletion audit
                  </h3>
                </div>
                {view.deletionAuditAlwaysEnabled ? (
                  <span className="panel__meta">no off switch here</span>
                ) : null}
              </header>

              <div className="pacing-card__copy">
                <p>
                  OpenLinker walks its own list of products and checks each one against the shop, so a
                  deletion is found even when nothing told us about it. Some shops do tell us — the
                  PrestaShop module reports a delete as it happens — and where they do, the audit is
                  the backstop rather than the only route. This page cannot tell which is true for a
                  given connection.
                </p>
                <p>
                  This page has no switch to turn the audit off, because it is what stops a deleted
                  product's offers from selling. It can still be disabled on the worker with{' '}
                  <code>OL_MASTER_PRODUCT_RECONCILE_ENABLED=false</code>, and this page cannot see
                  that.
                </p>
              </div>

              <div className="pacing-card__fields">
                <PacingValueField
                  label="Products checked per run"
                  ariaLabel="Products checked per deletion-audit run"
                  description="How many products are checked in one run."
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
                      How often it runs
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
                        ? `${describeCadence(view.deletionAuditCadence.value).toLowerCase()} (${
                            view.deletionAuditCadence.source === 'setting'
                              ? 'you set this'
                              : view.deletionAuditCadence.source === 'env'
                                ? 'from a server setting'
                                : 'default'
                          })`
                        : `${describeCadence(draft.deletionAuditCadence).toLowerCase()} (not saved yet)`}
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
                    Together with the number above, this decides how long a deleted product can keep
                    selling. It cannot be turned off.
                  </p>
                  {draft.deletionAuditCadence !== view.deletionAuditCadence.value ? (
                    <>
                      <span className="field-changed">
                        changed from{' '}
                        {describeCadence(view.deletionAuditCadence.value).toLowerCase()}
                      </span>
                      {cadenceTimingNote !== undefined ? (
                        <Alert tone="info" title="When this starts">
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
                      {changeCount === 0
                        ? 'Sync pacing'
                        : `${String(changeCount)} unsaved ${changeCount === 1 ? 'change' : 'changes'}`}
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
                      Undo my edits
                    </Button>
                    <Button
                      disabled={!pacingSavable}
                      onClick={() => {
                        setConfirmOpen(true);
                      }}
                    >
                      Save changes
                    </Button>
                  </div>
                </div>

                {/* Retention saves on its own, with no confirmation: it has
                    no catalogue-size consequence to confirm. Offered only
                    once there is something to save. */}
                {retention.changeCount > 0 ? (
                  <div className="pacing-save pacing-save--inline" data-dirty="true">
                    <div className="pacing-save__text">
                      <p className="pacing-save__count">Job retention changed</p>
                      <p className="pacing-save__status">Saves on its own, no confirmation.</p>
                    </div>
                    <div className="pacing-save__actions">
                      <Button tone="secondary" onClick={retention.reset}>
                        Undo
                      </Button>
                      <Button disabled={retention.saving} onClick={retention.save}>
                        Save retention
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
            <div className="pacing-mobilebar" role="region" aria-label="Unsaved changes">
              <p className="pacing-mobilebar__count">
                {`${String(totalChanges)} unsaved ${totalChanges === 1 ? 'change' : 'changes'}`}
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
                Save
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
