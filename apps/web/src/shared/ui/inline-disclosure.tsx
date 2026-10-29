/**
 * Inline Disclosure
 *
 * Generic "collapsed value with a Change affordance" pattern built on the
 * native `<details>`/`<summary>` elements (per the UI Library Policy:
 * prefer native HTML when it covers the use case — no headless library or
 * custom keyboard handling needed for a disclosure). Shows a label + current
 * value inline; clicking reveals the panel (typically a form control to
 * change the value). First consumer: Infakt's default-payment-method field
 * (#1303) in the connection wizard and edit screen.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { useCopy } from '../i18n/use-copy';
import { uiCopy } from './ui.copy';

export interface InlineDisclosureProps {
  label: string;
  value: string;
  children: ReactNode;
  changeLabel?: string;
  defaultOpen?: boolean;
  className?: string;
}

export function InlineDisclosure({
  label,
  value,
  children,
  changeLabel,
  defaultOpen = false,
  className,
}: InlineDisclosureProps): ReactElement {
  const copy = useCopy(uiCopy).inlineDisclosure;
  return (
    <details className={['inline-disclosure', className].filter(Boolean).join(' ')} open={defaultOpen}>
      <summary className="inline-disclosure__summary">
        <span className="inline-disclosure__label">{label}</span>{' '}
        <span className="inline-disclosure__value">{value}</span>{' '}
        <span className="inline-disclosure__cta">{changeLabel ?? copy.change} →</span>
      </summary>
      <div className="inline-disclosure__panel">{children}</div>
    </details>
  );
}
