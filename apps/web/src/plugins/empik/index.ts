/**
 * Empik plugin
 *
 * Empik Marketplace (EmpikPlace) runs on Mirakl and is served by the shared
 * Mirakl backend plugin (`@openlinker/integrations-mirakl`, adapter key
 * `empik.mirakl.v1`, epic #4273). This first slice (#4274) contributes the
 * guided setup route, the setup card and a credentials panel for rotating the
 * shop API key. #4278 adds the bulk offer wizard section (lead time and
 * logistic class) and the row blockers for a missing EAN or Empik card.
 *
 * Config (environment, shop id) is set in the wizard; the edit form falls back
 * to the generic raw-JSON block for the rare later change, as for DPD.
 *
 * @module plugins/empik
 */
import { lazy } from 'react';

import { empikBulkConfigIsComplete, empikOfferValidation } from '../../features/listings';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { EmpikCredentialsPanel } from './components/empik-credentials-panel';
import { empikSetupRoute } from './empik-setup.route';
import { empikMessages, getEmpikMessages } from './messages';

// Component-lazy so the wizard section stays out of the main bundle (#1096).
const EmpikBulkConfigSectionLazy = lazy(() =>
  import('../../features/listings').then((m) => ({ default: m.EmpikBulkConfigSection })),
);

export const empikPlugin: OpenLinkerPlugin = definePlugin({
  id: 'empik',
  messages: empikMessages,
  platformType: 'empik',
  build: {
    routes: [empikSetupRoute],
  },
  platform: {
    displayName: 'Empik Marketplace',
    // Getters, not values: the card is read at render, so the copy follows
    // the active language instead of freezing at module load.
    setupCard: {
      title: 'Empik Marketplace',
      get description(): string {
        return getEmpikMessages().plugin.setupCard.description;
      },
      to: '/connections/new/empik',
      get badge(): string {
        return getEmpikMessages().plugin.setupCard.badge;
      },
    },
    CredentialsPanel: EmpikCredentialsPanel,
    // Bulk offer creation on existing Empik product cards (#4278).
    bulkOfferConfigSection: {
      component: EmpikBulkConfigSectionLazy,
      isComplete: empikBulkConfigIsComplete,
    },
    offerValidation: empikOfferValidation,
  },
});
