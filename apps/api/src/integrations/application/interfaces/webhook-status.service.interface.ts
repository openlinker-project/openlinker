/**
 * Webhook Status Service Interface
 *
 * @module apps/api/src/integrations/application/interfaces
 */
import type { WebhookStatus } from '../types/webhook-status.types';

export const WEBHOOK_STATUS_SERVICE_TOKEN = Symbol('IWebhookStatusService');

export interface IWebhookStatusService {
  /**
   * Derive the operator-facing webhook status for a connection from its
   * recorded deliveries and whether a signing secret is stored.
   *
   * @throws if the connection does not exist
   */
  getStatus(connectionId: string): Promise<WebhookStatus>;
}
