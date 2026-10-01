export interface PosthogDemoIntegration {
  key: string;
  host: string;
  autocapture: boolean;
  sessionRecording: boolean;
  productEventsEnabled: boolean;
  enabledEventGroups: string[];
}

export interface DemoIntegrations {
  posthog?: PosthogDemoIntegration;
}

export interface SystemConfig {
  demoMode: boolean;
  /**
   * Whether the install stores buyer personal data (`OL_STORE_PII`, #3507
   * G03-14). Optional because an API older than this field omits it — read
   * it through `useStoresPersonalData`, which keeps "unknown" distinct from
   * `false` rather than guessing.
   */
  storesPersonalData?: boolean | null;
  demoIntegrations?: DemoIntegrations;
}
