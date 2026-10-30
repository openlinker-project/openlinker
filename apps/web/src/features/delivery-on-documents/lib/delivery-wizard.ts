/**
 * Delivery on documents - setup wizard model (#3911, ADR-079)
 *
 * The "Sales documents" step of the Allegro and Erli wizards asks one question
 * with two answers. This module turns the answer into the config that is saved
 * with the new connection, and into the rows the summary panel shows.
 *
 * "Suggested" is derived from the suggestions endpoint every time it is read,
 * so it can never drift from what the operator was shown. "Own" keeps the
 * edited rows; they start from the suggested rows, like the mockup.
 *
 * @module apps/web/src/features/delivery-on-documents/lib
 */
import type { DeliveryLineSuggestion } from '../api/delivery-on-documents.types';
import type { DeliveryOnDocumentsConfig } from './delivery-line';
import {
  configFromRules,
  countryName,
  neutralSettings,
  rateText,
  rulesFromConfig,
  settingsFromSuggestion,
  toStoredSettings,
  type DeliveryFormSettings,
  type DeliveryRule,
} from './delivery-line-ui';

export type DeliveryWizardChoice = 'suggested' | 'own';

export interface DeliveryWizardValue {
  choice: DeliveryWizardChoice;
  /** The operator's edited rows; `null` until they first edit. */
  rules: DeliveryRule[] | null;
}

export const DEFAULT_DELIVERY_WIZARD_VALUE: DeliveryWizardValue = {
  choice: 'suggested',
  rules: null,
};

/** One row per suggested country plus the neutral "All other countries" row. */
export function suggestedRules(suggestions: readonly DeliveryLineSuggestion[]): DeliveryRule[] {
  const countries: Record<string, ReturnType<typeof toStoredSettings>> = {};
  for (const suggestion of suggestions) {
    countries[suggestion.country] = toStoredSettings(settingsFromSuggestion(suggestion));
  }
  return rulesFromConfig({ countries, default: toStoredSettings(neutralSettings()) });
}

/** The rows the current answer stands for. */
export function wizardRules(
  value: DeliveryWizardValue,
  suggestions: readonly DeliveryLineSuggestion[],
): DeliveryRule[] {
  if (value.choice === 'own' && value.rules !== null) return value.rules;
  return suggestedRules(suggestions);
}

/** The config saved with the connection. Never empty: delivery always has a default. */
export function wizardConfig(
  value: DeliveryWizardValue,
  suggestions: readonly DeliveryLineSuggestion[],
): DeliveryOnDocumentsConfig {
  return (
    configFromRules(wizardRules(value, suggestions)) ?? {
      countries: {},
      default: toStoredSettings(neutralSettings()),
    }
  );
}

/** Short summary of one row for the wizard's side panel. */
export function summaryOf(settings: DeliveryFormSettings): string {
  return settings.rate === 'spread'
    ? 'In product prices'
    : `${settings.name}, ${rateText(settings).toLowerCase()}`;
}

export interface DeliverySummaryRow {
  label: string;
  value: string;
}

export function wizardSummaryRows(rules: readonly DeliveryRule[]): DeliverySummaryRow[] {
  const listed = rules.filter((r) => r.country !== null);
  const other = rules.find((r) => r.country === null);
  return [
    ...listed.map((r) => ({ label: countryName(r.country ?? ''), value: summaryOf(r.settings) })),
    ...(other ? [{ label: 'All other countries', value: summaryOf(other.settings) }] : []),
  ];
}

/** The one-line description under "Use the suggested settings", built from the data. */
export function suggestedText(suggestions: readonly DeliveryLineSuggestion[]): string {
  const fallback = neutralSettings().name;
  if (suggestions.length === 0) {
    return `Delivery gets the same VAT rate as the products and says “${fallback}”.`;
  }
  const named = suggestions.map(
    (s) => `orders to ${countryName(s.country)} say “${s.defaultName}”`,
  );
  const sentence = `${named.join(', ')}, other countries say “${fallback}”.`;
  return `Delivery gets the same VAT rate as the products. ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}
