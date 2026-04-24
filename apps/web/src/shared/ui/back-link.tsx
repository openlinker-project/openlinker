/**
 * BackLink
 *
 * Retreat-one-level navigation primitive for page headers. Renders a muted,
 * glyph-prefixed link that steps up to primary-text colour on hover/focus.
 * Typically composed via `PageLayout.backTo` (rendered above the eyebrow),
 * but also accepts a custom `className` for non-PageLayout contexts (e.g.
 * the wizard-card back slot inside `WizardLayout`).
 *
 * Deliberate deviations from `.claude/rules/ui-components.md`:
 * - No `forwardRef`. The rule's rationale is React Hook Form integration,
 *   which does not apply to navigation links. Widen to `forwardRef` only
 *   if a ref consumer surfaces.
 *
 * @see {@link PageLayout} for the primary integration point.
 */
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface BackLinkProps
  extends Omit<ComponentPropsWithoutRef<typeof Link>, 'to' | 'children'> {
  to: string;
  label: ReactNode;
}

export function BackLink({ to, label, className = '', ...props }: BackLinkProps): ReactElement {
  const classes = ['back-link', className].filter(Boolean).join(' ');
  return (
    <Link to={to} className={classes} {...props}>
      <span className="back-link__glyph" aria-hidden="true">
        ←
      </span>
      <span className="back-link__label">{label}</span>
    </Link>
  );
}
