/**
 * Batch screen state (#3584/#3585, mockup M15)
 *
 * The M15 state the screen is showing, published as `data-mk-state` on the
 * screen root beside `data-testid="batch-issuing-screen"`. The committed
 * mockup carries the same pair on each of its state sections, so the E2E suite
 * (#3585) can drive the live app and the mockup into the same named state and
 * compare them.
 *
 * `unavailable` wins over every tab, because a connection that cannot issue
 * changes what each tab means.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
export const BatchScreenTabValues = ['schedule', 'queue', 'history'] as const;
export type BatchScreenTab = (typeof BatchScreenTabValues)[number];

export const BatchScreenStateValues = [
  'settings',
  'queue',
  'running',
  'finished',
  'empty',
  'unavailable',
] as const;
export type BatchScreenState = (typeof BatchScreenStateValues)[number];

export function resolveBatchScreenState(input: {
  tab: BatchScreenTab;
  unavailable: boolean;
  running: boolean;
  queueIsEmpty: boolean;
}): BatchScreenState {
  if (input.unavailable) return 'unavailable';
  if (input.tab === 'schedule') return 'settings';
  if (input.tab === 'history') return 'finished';
  if (input.running) return 'running';
  return input.queueIsEmpty ? 'empty' : 'queue';
}
