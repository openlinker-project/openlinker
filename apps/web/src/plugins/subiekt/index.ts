/**
 * Subiekt plugin (#1199)
 *
 * Contributes the guided Subiekt connection wizard so the platform appears on
 * the connection-type picker (`/connections/new`) instead of being reachable
 * only through advanced mode. Subiekt nexo issues invoices via the OpenLinker
 * Sfera bridge (BE adapter `subiekt.invoicing.v1`, capability `Invoicing`).
 *
 * Scope is intentionally narrow: a `setupCard` + a guided `build.routes` entry.
 * The structured edit-form sections, credentials panel, and trigger-model /
 * capability-toggle controls are owned by the connection-settings edit surface
 * (#759) and are not contributed here — the edit form falls back to the generic
 * raw-JSON config + "stored securely" credentials affordances until #759 lands.
 *
 * @module plugins/subiekt
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { subiektSetupRoute } from './subiekt-setup.route';

export const subiektPlugin: OpenLinkerPlugin = definePlugin({
  id: 'subiekt',
  platformType: 'subiekt',
  build: {
    routes: [subiektSetupRoute],
  },
  platform: {
    displayName: 'Subiekt nexo',
    setupCard: {
      title: 'Subiekt nexo',
      description:
        'Issue invoices in Subiekt nexo via the OpenLinker Sfera bridge running on your Windows machine.',
      to: '/connections/new/subiekt',
      badge: 'Sfera bridge',
    },
  },
});
