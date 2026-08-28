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
import { FormField } from '../../shared/ui/form-field';
import { Input } from '../../shared/ui/input';
import { PageLayout } from '../../shared/ui/page-layout';
import { Select } from '../../shared/ui/select';
import { useToast } from '../../shared/ui/toast-provider';
import { useSession } from '../../shared/auth/use-session';
import { PacingValueField } from '../../features/settings/components/pacing-value-field';
import { SyncPacingConfirmDialog } from '../../features/settings/components/sync-pacing-confirm-dialog';
import { SyncPacingImpact } from '../../features/settings/components/sync-pacing-impact';
import { useCatalogueSizeQuery } from '../../features/settings/hooks/use-catalogue-size-query';
import { useOperationalSettingsQuery } from '../../features/settings/hooks/use-operational-settings-query';
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
import type {
  OperationalSettingBound,
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

/** Used only when the server omits a bound, so a control always has a range. */
const FALLBACK_BOUND: OperationalSettingBound = {
  min: 1,
  max: 2000,
  default: 100,
  envVar: '',
};

function boundFor(view: OperationalSettingsView, key: OperationalSettingKey): OperationalSettingBound {
  return view.bounds[key] ?? FALLBACK_BOUND;
}

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
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HOST_PROCESS_LIMIT_SECONDS;
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

  const view = query.data ?? null;
  const savedStamp = view === null ? null : `${view.updatedAt ?? 'none'}:${view.deletionAuditCadence.value}`;

  // Adopt the server's values once, and again whenever the saved row changes
  // underneath us. Deliberately keyed on the saved stamp rather than on `view`
  // itself: a background refetch that changed nothing must not discard an
  // edit in progress (the #478 shape the settings dialogs already follow).
  useEffect(() => {
    if (view !== null) {
      setDraft(toValues(view));
    }
    // Dependency list is deliberately just the saved stamp; `view` is read
    // inside and must not re-trigger this.
  }, [savedStamp]);

  const errors = mutation.error
    ? mapOperationalSettingsErrors(mutation.error)
    : NO_OPERATIONAL_SETTINGS_ERRORS;

  const catalogueSize = catalogueSizeQuery.data ?? null;

  const diff = useMemo(() => {
    if (view === null || draft === null) {
      return { changes: [], lengthensDeletionWindow: false };
    }
    return diffSyncPacing(toValues(view), draft, {
      hostProcessLimitSeconds: hostLimit,
      catalogueSize,
      cadenceAppliesAt: view.cadenceAppliesAt,
    });
  }, [view, draft, hostLimit, catalogueSize]);

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
    const context = { hostProcessLimitSeconds: hostLimit, catalogueSize };
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

  const handleHostLimit = (raw: string): void => {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : hostLimit;
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

  return (
    <PageLayout
      eyebrow="Settings"
      title="Sync pacing"
      description="How hard OpenLinker works your shop, and how long a full pass takes. Changing these trades shop load against how quickly OpenLinker notices a change."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Catalogue</span>
          <span className="toolbar-chip">Stock</span>
          <span className="toolbar-chip">Deleted products</span>
          <span className="toolbar-chip">Hosting</span>
        </div>
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
        <div className="workspace-grid--primary">
          <div className="settings-column">
            {errors.formErrors.length > 0 ? (
              <Alert tone="error" title="The change was not saved">
                {errors.formErrors.join(' ')}
              </Alert>
            ) : null}

            {/* ── Hosting ──────────────────────────────────────────────── */}
            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Your server</p>
                  <h3 className="section-title">Hosting limits</h3>
                </div>
                <span className="panel__meta">Used by the calculator</span>
              </div>

              <div className="field-stack">
                <FormField
                  name="host-process-limit"
                  label="Process time limit (seconds)"
                  description="How long your host lets a single process run before killing it. Shared hosting is often 300 seconds. Ask your provider, or leave it at 300. Kept in this browser — OpenLinker cannot read it from your host."
                >
                  <Input
                    className="control--narrow"
                    type="number"
                    min={10}
                    max={3600}
                    step={10}
                    value={hostLimit}
                    onChange={(event) => {
                      handleHostLimit(event.target.value);
                    }}
                  />
                </FormField>

                <div className="form-field">
                  <span className="form-field__label form-field__label--split">
                    Products OpenLinker holds
                    <span className="form-field__source">read from your catalogue</span>
                  </span>
                  <p className="mono-text">
                    {catalogueSizeQuery.isPending
                      ? '…'
                      : catalogueSize === null
                        ? 'not known yet'
                        : catalogueSize.toLocaleString()}
                  </p>
                  <p className="form-field__description">
                    Used only to work out how long a full pass takes. This is what OpenLinker has
                    copied over so far, which during a first sync is fewer than your shop holds.
                  </p>
                </div>
              </div>
            </article>

            {/* ── Catalogue ────────────────────────────────────────────── */}
            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Catalogue</p>
                  <h3 className="section-title">Product sweep</h3>
                </div>
                <span className="panel__meta">every 20 min</span>
              </div>

              <div className="field-stack">
                <PacingValueField
                  label="Products per run"
                  ariaLabel="Products per catalogue run"
                  description="How many products OpenLinker reads from the shop in one run. Raise it and a full pass finishes sooner, but each run leans harder on the shop."
                  value={draft.catalogueSweepBudget}
                  min={boundFor(view, 'catalogueSweepBudget').min}
                  max={boundFor(view, 'catalogueSweepBudget').max}
                  savedValue={view.catalogueSweepBudget.value}
                  savedSource={view.catalogueSweepBudget.source}
                  error={errors.fieldErrors.catalogueSweepBudget}
                  onChange={(value) => {
                    setDraft({ ...draft, catalogueSweepBudget: value });
                  }}
                />

                <PacingValueField
                  label="Products per shop request"
                  ariaLabel="Products per shop request"
                  description="How many products OpenLinker asks the shop for at a time. 100 is the most any supported shop will return; asking for fewer only means more requests for the same work."
                  value={draft.sweepPageSize}
                  min={boundFor(view, 'sweepPageSize').min}
                  max={boundFor(view, 'sweepPageSize').max}
                  step={10}
                  savedValue={view.sweepPageSize.value}
                  savedSource={view.sweepPageSize.source}
                  error={errors.fieldErrors.sweepPageSize}
                  onChange={(value) => {
                    setDraft({ ...draft, sweepPageSize: value });
                  }}
                />
              </div>
            </article>

            {/* ── Stock ────────────────────────────────────────────────── */}
            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Stock</p>
                  <h3 className="section-title">Stock sweep</h3>
                </div>
                <span className="panel__meta">every 15 min</span>
              </div>

              <div className="field-stack">
                <PacingValueField
                  label="Products per run"
                  ariaLabel="Products per stock run"
                  description="How many products have their stock re-read in one run. On a shop that does not push stock changes to OpenLinker, this is the only thing that notices a quantity change."
                  value={draft.inventorySweepBudget}
                  min={boundFor(view, 'inventorySweepBudget').min}
                  max={boundFor(view, 'inventorySweepBudget').max}
                  savedValue={view.inventorySweepBudget.value}
                  savedSource={view.inventorySweepBudget.source}
                  error={errors.fieldErrors.inventorySweepBudget}
                  onChange={(value) => {
                    setDraft({ ...draft, inventorySweepBudget: value });
                  }}
                />
              </div>
            </article>

            {/* ── Deleted products ─────────────────────────────────────── */}
            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Deleted products</p>
                  <h3 className="section-title">Deletion audit</h3>
                </div>
                {view.deletionAuditAlwaysEnabled ? (
                  <span className="panel__meta">cannot be switched off</span>
                ) : null}
              </div>

              <p className="panel-copy muted-text">
                A shop never tells OpenLinker that a product is gone, so OpenLinker walks its own
                list and checks. Until a deleted product is reached, its offers keep selling.
              </p>

              <div className="field-stack">
                <PacingValueField
                  label="Products checked per run"
                  ariaLabel="Products checked per deletion-audit run"
                  description="How many products are checked in one run."
                  value={draft.deletionAuditBudget}
                  min={boundFor(view, 'deletionAuditBudget').min}
                  max={boundFor(view, 'deletionAuditBudget').max}
                  savedValue={view.deletionAuditBudget.value}
                  savedSource={view.deletionAuditBudget.source}
                  error={errors.fieldErrors.deletionAuditBudget}
                  onChange={(value) => {
                    setDraft({ ...draft, deletionAuditBudget: value });
                  }}
                />

                <div className="form-field">
                  <label className="form-field__label form-field__label--split" htmlFor="audit-cadence">
                    How often it runs
                    <span
                      className="form-field__source"
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
                  </label>
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
                  <p className="form-field__description" id="audit-cadence-description">
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
            </article>

            <div className="form-actions">
              <Button
                disabled={diff.changes.length === 0 || mutation.isPending}
                onClick={() => {
                  setConfirmOpen(true);
                }}
              >
                Save changes
              </Button>
              <Button
                tone="secondary"
                disabled={diff.changes.length === 0}
                onClick={() => {
                  setDraft(toValues(view));
                }}
              >
                Undo my edits
              </Button>
              <span className="actions-hint">
                {diff.changes.length === 0
                  ? 'No changes yet.'
                  : `${String(diff.changes.length)} ${
                      diff.changes.length === 1 ? 'setting' : 'settings'
                    } changed. You will see what each one does before it saves.`}
              </span>
            </div>
          </div>

          <aside className="impact-column">
            <SyncPacingImpact
              before={projections.before}
              after={projections.after}
              catalogueValue={draft.catalogueSweepBudget}
              catalogueBound={boundFor(view, 'catalogueSweepBudget')}
              hostLimitSeconds={hostLimit}
              catalogueSizeKnown={catalogueSize !== null}
            />
          </aside>

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
