/**
 * Erli plugin
 *
 * Unified contribution (#990) — Erli contributes the guided setup route
 * (build-time) and platform-side affordances (setup card, credentials panel).
 * Erli is a marketplace authenticated with a single Shop API key (sent as a
 * bearer token by the BE adapter, #981), so the only credential the operator
 * supplies is `apiKey`; `baseUrl` is an optional advanced config override.
 *
 * Structured config *editing* is intentionally not contributed — the only
 * config field is the optional `baseUrl`, set at create time via the guided
 * wizard; the edit form falls back to the generic raw-JSON config block for
 * the rare post-create change.
 *
 * @module plugins/erli
 */
import { lazy } from 'react';

import { erliOfferValidation } from '../../features/listings';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { ErliCredentialsPanel } from './components/erli-credentials-panel';
import { erliSetupRoute } from './erli-setup.route';

// Lazy-loaded so adding marketplaces doesn't bloat the main bundle (#1096).
// Component-lazy (NOT route-lazy); the host render sites provide the
// `<Suspense>` boundary. The contribution holds a `LazyExoticComponent`,
// assignable to `ComponentType<…>`.
const ErliCreateOfferWizardLazy = lazy(() =>
  import('../../features/listings').then((m) => ({ default: m.ErliCreateOfferWizard })),
);
const ErliBulkConfigSectionLazy = lazy(() =>
  import('../../features/listings').then((m) => ({ default: m.ErliBulkConfigSection })),
);

/** Pure completeness predicate — must NOT pull the lazy chunk (runs in `canProceed`). */
function erliBulkConfigIsComplete(values: { platformParams: Record<string, unknown> }): boolean {
  const dispatch = values.platformParams.dispatchTime;
  if (typeof dispatch !== 'object' || dispatch === null) return false;
  const period = (dispatch as { period?: unknown }).period;
  return typeof period === 'number' && Number.isInteger(period) && period >= 0;
}

export const erliPlugin: OpenLinkerPlugin = definePlugin({
  id: 'erli',
  platformType: 'erli',
  build: {
    routes: [erliSetupRoute],
    // Capability-shaped single-offer creation (#608/#1096): the launcher
    // resolves this via `useOfferCreationWizard('erli')`.
    offerCreationWizard: {
      platformType: 'erli',
      component: ErliCreateOfferWizardLazy,
    },
  },
  platform: {
    displayName: 'Erli',
    setupCard: {
      title: 'Erli',
      description: 'Connect your Erli seller account with your Shop API key.',
      to: '/connections/new/erli',
      badge: 'API key',
    },
    CredentialsPanel: ErliCredentialsPanel,
    // Bulk offer creation (#1096): dispatch time, no policies, PLN-only.
    bulkOfferConfigSection: {
      component: ErliBulkConfigSectionLazy,
      isComplete: erliBulkConfigIsComplete,
    },
    // Shared single+bulk blocker: Erli requires ≥1 image (declared once).
    offerValidation: erliOfferValidation,
  },
});
