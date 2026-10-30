/**
 * Delivery on documents - wizard step (#3911, ADR-079)
 *
 * The "Sales documents" step of the Allegro and Erli setup wizards: one
 * question, two answers. "Use the suggested settings" shows the receipt it
 * produces; "Set it up myself" reveals the same table and editor as the
 * Mappings tab. Ported from the approved mockup
 * (docs/plans/mockups/delivery-on-documents.html, `#kreator`).
 *
 * Controlled: the wizard owns the value in its form state and maps it to
 * config at submit. There is no connection yet, so there are no country facts
 * and no delivery-method names to offer in the editor.
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { Infotip } from '../../../shared/ui/infotip';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { DeliveryLineSuggestion } from '../api/delivery-on-documents.types';
import {
  countryName,
  formatMoney,
  neutralSettings,
  receiptName,
  splitByValue,
  type DeliveryFormSettings,
  type DeliveryRule,
} from '../lib/delivery-line-ui';
import {
  suggestedRules,
  suggestedText,
  wizardRules,
  type DeliveryWizardChoice,
  type DeliveryWizardValue,
} from '../lib/delivery-wizard';
import { DeliveryLineEditorDialog, type EditorTarget } from './delivery-line-editor-dialog';
import { DeliveryRulesTable } from './delivery-rules-table';

/**
 * Illustrative basket for the mini receipt. No orders exist yet when a
 * connection is being created, so this is a fixed example, not the shop's data.
 */
const EXAMPLE_BASKET = {
  currency: 'PLN',
  delivery: 15,
  lines: [
    { name: 'Ceramiczny kubek 350 ml', gross: 60, rate: '23' },
    { name: 'Książka „Kuchnia polska”', gross: 40, rate: '5' },
  ],
} as const;

function MiniReceipt({
  settings,
  country,
}: {
  settings: DeliveryFormSettings;
  country: string;
}): ReactElement {
  const money = (amount: number): string =>
    formatMoney(amount, country, country === 'PL' ? EXAMPLE_BASKET.currency : null);
  const parts =
    settings.rate === 'fixed'
      ? [{ rate: settings.fixedRate, amount: EXAMPLE_BASKET.delivery }]
      : splitByValue(EXAMPLE_BASKET.delivery, EXAMPLE_BASKET.lines);
  return (
    <div className="dd-mini">
      <span className="dd-mini__title">Receipt for an order from {countryName(country)}</span>
      {EXAMPLE_BASKET.lines.map((line) => (
        <span key={line.name} className="dd-mini__line dd-mini__line--muted">
          <span>{line.name}</span>
          <span>{money(line.gross)}</span>
        </span>
      ))}
      {parts.map((part) => (
        <span key={part.rate} className="dd-mini__line">
          <span>{receiptName(settings, part.rate)}</span>
          <span>{money(part.amount)}</span>
        </span>
      ))}
    </div>
  );
}

interface DeliveryWizardStepProps {
  value: DeliveryWizardValue;
  onChange: (next: DeliveryWizardValue) => void;
  /** Empty when the request failed or none exist: the suggestion is then plain "Shipping". */
  suggestions: readonly DeliveryLineSuggestion[];
}

export function DeliveryWizardStep({
  value,
  onChange,
  suggestions,
}: DeliveryWizardStepProps): ReactElement {
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const rules = wizardRules(value, suggestions);
  const first = suggestions[0];
  const firstRule = first ? suggestedRules(suggestions).find((r) => r.country === first.country) : undefined;

  function setChoice(choice: DeliveryWizardChoice): void {
    onChange({ ...value, choice });
  }

  function save(country: string | null, settings: DeliveryFormSettings): void {
    const next: DeliveryRule[] = rules.some((r) => r.country === country)
      ? rules.map((r) => (r.country === country ? { country, settings } : r))
      : [{ country, settings }, ...rules];
    onChange({ choice: 'own', rules: next });
    setEditing(null);
  }

  function remove(country: string): void {
    onChange({ choice: 'own', rules: rules.filter((r) => r.country !== country) });
    setEditing(null);
  }

  return (
    <div className="dd-wizard">
      <div className="dd-wizard__intro">
        <h3>How should delivery appear on receipts and invoices?</h3>
        <p className="muted-text">Pick one. You can change it at any time later.</p>
      </div>

      <div className="dd-choices" role="radiogroup" aria-label="Delivery on documents">
        <label className={`dd-choice${value.choice === 'suggested' ? ' dd-choice--on' : ''}`}>
          <input
            type="radio"
            name="dd-choice"
            checked={value.choice === 'suggested'}
            onChange={() => setChoice('suggested')}
          />
          <span className="dd-choice__body">
            <span className="dd-choice__title">
              Use the suggested settings
              <StatusBadge tone="info" compact withDot={false}>
                Recommended
              </StatusBadge>
              {first ? (
                <Infotip
                  ariaLabel="What the suggestion is based on"
                  definitions={first.sources}
                />
              ) : null}
            </span>
            <span className="dd-choice__text">{suggestedText(suggestions)}</span>
            {value.choice === 'suggested' && first && firstRule ? (
              <MiniReceipt settings={firstRule.settings} country={first.country} />
            ) : null}
          </span>
        </label>

        <label className={`dd-choice${value.choice === 'own' ? ' dd-choice--on' : ''}`}>
          <input
            type="radio"
            name="dd-choice"
            checked={value.choice === 'own'}
            onChange={() => setChoice('own')}
          />
          <span className="dd-choice__body">
            <span className="dd-choice__title">Set it up myself</span>
            <span className="dd-choice__text">
              Choose the names and VAT rate for each buyer country.
            </span>
          </span>
        </label>
      </div>

      {value.choice === 'own' ? (
        <div className="dd-own">
          <DeliveryRulesTable
            stacked
            rules={rules}
            facts={new Map()}
            onEdit={(rule) =>
              setEditing({ mode: 'edit', country: rule.country, settings: rule.settings })
            }
          />
          <Button
            type="button"
            tone="secondary"
            className="button--sm dd-own__add"
            onClick={() => setEditing({ mode: 'add', country: null, settings: neutralSettings() })}
          >
            + Add a country
          </Button>
        </div>
      ) : null}

      <p className="dd-later">
        You can change this later in the connection, under Mappings, Delivery on documents.
      </p>

      <DeliveryLineEditorDialog
        target={editing}
        rules={rules}
        facts={[]}
        suggestions={suggestions}
        deliveryMethods={[]}
        busy={false}
        onClose={() => setEditing(null)}
        onSave={save}
        onRemove={remove}
      />
    </div>
  );
}
