/**
 * Automatic shipping labels - public surface (#2729)
 *
 * The section the OpenLinker OMS status page mounts, and the API factory the
 * api client registers.
 *
 * @module features/auto-dispatch
 * @see docs/frontend-architecture.md § Feature public surface
 */
export { AutomaticLabelsSection } from './components/automatic-labels-section';
export type { AutomaticLabelsSectionProps } from './components/automatic-labels-section';
export { isAutoDispatchEnabled } from './lib/auto-dispatch-config';
export { createAutoDispatchApi } from './api/auto-dispatch.api';
export type { AutoDispatchApi } from './api/auto-dispatch.api';
