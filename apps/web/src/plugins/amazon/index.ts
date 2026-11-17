/**
 * Amazon plugin
 *
 * Front for the Amazon Selling Partner API connection (#4186): the guided
 * setup route and card, the edit-connection section (marketplaces, merchant
 * token, notification queue), the credentials panel (re-authorize, AWS key)
 * and the Register notification queue action. Sections for stock locations,
 * refunds and the catalogue master role land with #4182-#4184.
 *
 * @module plugins/amazon
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { amazonConnectionConfig } from './amazon-connection-config';
import { amazonSetupRoute } from './amazon-setup.route';
import { AmazonConnectionActions } from './components/amazon-connection-actions';
import { AmazonCredentialsPanel } from './components/amazon-credentials-panel';
import { AmazonStructuredSection } from './components/amazon-structured-section';
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
    StructuredConfigSection: AmazonStructuredSection,
    connectionConfig: amazonConnectionConfig,
    CredentialsPanel: AmazonCredentialsPanel,
    ConnectionActions: AmazonConnectionActions,
  },
});
