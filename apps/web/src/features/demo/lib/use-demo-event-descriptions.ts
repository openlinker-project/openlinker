/**
 * useDemoEventDescriptions
 *
 * What each demo event means, in the operator's language (`demo.events`,
 * keyed by event name). Exported for the PostHog settings panel, which lists
 * the catalog: a feature reads another feature's copy through that feature's
 * own export, never its namespace.
 *
 * @module features/demo/lib
 */
import { useMessages } from '../../../shared/i18n';
import type { DemoEventName } from './demo-events';

export function useDemoEventDescriptions(): Readonly<Record<DemoEventName, string>> {
  return useMessages('demo').events;
}
