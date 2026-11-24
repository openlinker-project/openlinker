/**
 * Buyer Data Section (#4289)
 *
 * The connection edit's quiet answer to "which buyer data rules apply to this
 * connection": a read-only summary of the EFFECTIVE rules (own, or the general
 * ones it follows) and a way to the settings page, which is the one place the
 * rules are changed (`/settings/buyer-data?scope=<connectionId>`). Nothing here
 * writes: the form keeps `config.buyerDataRetention` exactly as it loaded it.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import type { EditConnectionFormValues } from '../../connections';
import { useOperationalSettingsQuery } from '../../settings';
import type { BuyerDataOverride } from '../api/buyer-data.types';
import { useShortPeriod } from '../hooks/use-short-period';
import { globalRulesFromSettings, resolveBuyerDataRules } from '../lib/buyer-data-config';

export interface BuyerDataSectionProps {
  connectionId: string;
  form: UseFormReturn<EditConnectionFormValues>;
}

export function BuyerDataSection({ connectionId, form }: BuyerDataSectionProps): ReactElement {
  const copy = useMessages('buyer-data').section;
  const shortPeriod = useShortPeriod();
  const settingsQuery = useOperationalSettingsQuery();

  const override: BuyerDataOverride | null = form.watch('buyerDataRetention') ?? null;
  // The general rules are an admin read: without them only an own override can be summarised.
  const general = settingsQuery.data;
  const globalRules = globalRulesFromSettings(general);
  const own = override !== null;
  const effective = resolveBuyerDataRules(override, globalRules);
  const offHere = own && override.enabled === false && globalRules.enabled;

  const when = (days: number): string =>
    days <= 0 ? shortPeriod(days) : interpolate(copy.after, { when: shortPeriod(days) });
  const switchText = offHere ? copy.rulesOffHere : effective.enabled ? copy.rulesOn : copy.rulesOff;

  return (
    <section className="rate-limit-section buyer-data-summary" data-testid="buyer-data-section">
      <h3 className="rate-limit-section__title">{copy.heading}</h3>
      <p className="rate-limit-section__help">{copy.help}</p>

      {settingsQuery.isLoading ? null : (
        <div className="buyer-data-summary__body">
          <p className="buyer-data-summary__status" data-testid="buyer-data-source">
            <i
              className={`buyer-data-summary__dot${own ? ' buyer-data-summary__dot--own' : ''}`}
              aria-hidden="true"
            />
            {own ? copy.statusOwn : copy.statusLinked}
          </p>

          {own || general !== undefined ? (
            <dl className="buyer-data-summary__facts">
              <div>
                <dt>{copy.factHide}</dt>
                <dd data-testid="buyer-data-fact-hide">{when(effective.hideAfterDays)}</dd>
              </div>
              <div>
                <dt>{copy.factErase}</dt>
                <dd data-testid="buyer-data-fact-erase">{when(effective.eraseAfterDays)}</dd>
              </div>
            </dl>
          ) : null}

          {general !== undefined ? (
            <p className="rate-limit-section__help" data-testid="buyer-data-switch">
              {switchText}
            </p>
          ) : null}
        </div>
      )}

      <Link
        className="button button--secondary buyer-data-summary__cta"
        to={`/settings/buyer-data?scope=${encodeURIComponent(connectionId)}`}
        data-testid="buyer-data-cta"
      >
        {copy.cta}
        <svg viewBox="0 0 16 16" className="buyer-data-summary__arrow" aria-hidden="true">
          <path
            d="M3 8h10M9 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </section>
  );
}
