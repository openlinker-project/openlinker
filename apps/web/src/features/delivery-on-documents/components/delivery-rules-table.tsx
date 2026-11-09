/**
 * Delivery on documents - rules table (#3908)
 *
 * One row per buyer country, the last row covers every other country. Ported
 * from the approved mockup (docs/plans/mockups/delivery-on-documents.html).
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { Infotip, type InfotipDefinition } from '../../../shared/ui/infotip';
import type { DeliveryCountryFact } from '../api/delivery-on-documents.types';
import {
  countryName,
  rateText,
  receiptName,
  type DeliveryFormSettings,
  type DeliveryRule,
} from '../lib/delivery-line-ui';

export interface DeliveryTips {
  line: readonly InfotipDefinition[];
  rate: readonly InfotipDefinition[];
}

/** The infotip definitions behind the "Delivery line" and "VAT rate" headings. */
export function useDeliveryTips(): DeliveryTips {
  const tips = useMessages('delivery-on-documents').tips;
  return {
    line: [
      { term: tips.line.term, text: tips.line.text },
      { term: tips.line.whyTerm, text: tips.line.whyText },
    ],
    rate: [
      { term: tips.rate.goodsTerm, text: tips.rate.goodsText },
      { term: tips.rate.fixedTerm, text: tips.rate.fixedText },
      { term: tips.rate.spreadTerm, text: tips.rate.spreadText },
    ],
  };
}

export function HeadWithTip({
  label,
  tips,
}: {
  label: string;
  tips: readonly InfotipDefinition[];
}): ReactElement {
  const copy = useMessages('delivery-on-documents').table;
  return (
    <span className="dd-inline dd-head">
      {label}
      <Infotip
        ariaLabel={interpolate(copy.aboutLabel, { label: label.toLowerCase() })}
        definitions={tips}
      />
    </span>
  );
}

function NameCell({
  settings,
  country,
  facts,
}: {
  settings: DeliveryFormSettings;
  country: string | null;
  facts: ReadonlyMap<string, DeliveryCountryFact>;
}): ReactElement {
  const copy = useMessages('delivery-on-documents');
  const plural = usePlural();
  if (settings.rate === 'spread') return <span className="muted-text">{copy.common.noLine}</span>;
  const seen = country ? facts.get(country)?.ratesSeen[0] : undefined;
  const sampleRate = settings.rate === 'fixed' ? settings.fixedRate : seen;
  const methods = Object.keys(settings.methodNames).length;
  return (
    <div className="dd-namecell">
      <span className="mono-text dd-namecell__line">
        {sampleRate ? receiptName(settings, sampleRate) : settings.name}
        {sampleRate ? null : <span className="dd-ratetag">{copy.common.rateTag}</span>}
      </span>
      {settings.invoiceName !== null || methods ? (
        <span className="dd-hint">
          {[
            settings.invoiceName !== null
              ? interpolate(copy.table.invoiceHint, { name: settings.invoiceName })
              : null,
            methods ? plural(methods, copy.table.methodsHint) : null,
          ]
            .filter(Boolean)
            .join('. ')}
        </span>
      ) : null}
    </div>
  );
}

interface DeliveryRulesTableProps {
  rules: readonly DeliveryRule[];
  facts: ReadonlyMap<string, DeliveryCountryFact>;
  onEdit: (rule: DeliveryRule) => void;
  /** Hides the Edit affordance (read-only viewers). */
  canEdit?: boolean;
  stacked?: boolean;
}

export function DeliveryRulesTable({
  rules,
  facts,
  onEdit,
  canEdit = true,
  stacked,
}: DeliveryRulesTableProps): ReactElement {
  const copy = useMessages('delivery-on-documents');
  const tips = useDeliveryTips();
  const ordered = [
    ...rules.filter((r) => r.country !== null),
    ...rules.filter((r) => r.country === null),
  ];
  return (
    <div className={`data-table__container dd-table${stacked ? ' dd-table--stacked' : ''}`}>
      <table className="data-table">
        <caption className="sr-only">{copy.table.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.table.buyerCountry}</th>
            <th scope="col">
              <HeadWithTip label={copy.table.deliveryLine} tips={tips.line} />
            </th>
            <th scope="col">
              <HeadWithTip label={copy.table.vatRate} tips={tips.rate} />
            </th>
            <th scope="col">
              <span className="sr-only">{copy.table.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((rule) => {
            const other = rule.country === null;
            const who = other ? copy.common.allOtherCountries : countryName(rule.country ?? '');
            return (
              <tr key={rule.country ?? 'other'} className={other ? 'dd-row--other' : undefined}>
                <th scope="row" className="dd-who">
                  <span className="dd-who__name">{who}</span>
                </th>
                <td data-label={copy.table.deliveryLine}>
                  <NameCell settings={rule.settings} country={rule.country} facts={facts} />
                </td>
                <td data-label={copy.table.vatRate}>{rateText(rule.settings)}</td>
                <td className="dd-actions">
                  {canEdit ? (
                    <Button
                      tone="ghost"
                      className="button--sm"
                      aria-label={
                        other
                          ? copy.table.editOtherLabel
                          : interpolate(copy.table.editLabel, { who })
                      }
                      onClick={() => onEdit(rule)}
                    >
                      {copy.table.edit}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
