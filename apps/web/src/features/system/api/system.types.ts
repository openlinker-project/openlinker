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
  demoIntegrations?: DemoIntegrations;
}
