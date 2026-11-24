/**
 * Buyer Data Section (#4289)
 *
 * The connection edit's answer to "which buyer data rules apply to this
 * connection": the general ones (default) or its own. Own rules take
 * precedence, start switched off, and can only be switched on after a trial
 * run has shown what they would do. Saved with the rest of the form into
 * `config.buyerDataRetention`; inheriting writes an explicit `null`.
 *
 * Follows the sibling sections' ordering rule: `form.setValue` first, then the
 * host's whole-object serializer, which reads the form state.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useState, type ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Button } from '../../../shared/ui/button';
import type { EditConnectionFormValues } from '../../connections';
import { useOperationalSettingsQuery } from '../../settings';
import type { BuyerDataOverride, BuyerDataRules } from '../api/buyer-data.types';
import { useBuyerDataImpactQuery } from '../hooks/use-buyer-data-impact-query';
import { useBuyerDataTrialMutation } from '../hooks/use-buyer-data-trial-mutation';
import {
  globalRulesFromSettings,
  overrideFromRules,
  resolveBuyerDataRules,
  validateBuyerDataRules,
} from '../lib/buyer-data-config';
import { BuyerDataImpact } from './buyer-data-impact';
import { BuyerDataRulesEditor, useBuyerDataSummary } from './buyer-data-rules-editor';
import { BuyerDataTrial } from './buyer-data-trial';

export interface BuyerDataSectionProps {
  connectionId: string;
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable - the controls are disabled (divergence gate). */
  configIsParseable: boolean;
  /** When false, the session cannot write connections. */
  canWrite: boolean;
  /** Host whole-object serializer; called AFTER setValue. */
  syncBuyerDataToJson: () => void;
}

type Source = 'inherit' | 'own';

export function BuyerDataSection({
  connectionId,
  form,
  configIsParseable,
  canWrite,
  syncBuyerDataToJson,
}: BuyerDataSectionProps): ReactElement {
  const copy = useMessages('buyer-data').section;
  const pageCopy = useMessages('buyer-data').page;
  const summarise = useBuyerDataSummary();
  const settingsQuery = useOperationalSettingsQuery();
  const trial = useBuyerDataTrialMutation();
  const [checked, setChecked] = useState<{ key: string; at: string } | null>(null);

  const override: BuyerDataOverride | null = form.watch('buyerDataRetention') ?? null;
  const globalRules = globalRulesFromSettings(settingsQuery.data);
  const own = override !== null;
  const effective = resolveBuyerDataRules(override, globalRules);
  const issues = validateBuyerDataRules(effective);
  const locked = !configIsParseable || !canWrite;

  const impact = useBuyerDataImpactQuery({
    connectionId,
    hideAfterDays: effective.hideAfterDays,
    eraseAfterDays: effective.eraseAfterDays,
    mode: effective.mode,
  });

  const rulesKey = `${effective.hideAfterDays}:${effective.eraseAfterDays}:${effective.mode}`;
  const ranOnce = checked !== null && checked.key === rulesKey;
  const stale = checked !== null && !ranOnce;

  function store(next: BuyerDataOverride | null): void {
    form.setValue('buyerDataRetention', next, { shouldDirty: true });
    syncBuyerDataToJson();
  }

  function setSource(source: Source): void {
    // Own rules start from what applies today but SWITCHED OFF: taking control is
    // not the same as turning erasing on.
    store(source === 'own' ? overrideFromRules({ ...effective, enabled: false }) : null);
  }

  function changeRules(next: BuyerDataRules): void {
    store(overrideFromRules({ ...next, enabled: override?.enabled ?? false }));
  }

  function toggleEnabled(enabled: boolean): void {
    form.setValue('buyerDataRetention', overrideFromRules({ ...effective, enabled }), {
      shouldDirty: true,
    });
    syncBuyerDataToJson();
  }

  const state = effective.enabled ? copy.stateOn : copy.stateOff;
  const canEnable = issues.length === 0 && (ranOnce || override?.enabled === true);

  return (
    <section className="rate-limit-section" data-testid="buyer-data-section">
      <h3 className="rate-limit-section__title">{copy.heading}</h3>
      <p className="rate-limit-section__help">{copy.help}</p>

      <SegmentedControl<Source>
        aria-label={copy.sourceLabel}
        value={own ? 'own' : 'inherit'}
        onChange={setSource}
        options={[
          { value: 'inherit', label: copy.inherit, disabled: locked },
          { value: 'own', label: copy.own, disabled: locked },
        ]}
      />

      {own ? (
        <p className="rate-limit-section__help">
          {copy.ownNote}{' '}
          <Button
            tone="ghost"
            className="button--sm"
            onClick={() => setSource('inherit')}
            disabled={locked}
          >
            {copy.restore}
          </Button>
        </p>
      ) : (
        <p className="rate-limit-section__help">
          {interpolate(copy.inheritedNote, { summary: summarise(globalRules) })}{' '}
          <Link to="/settings/buyer-data">{copy.changeGeneral}</Link>
        </p>
      )}

      {own ? (
        <div className="buyer-data-enable">
          <label className="rate-limit-section__toggle buyer-data-enable__toggle">
            <input
              type="checkbox"
              checked={effective.enabled}
              disabled={locked || !canEnable}
              aria-describedby={effective.enabled ? undefined : 'buyer-data-enable-hint'}
              data-testid="buyer-data-enabled"
              onChange={(event) => toggleEnabled(event.target.checked)}
            />
            <span>{copy.enabledLabel}</span>
          </label>
          {effective.enabled ? null : (
            <p id="buyer-data-enable-hint" className="rate-limit-section__help">
              {canEnable ? pageCopy.draftHint : `${pageCopy.draftHint} ${copy.enabledNeedsCheck}`}
            </p>
          )}
        </div>
      ) : (
        <p className="rate-limit-section__help">{interpolate(copy.enabledInherited, { state })}</p>
      )}
      <BuyerDataRulesEditor
        name="connection"
        rules={effective}
        onChange={changeRules}
        disabled={locked}
        showQuestions={own}
        collapseExample
      />

      <BuyerDataImpact
        rules={effective}
        preview={impact.data}
        isLoading={impact.isFetching}
        isError={impact.isError}
        isInvalid={issues.length > 0}
      />

      <BuyerDataTrial
        result={checked !== null ? trial.data : undefined}
        checkedAt={checked?.at}
        stale={stale}
        isPending={trial.isPending}
        isError={trial.isError}
        disabled={locked || issues.length > 0}
        onRun={() => {
          trial.mutate(
            {
              connectionId,
              hideAfterDays: effective.hideAfterDays,
              eraseAfterDays: effective.eraseAfterDays,
              mode: effective.mode,
            },
            { onSuccess: () => setChecked({ key: rulesKey, at: new Date().toISOString() }) }
          );
        }}
      />

    </section>
  );
}
