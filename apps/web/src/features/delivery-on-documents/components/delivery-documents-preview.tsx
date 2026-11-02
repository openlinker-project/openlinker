/**
 * Delivery on documents - preview (#3908)
 *
 * What the receipt and the invoice say for one example order from a country,
 * plus the collapsed "See it on an example" block under the table. Example
 * orders and currencies come from the country-facts endpoint, never from a
 * hardcoded country. Ported from the approved mockup.
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import { useState, type ReactElement } from 'react';
import { Select } from '../../../shared/ui/select';
import type { DeliveryCountryFact } from '../api/delivery-on-documents.types';
import {
  countryName,
  formatMoney,
  neutralSettings,
  rateLabel,
  receiptName,
  splitByValue,
  type DeliveryFormSettings,
  type DeliveryRule,
} from '../lib/delivery-line-ui';

export function DocumentsPreview({
  settings,
  country,
  fact,
}: {
  settings: DeliveryFormSettings;
  country: string | null;
  fact: DeliveryCountryFact | null;
}): ReactElement {
  const example = fact?.example ?? null;
  const invoice = settings.invoiceName ?? settings.name;

  if (!fact || !example) {
    return (
      <div className="dd-sample">
        <div className="dd-sample__col">
          <span className="dd-sample__label">On the receipt</span>
          {settings.rate === 'spread' ? (
            <span className="muted-text">No delivery line</span>
          ) : (
            <span className="dd-sample__line">
              <span className="dd-namecell__line">
                {settings.rate === 'fixed' && settings.fixedRate
                  ? receiptName(settings, settings.fixedRate)
                  : settings.name}
                {settings.rate === 'fixed' && settings.fixedRate ? null : (
                  <span className="dd-ratetag">+ VAT rate</span>
                )}
              </span>
            </span>
          )}
        </div>
        <div className="dd-sample__col">
          <span className="dd-sample__label">On the invoice</span>
          <span className="dd-sample__line">
            {settings.rate === 'spread' ? (
              <span className="muted-text">No delivery line</span>
            ) : (
              <span>{invoice}</span>
            )}
          </span>
        </div>
        <p className="dd-hint dd-sample__note">
          {settings.rate === 'goods' ? 'The rate comes from the products in each order. ' : ''}
          {country
            ? `No orders from ${countryName(country)} yet, so there is no example order to show.`
            : null}
        </p>
      </div>
    );
  }

  const delivery = example.delivery ?? 0;
  const money = (n: number): string => formatMoney(n, fact.country, fact.currency);
  const parts =
    settings.rate === 'spread'
      ? []
      : settings.rate === 'fixed'
        ? [{ rate: settings.fixedRate || '?', amount: delivery }]
        : splitByValue(delivery, example.lines);

  return (
    <div className="dd-sample">
      <div className="dd-sample__order">
        <span className="dd-sample__label">Example order from {countryName(fact.country)}</span>
        {example.lines.map((line, index) => (
          <span key={`${line.name}-${index}`} className="dd-sample__line dd-sample__line--muted">
            <span>{line.name}</span>
            <span>
              {money(line.gross)}{' '}
              {line.rate ? <span className="muted-text">{rateLabel(line.rate)}</span> : null}
            </span>
          </span>
        ))}
        <span className="dd-sample__line dd-sample__line--muted">
          <span>Delivery paid by the buyer</span>
          <span>{money(delivery)}</span>
        </span>
      </div>
      <div className="dd-sample__col">
        <span className="dd-sample__label">On the receipt</span>
        {parts.length ? (
          parts.map((part) => (
            <span key={part.rate} className="dd-sample__line">
              <span>{receiptName(settings, part.rate)}</span>
              <span>{money(part.amount)}</span>
            </span>
          ))
        ) : (
          <span className="muted-text">No delivery line. Product prices include it.</span>
        )}
      </div>
      <div className="dd-sample__col">
        <span className="dd-sample__label">On the invoice</span>
        {parts.length ? (
          parts.map((part) => (
            <span key={part.rate} className="dd-sample__line">
              <span>{invoice}</span>
              <span>
                {money(part.amount)}{' '}
                {part.rate ? <span className="muted-text">{rateLabel(part.rate)}</span> : null}
              </span>
            </span>
          ))
        ) : (
          <span className="muted-text">No delivery line. Product prices include it.</span>
        )}
      </div>
    </div>
  );
}

export function ExampleDocs({
  rules,
  facts,
}: {
  rules: readonly DeliveryRule[];
  facts: readonly DeliveryCountryFact[];
}): ReactElement {
  const withExample = facts.filter((f) => f.example !== null);
  const [chosen, setChosen] = useState<string | null>(null);
  const example = chosen ?? withExample[0]?.country ?? null;
  const settings =
    (rules.find((r) => r.country === example) ?? rules.find((r) => r.country === null))?.settings ??
    neutralSettings();
  return (
    <details className="dd-example">
      <summary>See it on an example receipt and invoice</summary>
      <div className="dd-example__body">
        {example !== null ? (
          <Select
            aria-label="Example order from"
            value={example}
            onChange={(e) => setChosen(e.target.value)}
          >
            {withExample.map((f) => (
              <option key={f.country} value={f.country}>
                Order from {countryName(f.country)}
              </option>
            ))}
          </Select>
        ) : null}
        <DocumentsPreview
          settings={settings}
          country={example}
          fact={withExample.find((f) => f.country === example) ?? null}
        />
      </div>
    </details>
  );
}
