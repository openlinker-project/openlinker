/**
 * Amazon plugin
 *
 * Front for the Amazon Selling Partner API connection (#4186): the guided
 * setup route and the setup card. The connection-page section, credentials
 * panel and notification-queue action are contributed below as they land.
 *
 * @module plugins/amazon
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { amazonSetupRoute } from './amazon-setup.route';
import { getAmazonMessages } from './messages';

export const amazonPlugin: OpenLinkerPlugin = definePlugin({
  id: 'amazon',
  platformType: 'amazon',
  build: {
    routes: [amazonSetupRoute],
  },
  platform: {
    displayName: 'Amazon',
    setupCard: {
      title: 'Amazon',
      // Getters, not values: the card is read at render, so the copy follows
      // the active language instead of freezing at module load.
      get description(): string {
        return getAmazonMessages().plugin.setupCardDescription;
      },
      to: '/connections/new/amazon',
      get badge(): string {
        return getAmazonMessages().plugin.setupCardBadge;
      },
    },
  },
});
