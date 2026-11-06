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

/** The login-page fields an admin may override on a real install (#4028). */
export const LoginPageCopyFieldValues = [
  'headline',
  'headlineAccent',
  'lead',
  'formTitle',
  'formSubtitle',
  'support',
  'registerTitle',
  'registerSubtitle',
] as const;
export type LoginPageCopyField = (typeof LoginPageCopyFieldValues)[number];

/** Overrides only: a missing field shows the catalog default. */
export type LoginPageCopyOverrides = Partial<Record<LoginPageCopyField, string>>;

export interface LoginPageCopyByLocale {
  pl: LoginPageCopyOverrides;
  en: LoginPageCopyOverrides;
}

export interface SystemConfig {
  demoMode: boolean;
  /** `OL_REGISTRATION_ENABLED`; absent on an API older than #4028, read as false. */
  registrationEnabled?: boolean;
  /** Admin or env login-page copy; omitted in demo mode. */
  loginPage?: LoginPageCopyByLocale;
  /**
   * Whether the install stores buyer personal data (`OL_STORE_PII`, #3507
   * G03-14). Optional because an API older than this field omits it — read
   * it through `useStoresPersonalData`, which keeps "unknown" distinct from
   * `false` rather than guessing.
   */
  storesPersonalData?: boolean | null;
  demoIntegrations?: DemoIntegrations;
}
