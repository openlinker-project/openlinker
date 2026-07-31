/**
 * Auth feature — public surface
 *
 * The barrel every other feature imports from (`features/auth`), added in #1938
 * review: `features/demo` needed `useUpdateAnalyticsConsentMutation` and reached
 * into `../../auth/hooks/...` because this feature was one of the few without a
 * barrel. The `auth/api` and `auth/hooks` globs are now in the cross-feature
 * deep-import ban in `.eslintrc.js`, so that route is closed.
 *
 * `app/` and `pages/` still deep-import the API factory and the form components
 * — the same shape every other feature uses (`app/api/api-client.ts` composes
 * `create*Api` from `features/<name>/api/...`), so it is left alone here.
 *
 * @module features/auth
 * @see docs/frontend-architecture.md § Feature public surface
 */
export { createAuthApi } from './api/auth.api';
export type { AuthApi } from './api/auth.api';
export type {
  ConfirmEmailRequest,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  OkResponse,
  RegisterRequest,
  ResetPasswordRequest,
  UpdateAnalyticsConsentRequest,
} from './api/auth.types';

export { useConfirmEmail } from './hooks/use-confirm-email';
export type { ConfirmEmailState } from './hooks/use-confirm-email';
export { useForgotPassword } from './hooks/use-forgot-password';
export { useLogin } from './hooks/use-login';
export { useResetPassword } from './hooks/use-reset-password';
export { useUpdateAnalyticsConsentMutation } from './hooks/use-update-analytics-consent-mutation';

export { ConfirmEmailStatus } from './components/ConfirmEmailStatus';
export { ForgotPasswordForm } from './components/ForgotPasswordForm';
export { LoginForm } from './components/LoginForm';
export { ResetPasswordForm } from './components/ResetPasswordForm';
