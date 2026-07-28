/**
 * Marketing Tracking Footnote
 *
 * Near-invisible fine-print disclosure rendered on /login and /register when
 * the page load is actually trackable by `captureMarketingLanding` (#1900) —
 * i.e. the visitor arrived via a marketing link carrying a UTM param. Never
 * echoes the raw UTM/campaign value back to the visitor.
 *
 * @module features/demo/components
 */
import type { ReactElement } from 'react';

export function MarketingTrackingFootnote(): ReactElement {
  return (
    <p className="guest-form__tracking-footnote">
      This visit is being logged for analytics. No personal profile is created from this.
    </p>
  );
}
