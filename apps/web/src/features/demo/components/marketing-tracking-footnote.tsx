/**
 * Marketing Tracking Footnote
 *
 * Near-invisible fine-print disclosure rendered on /login and /register when
 * the page load is actually trackable by `captureMarketingLanding` — i.e.
 * the visitor arrived via a marketing link carrying a UTM param. Never
 * echoes the raw UTM/campaign value back to the visitor.
 *
 * @module features/demo/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';

export function MarketingTrackingFootnote(): ReactElement {
  const copy = useMessages('demo');
  return <p className="guest-form__tracking-footnote">{copy.trackingFootnote}</p>;
}
