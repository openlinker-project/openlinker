/**
 * InPost plugin (FE)
 *
 * Carrier (shipping-only) FE plugin. v1 scope here (#768) is the webhook
 * runbook affordance on the connection-detail page — the manual webhook-setup
 * runbook that complements the backend shipment-status webhook ingestion. The
 * fuller InPost connection-settings surface (setup card, structured config,
 * credentials panel, trigger config) is owned by #771; this plugin grows those
 * slots there.
 *
 * @module plugins/inpost
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { InpostWebhookRunbook } from './components/inpost-webhook-runbook';

export const inpostPlugin: OpenLinkerPlugin = definePlugin({
  id: 'inpost',
  platformType: 'inpost',
  platform: {
    displayName: 'InPost',
    ConnectionActions: InpostWebhookRunbook,
  },
});
