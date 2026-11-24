/**
 * Describe a failed connection test (#3866)
 *
 * The sentence for what the test found, in the active language, followed by
 * the tester's own English detail under the "not translated" label. The
 * outcome is the operator's answer; the detail is what they quote to support.
 *
 * @module apps/web/src/features/connections/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
import type { ConnectionTestResult } from '../api/connections.types';

export function describeConnectionTestFailure(result: ConnectionTestResult): string {
  const outcomes: Record<string, string | undefined> = getMessages('connections').testOutcome;
  const sentence = outcomes[result.outcome ?? 'failed'] ?? outcomes.failed ?? '';
  const message = result.message.trim();
  if (message.length === 0) return sentence;
  const details = interpolate(getMessages('ui').apiError.technicalDetailsWith, { details: message });
  return `${sentence} ${details}`;
}
