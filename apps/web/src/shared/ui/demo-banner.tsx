/**
 * DemoBanner
 *
 * Full-width info bar rendered below the topbar in AppShell when the
 * deployment is running in demo mode (OL_DEMO_MODE=true). Not dismissible —
 * persists for the session as a constant visual reminder.
 *
 * Optionally renders an analytics-consent CTA (#1301) when the host passes
 * `consentPending`, or a compact revoke affordance when the host passes
 * `consentAccepted`. This component stays feature-agnostic — it does not
 * read or write consent storage itself (that lives in `features/demo`, which
 * `shared/ui` must not import) — the host wires `onConsentChange`.
 */
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Button } from './button';

export interface DemoBannerProps extends ComponentPropsWithoutRef<'div'> {
  /** True when the visitor hasn't yet accepted or declined demo analytics. */
  consentPending?: boolean;
  /** True when the visitor has already accepted demo analytics (shows a revoke affordance). */
  consentAccepted?: boolean;
  /** Called with the visitor's choice when the consent CTA or revoke affordance is used. */
  onConsentChange?: (consent: 'accepted' | 'declined') => void;
}

export const DemoBanner = forwardRef<HTMLDivElement, DemoBannerProps>(function DemoBanner(
  { className = '', consentPending = false, consentAccepted = false, onConsentChange, ...props },
  ref,
) {
  const classes = ['demo-banner', className].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={classes} role="note" aria-label="Demo mode notice" {...props}>
      <span className="demo-banner__icon" aria-hidden="true">🔒</span>
      <span>
        <strong>Demo mode — read-only.</strong> You can explore all data; write actions are
        disabled.
      </span>
      {consentPending ? (
        <span className="demo-banner__consent">
          <span>This demo uses session recording to improve the product.</span>
          <Button
            className="button--xs"
            tone="secondary"
            onClick={() => onConsentChange?.('accepted')}
          >
            Accept analytics
          </Button>
          <Button
            className="button--xs"
            tone="ghost"
            onClick={() => onConsentChange?.('declined')}
          >
            Decline
          </Button>
        </span>
      ) : null}
      {consentAccepted ? (
        <span className="demo-banner__consent">
          <span>Analytics on.</span>
          <Button
            className="button--xs"
            tone="ghost"
            onClick={() => onConsentChange?.('declined')}
          >
            Disable
          </Button>
        </span>
      ) : null}
    </div>
  );
});
