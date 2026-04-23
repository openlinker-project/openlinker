/**
 * WizardLayout tests
 *
 * Covers slot rendering (stepper, children, optional summary) and class
 * merging for the three-slot wizard composition primitive.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WizardLayout } from './wizard-layout';

describe('WizardLayout', () => {
  afterEach(cleanup);

  it('should render the stepper slot', () => {
    render(
      <WizardLayout stepper={<nav data-testid="stepper">stepper</nav>}>
        <div>form</div>
      </WizardLayout>
    );
    expect(screen.getByTestId('stepper')).toBeInTheDocument();
  });

  it('should render children inside the form area', () => {
    render(
      <WizardLayout stepper={<nav>stepper</nav>}>
        <form data-testid="form">form content</form>
      </WizardLayout>
    );
    expect(screen.getByTestId('form')).toBeInTheDocument();
  });

  it('should render the summary slot when provided as a landmark', () => {
    render(
      <WizardLayout stepper={<nav>stepper</nav>} summary={<div data-testid="summary">summary</div>}>
        <div>form</div>
      </WizardLayout>
    );
    expect(screen.getByTestId('summary')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Setup summary' })).toBeInTheDocument();
  });

  it('should omit the summary landmark when no summary prop is provided', () => {
    render(
      <WizardLayout stepper={<nav>stepper</nav>}>
        <div>form</div>
      </WizardLayout>
    );
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('should merge custom className with the base class', () => {
    const { container } = render(
      <WizardLayout stepper={<nav>stepper</nav>} className="custom">
        <div>form</div>
      </WizardLayout>
    );
    const root = container.firstElementChild;
    expect(root).toHaveClass('wizard-layout');
    expect(root).toHaveClass('custom');
  });
});
