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
 * @module apps/web/src/features/connections/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { Input } from '../../../shared/ui/input';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
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
  /**
   * Pre-expands the named source's override editor on load — the "reuse the
   * same expandSourceRow-equivalent mechanism" #3150 asks to share between
   * the Edit-dialog's "Set a rule just for this source" permalink (#3148,
   * `?source=`) and the source rollup page's "Manage" links. Enabling the
   * override is what "expanded" means here: the row's body only renders
   * for a custom source, so landing on an inherited one turns it on —
   * exactly what a manual click of the checkbox already does.
   */
  initialExpandSourceId?: string;
}

const MODE_HINT: Record<PriceSyncMode, string> = {
  manual: 'New prices wait for your OK on the Price changes page before they go live.',
  automatic: 'New prices go live the moment they change in your shop — no review, no waiting.',
};

function cloneSetting(setting: PricingSyncSetting): PricingSyncSetting {
  return { mode: setting.mode, rule: { ...setting.rule } };
}

function cloneView(view: ConnectionPricingSyncView): ConnectionPricingSyncView {
  return {
    default: cloneSetting(view.default),
    sources: view.sources.map((s) => ({ ...s, effective: cloneSetting(s.effective) })),
  };
}

type RulePatch = Partial<{ type: PricingRuleType; percent: number; rounding: PriceRoundingMode }>;

function applyRulePatch(rule: PricingRule, patch: RulePatch): PricingRule {
  return {
    type: patch.type ?? rule.type,
    percent: patch.percent ?? rule.percent,
    rounding: patch.rounding ?? rule.rounding,
  };
}

export function PricingAndSyncSection({
  connectionId,
  initialExpandSourceId,
}: PricingAndSyncSectionProps): ReactElement {
  const query = useConnectionPricingSyncQuery(connectionId);
  const updateMutation = useUpdateConnectionPricingSyncMutation(connectionId);
  const { showToast } = useToast();

  const [draft, setDraft] = useState<ConnectionPricingSyncView | null>(null);
  const [customSources, setCustomSources] = useState<Set<string>>(new Set());
  const [ruleFormOpen, setRuleFormOpen] = useState(false);

  useEffect(() => {
    if (query.data && draft === null) {
      setDraft(cloneView(query.data));
      const alreadyCustom = query.data.sources
        .filter((s) => s.isCustomOverride)
        .map((s) => s.sourceConnectionId);
      const expandTarget =
        initialExpandSourceId &&
        query.data.sources.some((s) => s.sourceConnectionId === initialExpandSourceId) &&
        !alreadyCustom.includes(initialExpandSourceId)
          ? initialExpandSourceId
          : null;
      setCustomSources(new Set(expandTarget ? [...alreadyCustom, expandTarget] : alreadyCustom));
      if (expandTarget) {
        // Same effect a manual checkbox click has: copy the default rule in
        // as the starting point for this source's override.
        setDraft((prev) => {
          if (!prev) return prev;
          const next = cloneView(prev);
          const source = next.sources.find((s) => s.sourceConnectionId === expandTarget);
          if (source) source.effective = cloneSetting(next.default);
          return next;
        });
      }
    }
  }, [query.data, draft, initialExpandSourceId]);

  if (query.isLoading) {
    return <LoadingState title="Pricing & sync" message="Loading settings…" />;
  }
  if (query.error || !draft) {
    return (
      <ErrorState
        title="Couldn't load pricing & sync settings"
        message={query.error?.message ?? 'Unknown error'}
      />
    );
  }

  const isDirty = query.data ? JSON.stringify(draft) !== JSON.stringify(query.data) : false;

  function updateDefault(mode?: PriceSyncMode, rulePatch?: RulePatch): void {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneView(prev);
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
      const next = cloneView(prev);
      const source = next.sources.find((s) => s.sourceConnectionId === sourceConnectionId);
      if (!source) return next;
      // Mirrors the mockup: `cfg.sources[srcKey].override = checked ? clone(cfg.default) : null`.
      if (checked) {
        source.effective = cloneSetting(next.default);
      }
      // Unchecked: leave `effective` as-is for display — it is dropped from
      // `sourceOverrides` on Save (see `handleSave`) rather than reset here,
      // so re-checking the box on the same visit does not lose the value.
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
      const next = cloneView(prev);
      const source = next.sources.find((s) => s.sourceConnectionId === sourceConnectionId);
      if (!source) return next;
      if (mode) source.effective.mode = mode;
      if (rulePatch) source.effective.rule = applyRulePatch(source.effective.rule, rulePatch);
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    if (!draft) return;
    const sourceOverrides: Record<string, PricingSyncSetting> = {};
    for (const source of draft.sources) {
      if (customSources.has(source.sourceConnectionId)) {
        sourceOverrides[source.sourceConnectionId] = source.effective;
      }
    }
    try {
      await updateMutation.mutateAsync({ default: draft.default, sourceOverrides });
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

  function handleDiscard(): void {
    if (!query.data) return;
    setDraft(cloneView(query.data));
    setCustomSources(
      new Set(query.data.sources.filter((s) => s.isCustomOverride).map((s) => s.sourceConnectionId))
    );
  }

  const totalPendingChanges = draft.sources.reduce((sum, s) => sum + s.openEpisodeCount, 0);

  return (
    <>
      <div className="settings-section">
        <div className="settings-section__head">
          <div>
            <h2>Default pricing rule</h2>
            <p className="settings-section__desc">
              Used for every source below, unless you give one its own rule.
            </p>
          </div>
        </div>

        <div
          className="mode-switch"
          id="conn-mode-switch"
          role="radiogroup"
          aria-label="Default price sync mode"
        >
          <button
            type="button"
            id="default-mode-manual"
            data-testid="default-mode-manual"
            className={`mode-switch__opt ${draft.default.mode === 'manual' ? 'is-active' : ''}`}
            onClick={() => updateDefault('manual')}
          >
            Manual review
          </button>
          <button
            type="button"
            id="default-mode-automatic"
            data-testid="default-mode-automatic"
            className={`mode-switch__opt ${draft.default.mode === 'automatic' ? 'is-active' : ''}`}
            onClick={() => updateDefault('automatic')}
          >
            Automatic
          </button>
        </div>
        <div className="mode-switch__hint" id="conn-mode-hint">
          {MODE_HINT[draft.default.mode]}
        </div>

        <div className="rule-editor-row">
          <div className="settings-section__desc" id="conn-rule-note" style={{ maxWidth: 'none' }}>
            {ruleSentenceFor(draft.default.rule)}
          </div>
          <Button
            tone="secondary"
            className="button--xs"
            type="button"
            id="conn-edit-rule"
            onClick={() => setRuleFormOpen((v) => !v)}
          >
            Edit default rule
          </Button>
        </div>

        {ruleFormOpen ? (
          <div className="rule-editor-form" id="conn-rule-form">
            <RuleFields
              rule={draft.default.rule}
              onChange={(patch) => updateDefault(undefined, patch)}
              idPrefix="rule"
            />
          </div>
        ) : null}

        {isDirty ? (
          <div className="unsaved-bar" id="conn-unsaved-bar">
            <span className="unsaved-bar__text">
              You&apos;ve changed something and haven&apos;t saved it yet.
            </span>
            <div className="unsaved-bar__actions">
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
                disabled={updateMutation.isPending}
                onClick={() => void handleSave()}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="settings-section">
        <h2>Give one source its own rule</h2>
        <p className="settings-section__desc" style={{ marginBottom: 'var(--space-3)' }}>
          Use this when one supplier or warehouse should be priced differently — for example, a
          second warehouse with its own margin.
        </p>
        <div className="source-list" id="conn-source-list">
          {draft.sources.map((source) => {
            const isCustom = customSources.has(source.sourceConnectionId);
            return (
              <div className="source-row" key={source.sourceConnectionId}>
                <div className="source-row__head">
                  <span
                    className="source-row__name"
                    id={`source-row-name-${source.sourceConnectionId}`}
                  >
                    {source.sourceLabel}
                  </span>
                  <label className="source-row__toggle">
                    <input
                      type="checkbox"
                      id={`src-custom-${source.sourceConnectionId}`}
                      data-testid="source-custom-toggle"
                      checked={isCustom}
                      onChange={(e) =>
                        toggleSourceCustom(source.sourceConnectionId, e.target.checked)
                      }
                    />
                    Use a different rule for this source
                  </label>
                </div>
                <div
                  className="source-row__summary"
                  id={`source-row-summary-${source.sourceConnectionId}`}
                >
                  {ruleSentenceFor(source.effective.rule)}
                  {!isCustom ? ' (using the default rule)' : ''}
                </div>
                {isCustom ? (
                  <div
                    className="source-row__body"
                    id={`source-row-body-${source.sourceConnectionId}`}
                  >
                    <div
                      className="mode-switch mode-switch--sm"
                      id={`source-mode-group-${source.sourceConnectionId}`}
                      role="radiogroup"
                      aria-label={`Price sync mode for ${source.sourceLabel}`}
                    >
                      <button
                        type="button"
                        className={`mode-switch__opt ${source.effective.mode === 'manual' ? 'is-active' : ''}`}
                        onClick={() => updateSource(source.sourceConnectionId, 'manual')}
                      >
                        Manual review
                      </button>
                      <button
                        type="button"
                        className={`mode-switch__opt ${source.effective.mode === 'automatic' ? 'is-active' : ''}`}
                        onClick={() => updateSource(source.sourceConnectionId, 'automatic')}
                      >
                        Automatic
                      </button>
                    </div>
                    <RuleFields
                      rule={source.effective.rule}
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

      <div className="settings-section">
        <div className="settings-section__pending" id="conn-pending-row">
          {totalPendingChanges > 0 ? (
            <>
              <span id="conn-pending-text">{totalPendingChanges} changes waiting</span> —{' '}
              <Link id="conn-pending-link" to={`/listings?view=queue&connectionId=${connectionId}`}>
                review them
              </Link>
            </>
          ) : (
            <span id="conn-pending-text">No price changes waiting on this connection.</span>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h2>Recent activity</h2>
        <p className="settings-section__desc" style={{ marginBottom: 'var(--space-3)' }}>
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
        <div className="activity-list" id="conn-activity">
          <p className="settings-section__desc">Activity history isn&apos;t available yet.</p>
        </div>
      </div>
    </>
  );
}

function RuleFields({
  rule,
  onChange,
  idPrefix,
}: {
  rule: PricingRule;
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
              value={String(rule.percent)}
              onChange={(e) => onChange({ percent: Number(e.target.value) || 0 })}
            />
            <span className="field__currency">%</span>
          </div>
        </div>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor={`${idPrefix}-rounding`}>
          Rounding
        </label>
        <Select
          id={`${idPrefix}-rounding`}
          value={rule.rounding}
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
