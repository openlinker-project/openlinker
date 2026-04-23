/**
 * WizardSummaryRow tests
 *
 * Covers label/value rendering, em-dash fallback when value is null,
 * and mono class opt-in. Tests render inside a `<dl>` wrapper to keep
 * `<dt>/<dd>` semantics legal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WizardSummaryRow } from './wizard-summary-row';

describe('WizardSummaryRow', () => {
  afterEach(cleanup);

  it('renders label and value inside dt/dd elements', () => {
    const { container } = render(
      <dl>
        <WizardSummaryRow label="Name" value="Staging store" />
      </dl>
    );
    expect(container.querySelector('dt')).toHaveTextContent('Name');
    expect(container.querySelector('dd')).toHaveTextContent('Staging store');
  });

  it('renders em-dash fallback when value is null', () => {
    render(
      <dl>
        <WizardSummaryRow label="Name" value={null} />
      </dl>
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('applies mono-text class to the value when mono is true', () => {
    const { container } = render(
      <dl>
        <WizardSummaryRow label="Shop URL" value="https://shop.example.com" mono />
      </dl>
    );
    expect(container.querySelector('dd')).toHaveClass('mono-text');
  });

  it('omits mono-text class when mono is false', () => {
    const { container } = render(
      <dl>
        <WizardSummaryRow label="Name" value="Staging store" />
      </dl>
    );
    expect(container.querySelector('dd')).not.toHaveClass('mono-text');
  });
});
