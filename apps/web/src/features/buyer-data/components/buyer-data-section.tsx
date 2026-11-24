/**
 * Buyer Data Section (#4289)
 *
 * The connection edit's answer to "which buyer data rules apply to this
 * connection": the general ones (default) or its own. Own rules take
 * precedence, follow the general switch unless switched off here, and are edited in the retention studio for
 * this connection (its own orders on the strip, its own plan). Saved with the
 * rest of the form into `config.buyerDataRetention`; inheriting writes an
 * explicit `null`.
 *
 * Follows the sibling sections' ordering rule: `form.setValue` first, then the
 * host's whole-object serializer, which reads the form state.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Button } from '../../../shared/ui/button';
import type { EditConnectionFormValues } from '../../connections';
import { useOperationalSettingsQuery } from '../../settings';
import type { BuyerDataOverride, BuyerDataRules } from '../api/buyer-data.types';
import { useBuyerDataSummary } from '../hooks/use-buyer-data-summary';
import {
  globalRulesFromSettings,
  nextBuyerDataOverride,
  overrideFromRules,
  resolveBuyerDataRules,
} from '../lib/buyer-data-config';
import { RetentionScope } from './retention-scope';

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
  const summarise = useBuyerDataSummary();
  const settingsQuery = useOperationalSettingsQuery();

  const override: BuyerDataOverride | null = form.watch('buyerDataRetention') ?? null;
  const globalRules = globalRulesFromSettings(settingsQuery.data);
  const own = override !== null;
  const effective = resolveBuyerDataRules(override, globalRules);
  const locked = !configIsParseable || !canWrite;

  function store(next: BuyerDataOverride | null): void {
    form.setValue('buyerDataRetention', next, { shouldDirty: true });
    syncBuyerDataToJson();
  }

  function setSource(source: Source): void {
    // Own rules start from what applies today and keep following the general
    // switch: only the periods and the mode are the connection's own.
    store(source === 'own' ? overrideFromRules(effective) : null);
  }

  function changeRules(next: BuyerDataRules): void {
    store(nextBuyerDataOverride(override, effective, next, globalRules.enabled));
  }

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
        <>
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
          <RetentionScope
            name="connection"
            connectionId={connectionId}
            rules={effective}
            savedEnabled={effective.enabled}
            onChange={changeRules}
            locked={locked}
          />
        </>
      ) : (
        <>
          <p className="rate-limit-section__help">
            {interpolate(copy.inheritedNote, { summary: summarise(globalRules) })}{' '}
            <Link to="/settings/buyer-data">{copy.changeGeneral}</Link>
          </p>
          <p className="rate-limit-section__help">
            {interpolate(copy.enabledInherited, {
              state: effective.enabled ? copy.stateOn : copy.stateOff,
            })}
          </p>
        </>
      )}
    </section>
  );
}
