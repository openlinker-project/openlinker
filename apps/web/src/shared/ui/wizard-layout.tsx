/**
 * WizardLayout
 *
 * Three-slot layout container for multi-step setup wizards (PrestaShop,
 * Allegro). Renders a full-width stepper above the form, a narrow form
 * column, and an optional live summary rail to its right on desktop;
 * stacks to a single column below 1024 px.
 *
 * @see {@link SetupStepper} for the stepper primitive this composes.
 */
import type { PropsWithChildren, ReactElement, ReactNode } from 'react';

interface WizardLayoutProps extends PropsWithChildren {
  stepper: ReactNode;
  summary?: ReactNode;
  className?: string;
}

export function WizardLayout({
  children,
  className,
  stepper,
  summary,
}: WizardLayoutProps): ReactElement {
  const classes = ['wizard-layout', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <div className="wizard-layout__stepper">{stepper}</div>
      <div className="wizard-layout__form">{children}</div>
      {summary ? (
        <aside className="wizard-layout__summary wizard-summary" aria-label="Setup summary">
          {summary}
        </aside>
      ) : null}
    </div>
  );
}
