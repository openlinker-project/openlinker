/**
 * Allegro plugin
 *
 * Unified contribution (#702) — Allegro contributes both build-time
 * affordances (routes, typed API namespace, offer-creation wizard) and
 * platform-side affordances (setup card, GPSR extra section, listing-edit
 * gate, content-publish error extractor).
 *
 * @module plugins/allegro
 */
import { createAllegroApi, type AllegroApi } from '../../features/allegro';
import { AllegroCreateOfferWizard } from '../../features/listings';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { allegroCallbackRoute } from './allegro-callback.route';
import { allegroSetupRoute } from './allegro-setup.route';
import { AllegroExtraSection } from './components/allegro-extra-section';
import { extractAllegroContentPublishErrors } from './extract-content-publish-errors';

declare module '../../app/api/api-client' {
  interface PluginApiNamespaces {
    allegro: AllegroApi;
  }
}

export const allegroPlugin: OpenLinkerPlugin = definePlugin({
  id: 'allegro',
  platformType: 'allegro',
  build: {
    routes: [allegroCallbackRoute, allegroSetupRoute],
    apiNamespaces: (request) => ({ allegro: createAllegroApi(request) }),
    // Capability-shaped offer creation (#608): the listings page resolves
    // this contribution via `useOfferCreationWizard('allegro')` and renders
    // the wizard inside the launcher's Dialog.
    offerCreationWizard: {
      platformType: 'allegro',
      component: AllegroCreateOfferWizard,
    },
  },
  platform: {
    displayName: 'Allegro',
    setupCard: {
      title: 'Allegro',
      description:
        'Connect an Allegro seller account. Authorization uses OAuth 2.0 — no manual token paste.',
      to: '/connections/new/allegro',
      badge: 'OAuth 2.0',
    },
    requiresExternalAuthRedirect: true,
    ExtraConfigSection: AllegroExtraSection,
    supportsListingEdit: true,
    extractContentPublishErrors: extractAllegroContentPublishErrors,
  },
});
