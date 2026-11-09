/**
 * Login page settings - the admin's editor for a real install's login page
 * copy (#4028 / #4029).
 *
 * @module features/login-page-settings
 */
export { LoginPageSettingsTile } from './components/login-page-settings-tile';
export { LoginPageSettingsEditor } from './components/login-page-settings-editor';
export { useLoginPageSettingsQuery } from './hooks/use-login-page-settings-query';
export { useUpdateLoginPageSettingsMutation } from './hooks/use-update-login-page-settings-mutation';
export type {
  LoginPageLocale,
  LoginPageSettingsView,
  UpdateLoginPageSettingsInput,
} from './api/login-page-settings.types';
