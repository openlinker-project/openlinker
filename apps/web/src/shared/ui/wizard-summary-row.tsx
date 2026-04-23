/**
 * WizardSummaryRow
 *
 * Label + value pair for `<WizardLayout>`'s summary rail. Renders as
 * `<dt>/<dd>` inside a parent `<dl>` for proper definition-list
 * semantics — matching the `.wizard-review-list` pattern used in the
 * inline review panels. `<div>` wrapper is the HTML5-valid group form
 * that lets the stacked (label-above-value) grid layout work without
 * losing the `<dl>` semantics.
 *
 * Unset values fall back to `<EmptyValue />` (em-dash). Identifier-
 * shaped values opt into monospace via `mono`.
 */
import type { ReactElement } from 'react';
import { EmptyValue } from './empty-value';

export interface WizardSummaryRowProps {
  label: string;
  value: string | null;
  mono?: boolean;
}

export function WizardSummaryRow({
  label,
  mono = false,
  value,
}: WizardSummaryRowProps): ReactElement {
  const valueClasses = ['wizard-summary__value', mono ? 'mono-text' : ''].filter(Boolean).join(' ');
  return (
    <div className="wizard-summary__row">
      <dt className="wizard-summary__label">{label}</dt>
      <dd className={valueClasses}>{value ?? <EmptyValue />}</dd>
    </div>
  );
}
