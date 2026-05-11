/**
 * Allegro Platform Plugin
 *
 * In-tree plugin definition for the Allegro marketplace. Contributes:
 *
 *   - Setup card on `PlatformPicker`
 *   - External-auth-redirect flag (the inline create form swaps in an Alert)
 *   - GPSR seller-defaults section in `EditConnectionForm` (#430)
 *   - "Edit offer" affordance on `ListingDetailPage`
 *
 * @module plugins/allegro
 */
import type { PlatformPlugin } from '../../shared/plugins';
import { AllegroExtraSection } from './components/allegro-extra-section';

export const allegroPlugin: PlatformPlugin = {
  platformType: 'allegro',
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
};
