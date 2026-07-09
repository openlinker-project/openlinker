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

import { erliBulkConfigIsComplete, erliOfferValidation } from '../../features/listings';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { ErliConnectionActions } from './components/erli-connection-actions';
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
const ErliBulkRowSectionLazy = lazy(() =>
  import('../../features/listings').then((m) => ({ default: m.ErliBulkRowSection })),
);

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
    ConnectionActions: ErliConnectionActions,
    // Bulk offer creation (#1096): dispatch time, no policies, PLN-only.
    bulkOfferConfigSection: {
      component: ErliBulkConfigSectionLazy,
      isComplete: erliBulkConfigIsComplete,
    },
    // Per-product dispatch-time override in the Review edit modal (#1096).
    bulkOfferRowSection: ErliBulkRowSectionLazy,
    // Shared single+bulk blocker: Erli requires ≥1 image (declared once).
    offerValidation: erliOfferValidation,
    // Bulk Review edit modal: Erli's category browsing is a dynamic
    // per-connection toggle (`allegroCategoryAccessEnabled`, set via the
    // credentials panel), not a static adapter capability — the manifest
    // deliberately never declares `CategoryBrowser` (most Erli connections
    // don't have Allegro category access configured). Without this, the
    // bulk edit modal always falls back to the manual Allegro-category-id
    // input even when the operator *has* configured category access; the
    // single-offer `ErliCreateOfferWizard` already reads the same config
    // flag directly.
    bulkCategoryBrowsingEnabled: (connection) =>
      connection.config.allegroCategoryAccessEnabled === true,
    // Listing-detail: opt into the generic "Edit offer" drawer (#1215). The BE
    // adapter already implements OfferFieldUpdater; this exposes the FE button.
    supportsListingEdit: true,
  },
});
