/**
 * Buyer Email Gate
 *
 * Pure decision: may this buyer email be sent? (#3554, D6). Every refusal is a
 * closed reason so the order timeline can say why nothing was sent.
 *
 * @module libs/core/src/orders/domain/domain-services
 */
import {
  MarketplaceBuyerEmailTemplateValues,
  readBuyerEmailsConfig,
  type BuyerEmailChannelKind,
  type BuyerEmailTemplate,
  type ConnectionConfig,
} from '@openlinker/core/identifier-mapping';

import type { BuyerEmailSuppressionReason } from '../types/buyer-email-delivery.types';

/** The operator-facing sentence for each reason - one source for the run log and the timeline. */
export const BUYER_EMAIL_SUPPRESSION_MESSAGE = {
  'emails-off-for-connection': "Buyer emails are off for this order's connection.",
  'template-not-enabled': "This email is not enabled for this order's connection.",
  'template-not-allowed-on-channel':
    'A marketplace connection does not send this email; the shop sends it.',
  'no-buyer-address': 'No buyer email address is stored for this order.',
  'already-sent': 'This email was already sent, or is being sent, for this subject.',
} as const satisfies Record<BuyerEmailSuppressionReason, string>;

export type { BuyerEmailChannelKind };

export interface BuyerEmailGateInput {
  connectionConfig: ConnectionConfig | null | undefined;
  templateKey: BuyerEmailTemplate;
  buyerAddress: string | null | undefined;
  channelKind: BuyerEmailChannelKind;
}

export type BuyerEmailGateDecision =
  | { decision: 'send'; fromAddress?: string; replyTo?: string }
  | { decision: 'suppressed'; reason: BuyerEmailSuppressionReason };

export function decideBuyerEmail(input: BuyerEmailGateInput): BuyerEmailGateDecision {
  const config = readBuyerEmailsConfig(input.connectionConfig);
  if (!config.enabled) {
    return { decision: 'suppressed', reason: 'emails-off-for-connection' };
  }
  const template = config.templates[input.templateKey];
  if (!template?.enabled) {
    return { decision: 'suppressed', reason: 'template-not-enabled' };
  }
  if (
    input.channelKind === 'marketplace' &&
    !(MarketplaceBuyerEmailTemplateValues as readonly string[]).includes(input.templateKey)
  ) {
    return { decision: 'suppressed', reason: 'template-not-allowed-on-channel' };
  }
  if (!input.buyerAddress || input.buyerAddress.trim() === '') {
    return { decision: 'suppressed', reason: 'no-buyer-address' };
  }
  return {
    decision: 'send',
    ...(template.fromAddress ? { fromAddress: template.fromAddress } : {}),
    ...(template.replyTo ? { replyTo: template.replyTo } : {}),
  };
}
