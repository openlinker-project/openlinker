/**
 * Webhook dead-letter code label
 *
 * Operator-facing sentence for why a delivery was dead-lettered (#3866), from
 * the `webhook-deliveries` namespace in the active language. A code this
 * bundle does not know returns `null`, so the caller shows the raw reason.
 *
 * @module apps/web/src/features/webhook-deliveries/lib
 */
import { getMessages } from '../../../shared/i18n';

export function webhookDlqCodeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const labels: Record<string, string | undefined> = getMessages('webhook-deliveries').dlqCodes;
  return labels[code] ?? null;
}
