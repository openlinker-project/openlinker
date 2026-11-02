/**
 * Delivery on documents - rules table (#3908)
 *
 * One row per buyer country, the last row covers every other country. Ported
 * from the approved mockup (docs/plans/mockups/delivery-on-documents.html).
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import type { ReactElement } from 'react';
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

export const TIP_LINE: readonly InfotipDefinition[] = [
  {
    term: 'Delivery line',
    text: 'The line for delivery on the receipt and the invoice. Receipts add the VAT rate to its name, for example "Koszt dostawy 23%".',
  },
  {
    term: 'Why the rate is in the name',
    text: 'Fiscal printers keep one VAT rate per line name and refuse a name whose rate goes up. A name with the rate in it never changes rate.',
  },
];

export const TIP_RATE: readonly InfotipDefinition[] = [
  {
    term: 'Same as the products',
    text: 'Delivery gets the VAT rate of the products. If an order has products at different rates, delivery is split between them by value.',
  },
  { term: 'One fixed rate', text: 'Delivery always gets the rate you choose.' },
  {
    term: 'Add to product prices',
    text: 'There is no delivery line. Its cost is added to the product prices on the document.',
  },
];

export function HeadWithTip({
  label,
  tips,
}: {
  label: string;
  tips: readonly InfotipDefinition[];
}): ReactElement {
  return (
    <span className="dd-inline dd-head">
      {label}
      <Infotip ariaLabel={`About ${label.toLowerCase()}`} definitions={tips} />
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
  if (settings.rate === 'spread') return <span className="muted-text">No delivery line</span>;
  const seen = country ? facts.get(country)?.ratesSeen[0] : undefined;
  const sampleRate = settings.rate === 'fixed' ? settings.fixedRate : seen;
  const methods = Object.keys(settings.methodNames).length;
  return (
    <div className="dd-namecell">
      <span className="mono-text dd-namecell__line">
        {sampleRate ? receiptName(settings, sampleRate) : settings.name}
        {sampleRate ? null : <span className="dd-ratetag">+ VAT rate</span>}
      </span>
      {settings.invoiceName !== null || methods ? (
        <span className="dd-hint">
          {[
            settings.invoiceName !== null ? `Invoices: ${settings.invoiceName}` : null,
            methods ? `${methods} delivery method${methods > 1 ? 's' : ''} named separately` : null,
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
  const ordered = [
    ...rules.filter((r) => r.country !== null),
    ...rules.filter((r) => r.country === null),
  ];
  return (
    <div className={`data-table__container dd-table${stacked ? ' dd-table--stacked' : ''}`}>
      <table className="data-table">
        <caption className="sr-only">Delivery line per buyer country</caption>
        <thead>
          <tr>
            <th scope="col">Buyer country</th>
            <th scope="col">
              <HeadWithTip label="Delivery line" tips={TIP_LINE} />
            </th>
            <th scope="col">
              <HeadWithTip label="VAT rate" tips={TIP_RATE} />
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((rule) => {
            const other = rule.country === null;
            const who = other ? 'All other countries' : countryName(rule.country ?? '');
            return (
              <tr key={rule.country ?? 'other'} className={other ? 'dd-row--other' : undefined}>
                <th scope="row" className="dd-who">
                  <span className="dd-who__name">{who}</span>
                </th>
                <td data-label="Delivery line">
                  <NameCell settings={rule.settings} country={rule.country} facts={facts} />
                </td>
                <td data-label="VAT rate">{rateText(rule.settings)}</td>
                <td className="dd-actions">
                  {canEdit ? (
                    <Button
                      tone="ghost"
                      className="button--sm"
                      aria-label={`Edit ${other ? 'all other countries' : who}`}
                      onClick={() => onEdit(rule)}
                    >
                      Edit
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
