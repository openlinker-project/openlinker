/**
 * Webhook delivery status label
 *
 * Operator-facing name of a delivery status from the `webhook-deliveries`
 * namespace, read at call time so it follows the active language. A status
 * this bundle does not know falls back to the raw value.
 *
 * @module apps/web/src/features/webhook-deliveries/lib
 */
import { getMessages } from '../../../shared/i18n';

export function webhookDeliveryStatusLabel(status: string): string {
  const labels: Record<string, string | undefined> = getMessages('webhook-deliveries').statuses;
  return labels[status] ?? status;
}
