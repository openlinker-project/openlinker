export { captureDemoEvent, initDemoIntegrations } from './lib/init-demo-integrations';
export {
  captureMarketingLanding,
  isMarketingLandingTrackable,
} from './lib/capture-marketing-landing';
export { ConsentGate, resolveNextPath } from './components/consent-gate';
export { SessionRecordingBullets } from './components/session-recording-bullets';
export { MarketingTrackingFootnote } from './components/marketing-tracking-footnote';
export { DemoEventCatalog } from './lib/demo-events';
export { bucketCount } from './lib/bucket-count';
export type { DemoEventGroup, DemoEventName, DemoEventProps } from './lib/demo-events';
