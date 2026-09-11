/**
 * PricingAndSyncSection (#3149, ADR-072)
 *
 * The destination connection's "Pricing & sync" settings: a default rule +
 * mode, plus any number of per-source overrides — mirrors
 * `docs/plans/mockups/price-changes-review-queue.html`'s `#page-connection`
 * (element ids below are cited from that mockup so behaviour can be checked
 * against it directly).
 *
 * **Deliberate deviation from the `StockAndPricingSection` (#2610) precedent
 * this issue asks to match "exactly"**: that component is a section INSIDE
 * `EditConnectionForm`'s single react-hook-form, writing into the
 * connection's raw JSON `config` via `syncXToJson()` whole-object-serialize
 * callbacks — the shape needed because `stockSafetyBuffer` / `pricingRule`
 * are read straight off `Connection.config`. #3146 instead shipped a
 * DEDICATED `GET`/`PATCH /connections/:id/pricing-sync` endpoint (episodes,
 * not raw config), so this section owns its own fetch + local dirty state
 * against that endpoint rather than participating in the mega-form. The
 * part of the precedent that *is* matched, per the issue's own wording, is
 * the UX contract: explicit Save/Discard, no instant-apply on any toggle —
 * every field writes to local state only, and a single PATCH on Save
 * persists the default rule and every per-source override together (one
 * call, per the issue's explicit AC).
 *
 * **Own dedicated route, not inline in the mega-form (#3149/#3166 review).**
 * This used to be mounted inside `EditConnectionForm`, alongside the legacy
 * FLAT-shape `StockAndPricingSection` pricing-rule editor — both writing
 * `Connection.config.pricingRule`, in incompatible shapes. That produced a
 * contradiction on first paint, a destructive checkbox toggle (unticking the
 * old section's pricing checkbox wrote `pricingRule: null`, dropping every
 * per-source override on save), and a stale-merge hazard on the mega-form's
 * own submit. It now lives at its own route
 * (`connection-pricing-sync-page.tsx`), the `SalesDocumentStatusSection`
 * shape: one editable surface, linked to rather than duplicated —
 * `EditConnectionForm`'s own `StockAndPricingSection` mount now hides its
 * pricing-rule half for this population entirely (see
 * `pricingRuleManagedElsewhere`) and its `onSubmit` never writes
 * `config.pricingRule` at all.
 *
 * **Write access (#3166 review, finding 3).** The PATCH is `@Roles('admin')`
 * — an operator's `connections:write` permission does not carry it (mirrors
 * `role.types.spec.ts`'s own assertion cited by `price-changes.controller.ts`).
 * `useWriteAccess('connections:write', demoMode)` therefore correctly answers
 * "may THIS session save here" for every role, not just demo mode. The GET is
 * viewer-allowed, so a non-writer still sees the real settings — every
 * interactive control is simply disabled rather than the whole section being
 * hidden, and Save/Discard carry the demo-mode `ReadOnlyLock` tooltip on top.
 *
 * @module apps/web/src/features/connections/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import {
  useConnectionPricingSyncQuery,
  useUpdateConnectionPricingSyncMutation,
  ruleSentenceFor,
  type ConnectionPricingSyncView,
  type PricingRule,
  type PricingSyncSetting,
  type PriceSyncMode,
  type PricingRuleType,
  type PriceRoundingMode,
} from '../../price-changes';
import { useToast } from '../../../shared/ui/toast-provider';

export interface PricingAndSyncSectionProps {
  connectionId: string;
}

const MODE_HINT: Record<PriceSyncMode, string> = {
  manual: 'New prices wait for your OK on the Price changes page before they go live.',
  automatic: 'New prices go live the moment they change in your shop — no review, no waiting.',
};

const MODE_OPTIONS: readonly { value: PriceSyncMode; label: string }[] = [
  { value: 'manual', label: 'Manual review' },
  { value: 'automatic', label: 'Automatic' },
];

/**
 * The draft's own rule shape keeps `percent` a STRING, never `number`
 * (#3166 review, finding 2). Round-tripping a controlled input's value
 * through `Number(text) || 0` on every keystroke erases an in-progress
 * decimal point ("22." -> 22 -> renders "22") and snaps a cleared field to
 * "0" — the exact regression `StockAndPricingSection`'s own Zod schema
 * comment records. `percent` is converted to a number exactly once, at
 * `handleSave`, mirroring that component's form-state shape.
 */
interface DraftPricingRule {
  type: PricingRuleType;
  percent: string;
  rounding: PriceRoundingMode;
}

interface DraftPricingSyncSetting {
  mode: PriceSyncMode;
  rule: DraftPricingRule;
}

interface DraftSourceEntry {
  sourceConnectionId: string;
  sourceLabel: string;
  openEpisodeCount: number;
  effective: DraftPricingSyncSetting;
}

interface DraftView {
  default: DraftPricingSyncSetting;
  sources: DraftSourceEntry[];
}

function toDraftRule(rule: PricingRule): DraftPricingRule {
  return { type: rule.type, percent: String(rule.percent), rounding: rule.rounding };
}

function toDraftSetting(setting: PricingSyncSetting): DraftPricingSyncSetting {
  return { mode: setting.mode, rule: toDraftRule(setting.rule) };
}

function toDraftView(view: ConnectionPricingSyncView): DraftView {
  return {
    default: toDraftSetting(view.default),
    sources: view.sources.map((s) => ({
      sourceConnectionId: s.sourceConnectionId,
      sourceLabel: s.sourceLabel,
      openEpisodeCount: s.openEpisodeCount,
      effective: toDraftSetting(s.effective),
    })),
  };
}

function cloneDraftSetting(setting: DraftPricingSyncSetting): DraftPricingSyncSetting {
  return { mode: setting.mode, rule: { ...setting.rule } };
}

function cloneDraftView(view: DraftView): DraftView {
  return {
    default: cloneDraftSetting(view.default),
    sources: view.sources.map((s) => ({ ...s, effective: cloneDraftSetting(s.effective) })),
  };
}

/** Any finite non-negative percent — matches the server's `@Min(0)` floor. */
const PERCENT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Mirrors `pricingRuleFormSchema.superRefine` verbatim (#3166 review, finding
 * 2) — the server refuses a margin of 100% or more by falling back silently
 * to the catalogue price (`applyPricingRule`), so an operator who typed 120
 * would save happily and publish an unchanged price. Refusing it here is
 * where they find out while they can still fix it; the PATCH's own
 * `PricingRuleMarginCeilingConstraint` is the authoritative gate this
 * mirrors, not replaces.
 */
function validateRule(rule: DraftPricingRule): string | null {
  if (rule.type === 'passthrough') return null;
  if (!PERCENT_PATTERN.test(rule.percent)) {
    return 'Enter a percentage, 0 or more.';
  }
  if (rule.type === 'margin' && Number(rule.percent) >= 100) {
    return 'A margin must be below 100%. To add more than the catalogue price, use a markup instead.';
  }
  return null;
}

function toWireRule(rule: DraftPricingRule): PricingRule {
  const parsed = Number(rule.percent);
  return {
    type: rule.type,
    percent: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    rounding: rule.rounding,
  };
}

function toWireSetting(setting: DraftPricingSyncSetting): PricingSyncSetting {
  return { mode: setting.mode, rule: toWireRule(setting.rule) };
}

/** Presentational only — `ruleSentenceFor` takes the wire (numeric) shape. */
function sentenceForDraftRule(rule: DraftPricingRule): string {
  return ruleSentenceFor(toWireRule(rule));
}

type RulePatch = Partial<{ type: PricingRuleType; percent: string; rounding: PriceRoundingMode }>;

function applyRulePatch(rule: DraftPricingRule, patch: RulePatch): DraftPricingRule {
  return {
    type: patch.type ?? rule.type,
    percent: patch.percent ?? rule.percent,
    rounding: patch.rounding ?? rule.rounding,
  };
}

export function PricingAndSyncSection({ connectionId }: PricingAndSyncSectionProps): ReactElement {
  const query = useConnectionPricingSyncQuery(connectionId);
  const updateMutation = useUpdateConnectionPricingSyncMutation(connectionId);
  const { showToast } = useToast();

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const readOnly = !write.canWrite;

  const [draft, setDraft] = useState<DraftView | null>(null);
  const [customSources, setCustomSources] = useState<Set<string>>(new Set());
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [dropOverrideConfirm, setDropOverrideConfirm] = useState<{
    droppedLabels: string[];
  } | null>(null);

  useEffect(() => {
    if (query.data && draft === null) {
      setDraft(toDraftView(query.data));
      setCustomSources(
        new Set(
          query.data.sources.filter((s) => s.isCustomOverride).map((s) => s.sourceConnectionId)
        )
      );
    }
  }, [query.data, draft]);

  // Re-seed from a SUCCESSFUL save's own response (#3166 review, finding 3) —
  // not only at mount. The server recomputes `sources[].effective` /
  // `isCustomOverride` / `openEpisodeCount` on write, so comparing the local
  // draft against the STALE `query.data` snapshot would keep `isDirty` true
  // forever after the most common interaction this section offers.
  useEffect(() => {
    if (updateMutation.isSuccess && updateMutation.data) {
      setDraft(toDraftView(updateMutation.data));
      setCustomSources(
        new Set(
          updateMutation.data.sources
            .filter((s) => s.isCustomOverride)
            .map((s) => s.sourceConnectionId)
        )
      );
    }
  }, [updateMutation.isSuccess, updateMutation.data]);

  // `query.error` is checked BEFORE the still-hydrating gap (#3166 review,
  // finding 6): on the render where `isLoading` has just flipped false but
  // the effect above hasn't yet run, `draft` is still `null` with NO error —
  // a successful load, not a failure. Reading that as "unknown error" made
  // `ErrorState`'s `role="alert"` announce a failure on every successful
  // page load.
  if (query.error) {
    return (
      <ErrorState
        title="Couldn't load pricing & sync settings"
        message={query.error.message}
      />
    );
  }
  if (query.isLoading || !draft) {
    return <LoadingState title="Pricing & sync" message="Loading settings…" />;
  }

  const isDirty = query.data ? JSON.stringify(draft) !== JSON.stringify(toDraftView(query.data)) : false;
  const isCustomSourcesDirty = query.data
    ? JSON.stringify([...customSources].sort()) !==
      JSON.stringify(
        query.data.sources
          .filter((s) => s.isCustomOverride)
          .map((s) => s.sourceConnectionId)
          .sort()
      )
    : false;
  const hasUnsavedChanges = isDirty || isCustomSourcesDirty;

  const defaultRuleError = validateRule(draft.default.rule);
  const activeSourceErrors = draft.sources
    .filter((s) => customSources.has(s.sourceConnectionId))
    .map((s) => validateRule(s.effective.rule));
  const hasInvalidRule = defaultRuleError !== null || activeSourceErrors.some((e) => e !== null);

  function updateDefault(mode?: PriceSyncMode, rulePatch?: RulePatch): void {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneDraftView(prev);
      if (mode) next.default.mode = mode;
      if (rulePatch) next.default.rule = applyRulePatch(next.default.rule, rulePatch);
      return next;
    });
  }

  function toggleSourceCustom(sourceConnectionId: string, checked: boolean): void {
    setCustomSources((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceConnectionId);
      else next.delete(sourceConnectionId);
      return next;
    });
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneDraftView(prev);
      const source = next.sources.find((s) => s.sourceConnectionId === sourceConnectionId);
      if (!source) return next;
      // Mirrors the mockup: `cfg.sources[srcKey].override = checked ? clone(cfg.default) : null`.
      if (checked) {
        source.effective = cloneDraftSetting(next.default);
      }
      // Unchecked: leave `effective` as-is for STORAGE — it is dropped from
      // `sourceOverrides` on Save (see `handleSave`) rather than reset here,
      // so re-checking the box on the same visit does not lose the value.
      // Display falls back to the default rule instead (see the render
      // below) so the summary sentence never asserts a rule that is about
      // to be discarded (#3166 review, finding 4).
      return next;
    });
  }

  function updateSource(
    sourceConnectionId: string,
    mode?: PriceSyncMode,
    rulePatch?: RulePatch
  ): void {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneDraftView(prev);
      const source = next.sources.find((s) => s.sourceConnectionId === sourceConnectionId);
      if (!source) return next;
      if (mode) source.effective.mode = mode;
      if (rulePatch) source.effective.rule = applyRulePatch(source.effective.rule, rulePatch);
      return next;
    });
  }

  /**
   * Sources that carry a PERSISTED override (`isCustomOverride` on the last
   * server read) which the current draft is about to drop by not being in
   * `customSources` anymore (#3166 review, finding 4) — used to gate a
   * confirmation before a destructive Save rather than silently discarding a
   * configured rule with no warning.
   */
  function overridesAboutToBeDropped(): string[] {
    if (!query.data) return [];
    return query.data.sources
      .filter((s) => s.isCustomOverride && !customSources.has(s.sourceConnectionId))
      .map((s) => s.sourceLabel);
  }

  async function persistSave(): Promise<void> {
    if (!draft) return;
    const sourceOverrides: Record<string, PricingSyncSetting> = {};
    for (const source of draft.sources) {
      if (customSources.has(source.sourceConnectionId)) {
        sourceOverrides[source.sourceConnectionId] = toWireSetting(source.effective);
      }
    }
    try {
      await updateMutation.mutateAsync({ default: toWireSetting(draft.default), sourceOverrides });
      showToast({
        tone: 'success',
        title: 'Saved',
        description: 'Pricing & sync settings updated.',
      });
    } catch (error) {
      showToast({
        tone: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to save pricing & sync settings.',
      });
    }
  }

  async function handleSave(): Promise<void> {
    if (hasInvalidRule) return;
    const dropped = overridesAboutToBeDropped();
    if (dropped.length > 0) {
      setDropOverrideConfirm({ droppedLabels: dropped });
      return;
    }
    await persistSave();
  }

  async function confirmDropAndSave(): Promise<void> {
    setDropOverrideConfirm(null);
    await persistSave();
  }

  function handleDiscard(): void {
    if (!query.data) return;
    setDraft(toDraftView(query.data));
    setCustomSources(
      new Set(query.data.sources.filter((s) => s.isCustomOverride).map((s) => s.sourceConnectionId))
    );
  }

  const totalPendingChanges = draft.sources.reduce((sum, s) => sum + s.openEpisodeCount, 0);

  return (
    <>
      <div className="pricing-sync__section pricing-sync__section--first">
        <div className="pricing-sync__section-head">
          <div>
            <h3 className="pricing-sync__section-title">Default pricing rule</h3>
            <p className="pricing-sync__section-desc">
              Used for every source below, unless you give one its own rule.
            </p>
          </div>
        </div>

        <SegmentedControl
          id="conn-mode-switch"
          aria-label="Default price sync mode"
          options={MODE_OPTIONS.map((option) => ({ ...option, disabled: readOnly }))}
          value={draft.default.mode}
          onChange={(mode) => updateDefault(mode)}
        />
        <div className="pricing-sync__mode-hint" id="conn-mode-hint">
          {MODE_HINT[draft.default.mode]}
        </div>

        <div className="pricing-sync__rule-row">
          <div className="pricing-sync__section-desc" id="conn-rule-note" style={{ maxWidth: 'none' }}>
            {sentenceForDraftRule(draft.default.rule)}
          </div>
          <Button
            tone="secondary"
            className="button--xs"
            type="button"
            id="conn-edit-rule"
            disabled={readOnly}
            onClick={() => setRuleFormOpen((v) => !v)}
          >
            Edit default rule
          </Button>
        </div>

        {ruleFormOpen ? (
          <div className="pricing-sync__rule-form" id="conn-rule-form">
            <RuleFields
              rule={draft.default.rule}
              error={defaultRuleError}
              disabled={readOnly}
              onChange={(patch) => updateDefault(undefined, patch)}
              idPrefix="rule"
            />
          </div>
        ) : null}

        {hasUnsavedChanges ? (
          <div className="pricing-sync__unsaved-bar" id="conn-unsaved-bar">
            <span className="pricing-sync__unsaved-bar-text">
              You&apos;ve changed something and haven&apos;t saved it yet.
            </span>
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
              <div className="pricing-sync__unsaved-bar-actions">
                <Button
                  tone="secondary"
                  className="button--sm"
                  type="button"
                  id="conn-discard"
                  onClick={handleDiscard}
                >
                  Discard
                </Button>
                <Button
                  className="button--sm"
                  type="button"
                  id="conn-save"
                  disabled={updateMutation.isPending || readOnly || hasInvalidRule}
                  onClick={() => void handleSave()}
                >
                  {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </ReadOnlyLock>
          </div>
        ) : null}
      </div>

      <div className="pricing-sync__section">
        <h3 className="pricing-sync__section-title">Give one source its own rule</h3>
        <p className="pricing-sync__section-desc" style={{ marginBottom: 'var(--space-3)' }}>
          Use this when one supplier or warehouse should be priced differently — for example, a
          second warehouse with its own margin.
        </p>
        <div className="pricing-sync__source-list" id="conn-source-list">
          {draft.sources.map((source) => {
            const isCustom = customSources.has(source.sourceConnectionId);
            // Falls back to the DEFAULT rule when unticked (#3166 review,
            // finding 4) — `source.effective` is kept around only so
            // re-checking the box on the same visit restores it, and
            // displaying it while unticked asserted a rule that Save is
            // about to discard.
            const displayedRule = isCustom ? source.effective.rule : draft.default.rule;
            const sourceError = isCustom ? validateRule(source.effective.rule) : null;
            return (
              <div className="pricing-sync__source-row" key={source.sourceConnectionId}>
                <div className="pricing-sync__source-row-head">
                  <span
                    className="pricing-sync__source-row-name"
                    id={`source-row-name-${source.sourceConnectionId}`}
                  >
                    {source.sourceLabel}
                  </span>
                  <label className="pricing-sync__source-row-toggle">
                    <input
                      type="checkbox"
                      id={`src-custom-${source.sourceConnectionId}`}
                      data-testid="source-custom-toggle"
                      checked={isCustom}
                      disabled={readOnly}
                      onChange={(e) =>
                        toggleSourceCustom(source.sourceConnectionId, e.target.checked)
                      }
                    />
                    Use a different rule for this source
                  </label>
                </div>
                <div
                  className="pricing-sync__source-row-summary"
                  id={`source-row-summary-${source.sourceConnectionId}`}
                >
                  {sentenceForDraftRule(displayedRule)}
                  {!isCustom ? ' (using the default rule)' : ''}
                </div>
                {isCustom ? (
                  <div
                    className="pricing-sync__source-row-body"
                    id={`source-row-body-${source.sourceConnectionId}`}
                  >
                    <SegmentedControl
                      aria-label={`Price sync mode for ${source.sourceLabel}`}
                      options={MODE_OPTIONS.map((option) => ({ ...option, disabled: readOnly }))}
                      value={source.effective.mode}
                      onChange={(mode) => updateSource(source.sourceConnectionId, mode)}
                    />
                    <RuleFields
                      rule={source.effective.rule}
                      error={sourceError}
                      disabled={readOnly}
                      onChange={(patch) =>
                        updateSource(source.sourceConnectionId, undefined, patch)
                      }
                      idPrefix={`source-${source.sourceConnectionId}`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="pricing-sync__section">
        <div className="pricing-sync__pending" id="conn-pending-row">
          {totalPendingChanges > 0 ? (
            <>
              <span id="conn-pending-text">
                {totalPendingChanges} change{totalPendingChanges === 1 ? '' : 's'} waiting
              </span>{' '}
              —{' '}
              {/* `queueConn`, not `connectionId` — the queue table's own
                  channel filter is namespaced separately from the "All
                  listings" tab's `?connectionId` selector (#3164 review) so
                  neither silently pre-filters the other; this link must
                  target the queue's own param to actually pre-filter it. */}
              <Link id="conn-pending-link" to={`/listings?view=queue&queueConn=${connectionId}`}>
                review them
              </Link>
            </>
          ) : (
            <span id="conn-pending-text">No price changes waiting on this connection.</span>
          )}
        </div>
      </div>

      <div className="pricing-sync__section">
        <h3 className="pricing-sync__section-title">Recent activity</h3>
        <p className="pricing-sync__section-desc" style={{ marginBottom: 'var(--space-3)' }}>
          The last price decisions made on this connection.
        </p>
        {/*
         * Gap, flagged rather than fabricated (issue's own stated
         * assumption): no activity-log endpoint exists yet for #3145/#3146's
         * price-change episodes (accept/ignore/edit history), so this
         * renders a documented empty-but-present state instead of inventing
         * client-only history. Wiring this to a real feed is a follow-up
         * once such an endpoint exists.
         */}
        <div className="pricing-sync__activity-list" id="conn-activity">
          <p className="pricing-sync__section-desc">Activity history isn&apos;t available yet.</p>
        </div>
      </div>

      <ConfirmDialog
        open={dropOverrideConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setDropOverrideConfirm(null);
        }}
        title="Discard the per-source rule?"
        tone="danger"
        confirmLabel="Discard and save"
        description={
          dropOverrideConfirm
            ? `Saving will permanently remove the custom rule for ${dropOverrideConfirm.droppedLabels.join(', ')}. It will go back to using the default rule.`
            : ''
        }
        isConfirming={updateMutation.isPending}
        onConfirm={() => void confirmDropAndSave()}
      />
    </>
  );
}

function RuleFields({
  rule,
  error,
  disabled,
  onChange,
  idPrefix,
}: {
  rule: DraftPricingRule;
  error: string | null;
  disabled?: boolean;
  onChange: (patch: RulePatch) => void;
  idPrefix: string;
}): ReactElement {
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor={`${idPrefix}-type`}>
          Pricing rule
        </label>
        <Select
          id={`${idPrefix}-type`}
          value={rule.type}
          disabled={disabled}
          onChange={(e) => onChange({ type: e.target.value as PricingRuleType })}
        >
          <option value="passthrough">Use shop price as-is</option>
          <option value="markup">Add a percentage</option>
          <option value="margin">Keep a percentage margin</option>
        </Select>
      </div>
      {rule.type !== 'passthrough' ? (
        <div className="field">
          <label className="field__label" htmlFor={`${idPrefix}-pct`}>
            Percent
          </label>
          <div className="field__price-input">
            <Input
              id={`${idPrefix}-pct`}
              inputMode="decimal"
              value={rule.percent}
              disabled={disabled}
              invalid={Boolean(error)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${idPrefix}-pct-error` : undefined}
              onChange={(e) => onChange({ percent: e.target.value })}
            />
            <span className="field__currency">%</span>
          </div>
          {error ? (
            <p className="pricing-sync__field-error" id={`${idPrefix}-pct-error`}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor={`${idPrefix}-rounding`}>
          Rounding
        </label>
        <Select
          id={`${idPrefix}-rounding`}
          value={rule.rounding}
          disabled={disabled}
          onChange={(e) => onChange({ rounding: e.target.value as PriceRoundingMode })}
        >
          <option value="none">No rounding</option>
          <option value="nearestWhole">Round to a whole number</option>
          <option value="endingIn99">Round to end in .99</option>
        </Select>
      </div>
    </>
  );
}
