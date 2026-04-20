import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SetupStepper } from './setup-stepper';

const STEPS = ['Credentials', 'Environment', 'Review'] as const;

function queryDesktopSteps(): NodeListOf<Element> {
  const list = screen.getByRole('navigation').querySelector('.setup-stepper__list');
  if (!list) throw new Error('Desktop stepper list not found');
  return list.querySelectorAll('.setup-stepper__step');
}

describe('SetupStepper', () => {
  afterEach(cleanup);

  it('marks the current step with aria-current="step"', () => {
    render(<SetupStepper steps={STEPS} currentStep={1} />);

    const current = screen
      .getByRole('navigation')
      .querySelector('[aria-current="step"]');
    expect(current).toBeTruthy();
    expect(current?.textContent).toContain('Environment');
  });

  it('shows the correct step number in the mobile label', () => {
    render(<SetupStepper steps={STEPS} currentStep={0} />);
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it('renders a checkmark indicator for completed steps', () => {
    render(<SetupStepper steps={STEPS} currentStep={1} completedSteps={new Set([0])} />);

    const steps = queryDesktopSteps();
    const firstIndicator = steps[0].querySelector('.setup-stepper__indicator');
    expect(firstIndicator?.querySelector('svg')).toBeTruthy();
    expect(firstIndicator?.textContent?.trim()).not.toBe('1');
  });

  it('applies the correct modifier class for upcoming steps', () => {
    render(<SetupStepper steps={STEPS} currentStep={0} />);

    const steps = queryDesktopSteps();
    expect(steps[2].classList.contains('setup-stepper__step--upcoming')).toBe(true);
  });

  it('applies an additional className when provided', () => {
    render(<SetupStepper steps={STEPS} currentStep={0} className="my-stepper" />);
    expect(screen.getByRole('navigation').classList.contains('my-stepper')).toBe(true);
  });
});
