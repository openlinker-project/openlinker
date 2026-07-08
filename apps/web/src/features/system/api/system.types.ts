export interface PosthogDemoIntegration {
  key: string;
  host: string;
}

export interface DemoIntegrations {
  posthog?: PosthogDemoIntegration;
}

export interface SystemConfig {
  demoMode: boolean;
  demoIntegrations?: DemoIntegrations;
}
