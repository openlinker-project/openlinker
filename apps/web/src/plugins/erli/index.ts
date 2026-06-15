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
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { ErliCredentialsPanel } from './components/erli-credentials-panel';
import { erliSetupRoute } from './erli-setup.route';

export const erliPlugin: OpenLinkerPlugin = definePlugin({
  id: 'erli',
  platformType: 'erli',
  build: {
    routes: [erliSetupRoute],
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
  },
});
